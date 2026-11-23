"""
Decoupled mTLS MQTT Ingestor -> NATS JetStream -> Batched TimescaleDB Writer.
Fixes blocking I/O inside Paho's network callback and enforces strict SAN mTLS + tenant/device verification.
"""

import asyncio
import json
import logging
import math
import ssl
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import nats
import paho.mqtt.client as mqtt
import redis.asyncio as aioredis
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update

from app.config import get_settings
from app.db.session import AdminSessionLocal
from app.models.entities import Asset, Device, Organization, SensorReading
from app.workers.rules_core import classify_iso_20816, estimate_vib_rms_mm_s

logging.basicConfig(level=logging.INFO, format="%(asctime)s [INGEST] %(levelname)s %(message)s")
logger = logging.getLogger("ingestor")


class TelemetryPayload(BaseModel):
    temperature: float = Field(ge=-60.0, le=300.0)
    humidity: float = Field(ge=0.0, le=100.0)
    vibration_hz: float = Field(ge=0.0, le=5000.0)
    power_w: float = Field(ge=0.0, le=500000.0)
    vib_rms_mm_s: float | None = Field(default=None, ge=0.0, le=200.0)
    sim_sensors: str | None = None
    timestamp_utc: datetime | None = None

    @field_validator("temperature", "humidity", "vibration_hz", "power_w")
    @classmethod
    def check_finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("Non-finite sensor value")
        return v


class DeviceLookupCache:
    """In-memory short-TTL cache mapping (org_slug, device_uid) -> device/org/asset IDs."""

    def __init__(self, ttl_sec: float = 15.0) -> None:
        self._ttl = ttl_sec
        self._cache: dict[tuple[str, str], tuple[float, dict[str, Any] | None]] = {}

    async def resolve(self, org_slug: str, device_uid: str) -> dict[str, Any] | None:
        key = (org_slug, device_uid)
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached and now - cached[0] < self._ttl:
            return cached[1]

        async with AdminSessionLocal() as db:
            row = (
                await db.execute(
                    select(Device, Organization)
                    .join(Organization, Organization.id == Device.org_id)
                    .where(
                        Organization.slug == org_slug,
                        Device.device_uid == device_uid,
                        Device.is_revoked.is_(False),
                    )
                )
            ).first()

        if not row:
            self._cache[key] = (now, None)
            return None

        dev, org = row
        val = {
            "org_id": str(org.id),
            "org_slug": org.slug,
            "device_id": str(dev.id),
            "device_uid": dev.device_uid,
            "asset_id": str(dev.asset_id) if dev.asset_id else None,
        }
        self._cache[key] = (now, val)
        return val


