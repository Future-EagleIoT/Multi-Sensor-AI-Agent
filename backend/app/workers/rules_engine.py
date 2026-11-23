"""
Per-Device Rules, Correlation, ISO 20816 & Cooldown Engine.
Consumes `telemetry.raw` from NATS JetStream, maintains isolated per-device state in Valkey,
updates live asset health, broadcasts WebSocket ticks, and enqueues async AI enrichment jobs.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from uuid import UUID

import nats
import redis.asyncio as aioredis
from sqlalchemy import select, update

from app.config import get_settings
from app.db.session import AdminSessionLocal
from app.models.entities import Alert, Asset, AssetProfile
from app.workers.rules_core import CooldownState, ProfileConfig, evaluate_triggers

logging.basicConfig(level=logging.INFO, format="%(asctime)s [RULES] %(levelname)s %(message)s")
logger = logging.getLogger("rules_engine")


async def load_asset_context(valkey: aioredis.Redis, asset_id: str) -> tuple[ProfileConfig, bool, str] | None:
    cache_key = f"profile:{asset_id}"
    cached = await valkey.get(cache_key)
    if cached:
        data = json.loads(cached)
        return ProfileConfig(**data["profile"]), bool(data["maintenance_mode"]), data["asset_name"]

    async with AdminSessionLocal() as db:
        row = (
            await db.execute(
                select(Asset, AssetProfile)
                .outerjoin(AssetProfile, AssetProfile.asset_id == Asset.id)
                .where(Asset.id == UUID(asset_id))
            )
        ).first()
    if not row:
        return None
    asset, prof = row
    if prof:
        cfg = ProfileConfig(
            baseline_temp=prof.baseline_temp,
            baseline_humidity=prof.baseline_humidity,
            baseline_vibration_hz=prof.baseline_vibration_hz,
            baseline_power_w=prof.baseline_power_w,
            warn_temp=prof.warn_temp,
            crit_temp=prof.crit_temp,
            warn_humidity=prof.warn_humidity,
            crit_humidity=prof.crit_humidity,
            warn_vibration_hz=prof.warn_vibration_hz,
            crit_vibration_hz=prof.crit_vibration_hz,
            warn_power_w=prof.warn_power_w,
            crit_power_w=prof.crit_power_w,
            corr_min_signals=prof.corr_min_signals,
            corr_temp_delta=prof.corr_temp_delta,
            corr_vib_delta=prof.corr_vib_delta,
            corr_power_delta=prof.corr_power_delta,
            rapid_window=prof.rapid_window,
            rapid_temp_delta=prof.rapid_temp_delta,
            cooldown_base_sec=prof.cooldown_base_sec,
            cooldown_multiplier=prof.cooldown_multiplier,
            cooldown_max_sec=prof.cooldown_max_sec,
            normal_reset_readings=prof.normal_reset_readings,
        )
    else:
        cfg = ProfileConfig()

    payload = {
        "profile": cfg.__dict__,
        "maintenance_mode": asset.maintenance_mode,
        "asset_name": asset.name,
    }
    await valkey.set(cache_key, json.dumps(payload), ex=30)
    return cfg, asset.maintenance_mode, asset.name


async def run_rules_engine() -> None:
    settings = get_settings()
    valkey = aioredis.from_url(settings.valkey_url, decode_responses=True)
    nc = await nats.connect(settings.nats_url, reconnect_time_wait=2, max_reconnect_attempts=-1)
    js = nc.jetstream()

    for stream_name, subjects in [("TELEMETRY", ["telemetry.raw", "device.status"]), ("ALERTS", ["alerts.enrich"])]:
        try:
            await js.add_stream(name=stream_name, subjects=subjects)
        except Exception:
            pass

    sub = await js.subscribe("telemetry.raw", durable="rules-engine-v1")
    logger.info("Rules Engine listening on NATS JetStream `telemetry.raw`...")

    try:
        async for msg in sub.messages:
            try:
                event = json.loads(msg.data.decode("utf-8"))
                org_id = event["org_id"]
                asset_id = event.get("asset_id")
                device_id = event["device_id"]

                if not asset_id:
                    await msg.ack()
                    continue

                loaded = await load_asset_context(valkey, asset_id)
                if not loaded:
                    await msg.ack()
                    continue
                profile, maintenance_mode, asset_name = loaded

                # 1. Append to isolated per-device rolling history in Valkey
                win_key = f"win:{device_id}"
                await valkey.rpush(win_key, json.dumps(event))
                await valkey.ltrim(win_key, -10, -1)
                await valkey.expire(win_key, 3600)
                raw_hist = await valkey.lrange(win_key, 0, -1)
                history = [json.loads(x) for x in raw_hist]

                # 2. Evaluate health (respecting planned maintenance mode)
                if maintenance_mode:
                    triggered, reason, severity = False, "", "MAINTENANCE"
                else:
                    triggered, reason, severity = evaluate_triggers(event, history, profile)

                latest_metrics = {
                    "temperature": event["temperature"],
                    "humidity": event["humidity"],
                    "vibration_hz": event["vibration_hz"],
                    "power_w": event["power_w"],
                    "vib_rms_mm_s": event["vib_rms_mm_s"],
                    "iso_zone": event["iso_zone"],
                }

                # 3. Update Asset live status & latest_metrics
                now_dt = datetime.now(timezone.utc)
                async with AdminSessionLocal() as db:
                    await db.execute(
                        update(Asset)
                        .where(Asset.id == UUID(asset_id))
                        .values(
                            health_status=severity,
                            latest_metrics=latest_metrics,
                            last_telemetry_at=now_dt,
                        )
                    )
                    await db.commit()

                # 4. Broadcast live telemetry tick to tenant WebSockets
                await valkey.publish(
                    f"org:{org_id}:events",
                    json.dumps(
                        {
                            "type": "telemetry.tick",
                            "data": {
                                **event,
                                "asset_name": asset_name,
                                "health_status": severity,
                            },
                        }
                    ),
                )

                # 5. Per-device Cooldown & Alert Persistence
                cd_key = f"cd:{device_id}"
                cd = CooldownState.from_dict(await valkey.hgetall(cd_key))
                now_ts = time.time()

                if not triggered:
                    if not maintenance_mode:
                        was_reset = cd.record_normal(profile)
                        await valkey.hset(cd_key, mapping=cd.to_dict())
                        await valkey.expire(cd_key, 86400)
                        if was_reset:
                            logger.info("[%s] Fault window closed — cooldown reset.", asset_name)
                    await msg.ack()
                    continue

                allowed, cd_reason = cd.should_fire(severity, now_ts, profile)
                if not allowed:
                    logger.debug("[%s] Alert suppressed (%s): %s", asset_name, severity, cd_reason)
                    await msg.ack()
                    continue

                cd.record_alert(severity, now_ts)
                await valkey.hset(cd_key, mapping=cd.to_dict())
                await valkey.expire(cd_key, 86400)

                async with AdminSessionLocal() as db:
                    alert = Alert(
                        org_id=UUID(org_id),
                        asset_id=UUID(asset_id),
                        device_id=UUID(device_id),
                        severity=severity,
                        status="open",
                        trigger_reason=reason,
                        trigger_snapshot=latest_metrics,
                        ai_status="pending",
                    )
                    db.add(alert)
                    await db.commit()
                    await db.refresh(alert)

                alert_payload = {
                    "id": str(alert.id),
                    "org_id": org_id,
                    "asset_id": asset_id,
                    "asset_name": asset_name,
                    "device_id": device_id,
                    "severity": severity,
                    "status": "open",
                    "trigger_reason": reason,
                    "trigger_snapshot": latest_metrics,
                    "ai_status": "pending",
                    "ai_diagnosis": None,
                    "created_at": alert.created_at.isoformat(),
                }
                await valkey.publish(
                    f"org:{org_id}:events",
                    json.dumps({"type": "alert.created", "data": alert_payload}),
                )

                # Enqueue async AI enrichment job (NEVER blocks telemetry!)
                enrich_job = {
                    "alert_id": str(alert.id),
                    "org_id": org_id,
                    "asset_id": asset_id,
                    "asset_name": asset_name,
                    "severity": severity,
                    "trigger_reason": reason,
                    "current": latest_metrics,
                    "history": history[-5:],
                    "profile": profile.__dict__,
                }
                await js.publish("alerts.enrich", json.dumps(enrich_job).encode("utf-8"))
                logger.info("[%s] Alert FIRED [%s] (%s): %s", asset_name, severity, cd_reason, reason)
                await msg.ack()
            except Exception as exc:
                logger.exception("Error processing telemetry event: %s", exc)
                await msg.ack()
    finally:
        await nc.close()
        await valkey.aclose()


if __name__ == "__main__":
    asyncio.run(run_rules_engine())