async def run_ingestor() -> None:
    settings = get_settings()
    loop = asyncio.get_running_loop()
    incoming_queue: asyncio.Queue[tuple[str, bytes]] = asyncio.Queue(maxsize=5000)
    db_batch: list[dict[str, Any]] = []
    batch_lock = asyncio.Lock()
    device_cache = DeviceLookupCache()

    # Connect Valkey & NATS JetStream
    valkey = aioredis.from_url(settings.valkey_url, decode_responses=True)
    nc = await nats.connect(settings.nats_url, reconnect_time_wait=2, max_reconnect_attempts=-1)
    js = nc.jetstream()
    try:
        await js.add_stream(name="TELEMETRY", subjects=["telemetry.raw", "device.status"])
    except Exception:
        pass
    try:
        await js.add_stream(name="ALERTS", subjects=["alerts.enrich"])
    except Exception:
        pass
    logger.info("Connected to NATS JetStream and Valkey.")

    async def flush_batch() -> None:
        async with batch_lock:
            if not db_batch:
                return
            rows_to_insert = db_batch.copy()
            db_batch.clear()
        try:
            async with AdminSessionLocal() as db:
                await db.run_sync(
                    lambda sync_sess: sync_sess.bulk_insert_mappings(SensorReading, rows_to_insert)
                )
                await db.commit()
            logger.debug("Flushed %d telemetry rows to TimescaleDB.", len(rows_to_insert))
        except Exception as exc:
            logger.error("Failed to flush telemetry batch (%d rows): %s", len(rows_to_insert), exc)

    async def periodic_flusher() -> None:
        while True:
            await asyncio.sleep(0.5)
            await flush_batch()

    async def handle_status(meta: dict[str, Any], raw_payload: bytes) -> None:
        try:
            body = json.loads(raw_payload.decode("utf-8"))
            new_status = str(body.get("status", "offline")).lower()
        except Exception:
            new_status = raw_payload.decode("utf-8", errors="ignore").strip().lower() or "offline"
        if new_status not in ("online", "offline"):
            new_status = "offline"

        now = datetime.now(timezone.utc)
        async with AdminSessionLocal() as db:
            await db.execute(
                update(Device)
                .where(Device.id == UUID(meta["device_id"]))
                .values(status=new_status, last_seen_at=now)
            )
            if new_status == "offline" and meta["asset_id"]:
                await db.execute(
                    update(Asset)
                    .where(Asset.id == UUID(meta["asset_id"]), Asset.maintenance_mode.is_(False))
                    .values(health_status="OFFLINE")
                )
            await db.commit()

        event = {
            "org_id": meta["org_id"],
            "device_id": meta["device_id"],
            "device_uid": meta["device_uid"],
            "asset_id": meta["asset_id"],
            "status": new_status,
            "timestamp": now.isoformat(),
        }
        await valkey.publish(f"org:{meta['org_id']}:events", json.dumps({"type": "device.status", "data": event}))
        await js.publish("device.status", json.dumps(event).encode("utf-8"))
        logger.info("Device %s/%s -> %s", meta["org_slug"], meta["device_uid"], new_status.upper())

    async def process_queue() -> None:
        while True:
            topic, raw_payload = await incoming_queue.get()
            try:
                parts = topic.split("/")
                # Expected: tenants/{org_slug}/devices/{device_uid}/{channel}
                if len(parts) < 5 or parts[0] != "tenants" or parts[2] != "devices":
                    continue
                org_slug, device_uid, channel = parts[1], parts[3], parts[4]
                meta = await device_cache.resolve(org_slug, device_uid)
                if not meta:
                    logger.warning("Rejected unregistered/revoked device topic=%s", topic)
                    continue

                if channel == "status":
                    await handle_status(meta, raw_payload)
                    continue

                if channel != "telemetry":
                    continue

                try:
                    data = json.loads(raw_payload.decode("utf-8"))
                    validated = TelemetryPayload.model_validate(data)
                except Exception as exc:
                    logger.warning("Invalid telemetry payload from %s/%s: %s", org_slug, device_uid, exc)
                    continue

                now = validated.timestamp_utc or datetime.now(timezone.utc)
                rms = (
                    validated.vib_rms_mm_s
                    if validated.vib_rms_mm_s is not None
                    else estimate_vib_rms_mm_s(validated.vibration_hz)
                )
                iso_zone = classify_iso_20816(rms)

                row = {
                    "time": now,
                    "org_id": UUID(meta["org_id"]),
                    "device_id": UUID(meta["device_id"]),
                    "asset_id": UUID(meta["asset_id"]) if meta["asset_id"] else None,
                    "temperature": validated.temperature,
                    "humidity": validated.humidity,
                    "vibration_hz": validated.vibration_hz,
                    "power_w": validated.power_w,
                    "vib_rms_mm_s": rms,
                    "iso_zone": iso_zone,
                    "extra_metadata": {"sim_sensors": validated.sim_sensors} if validated.sim_sensors else {},
                }

                # Mark device online (debounced via Valkey TTL key)
                online_key = f"dev_online:{meta['device_id']}"
                if not await valkey.exists(online_key):
                    async with AdminSessionLocal() as db:
                        await db.execute(
                            update(Device)
                            .where(Device.id == UUID(meta["device_id"]))
                            .values(status="online", last_seen_at=now)
                        )
                        await db.commit()
                await valkey.set(online_key, "1", ex=30)

                should_flush = False
                async with batch_lock:
                    db_batch.append(row)
                    if len(db_batch) >= 100:
                        should_flush = True
                if should_flush:
                    await flush_batch()

                # Emit to NATS JetStream for rules engine
                stream_event = {
                    "time": now.isoformat(),
                    "org_id": meta["org_id"],
                    "org_slug": meta["org_slug"],
                    "device_id": meta["device_id"],
                    "device_uid": meta["device_uid"],
                    "asset_id": meta["asset_id"],
                    "temperature": validated.temperature,
                    "humidity": validated.humidity,
                    "vibration_hz": validated.vibration_hz,
                    "power_w": validated.power_w,
                    "vib_rms_mm_s": rms,
                    "iso_zone": iso_zone,
                }
                await js.publish("telemetry.raw", json.dumps(stream_event).encode("utf-8"))
            finally:
                incoming_queue.task_done()

    # Configure MQTT Client with verified SAN mTLS (NO tls_insecure_set!)
    certs = Path(settings.certs_dir)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="eagle-ingestor-1")
    client.tls_set(
        ca_certs=str(certs / "ca.crt"),
        certfile=str(certs / "ingestor.crt"),
        keyfile=str(certs / "ingestor.key"),
        tls_version=ssl.PROTOCOL_TLS_CLIENT,
    )
    client.tls_insecure_set(False)

    def on_connect(c, _userdata, _flags, reason_code, _properties):
        if reason_code == 0:
            logger.info("Connected to EMQX over verified mTLS (%s:%d)", settings.emqx_host, settings.emqx_port)
            c.subscribe("tenants/+/devices/+/telemetry", qos=1)
            c.subscribe("tenants/+/devices/+/status", qos=1)
        else:
            logger.error("EMQX connect failed rc=%s", reason_code)

    def on_message(_c, _userdata, msg):
        # Strictly non-blocking handoff to asyncio loop!
        def _enqueue():
            try:
                incoming_queue.put_nowait((msg.topic, msg.payload))
            except asyncio.QueueFull:
                logger.warning("Ingestion queue full — dropping packet on %s", msg.topic)

        loop.call_soon_threadsafe(_enqueue)

    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=15)
    client.connect_async(settings.emqx_host, settings.emqx_port, keepalive=60)
    client.loop_start()

    try:
        await asyncio.gather(periodic_flusher(), process_queue())
    finally:
        client.loop_stop()
        client.disconnect()
        await flush_batch()
        await nc.close()
        await valkey.aclose()


if __name__ == "__main__":
    asyncio.run(run_ingestor())
