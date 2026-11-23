"""
Virtual Multi-Factory Fleet Simulator over REAL verified mTLS MQTT (EMQX :8883).
Simulates 2 isolated factories × 3 machines each (6 unique X.509 client certificates!).
Reads fault injection commands from Valkey (`sim:fault:{device_uid}`) so `inject_fault.py`
can trigger bearing wear, overheat, power spikes, or sudden power-loss LWT live!
"""

import argparse
import json
import logging
import math
import os
import random
import ssl
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt
import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SIM] %(levelname)s %(message)s")
logger = logging.getLogger("fleet_sim")

DEFAULT_FLEET = [
    ("acme-packaging", "acme-motor-01", 30.0, 52.0, 12.0, 85.0),
    ("acme-packaging", "acme-pump-02", 31.0, 56.0, 11.0, 92.0),
    ("acme-packaging", "acme-motor-03", 29.5, 50.0, 12.5, 88.0),
    ("nordic-cold", "nordic-comp-01", 28.0, 48.0, 11.5, 110.0),
    ("nordic-cold", "nordic-fan-02", 26.0, 58.0, 10.0, 65.0),
    ("nordic-cold", "nordic-chill-03", 27.5, 54.0, 11.0, 95.0),
]


class VirtualDevice:
    def __init__(
        self,
        org_slug: str,
        device_uid: str,
        base_temp: float,
        base_hum: float,
        base_vib: float,
        base_power: float,
        broker: str,
        port: int,
        certs_dir: Path,
    ) -> None:
        self.org_slug = org_slug
        self.device_uid = device_uid
        self.base_temp = base_temp
        self.base_hum = base_hum
        self.base_vib = base_vib
        self.base_power = base_power
        self.broker = broker
        self.port = port
        self.certs_dir = certs_dir
        self.tick = 0
        self.fault_step = 0
        self.connected = False
        self.offline_simulated = False

        self.topic_telemetry = f"tenants/{org_slug}/devices/{device_uid}/telemetry"
        self.topic_status = f"tenants/{org_slug}/devices/{device_uid}/status"

        crt = certs_dir / "devices" / f"{org_slug}__{device_uid}.crt"
        key = certs_dir / "devices" / f"{org_slug}__{device_uid}.key"
        ca = certs_dir / "ca.crt"
        if not (crt.exists() and key.exists() and ca.exists()):
            raise FileNotFoundError(f"Missing certs for {org_slug}:{device_uid} in {certs_dir}")

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"sim-{org_slug}-{device_uid}")
        self.client.tls_set(
            ca_certs=str(ca),
            certfile=str(crt),
            keyfile=str(key),
            tls_version=ssl.PROTOCOL_TLS_CLIENT,
        )
        self.client.tls_insecure_set(False)
        # MQTT Last Will & Testament (LWT): if connection dies ungracefully, EMQX publishes offline!
        self.client.will_set(self.topic_status, json.dumps({"status": "offline"}), qos=1, retain=True)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, _ud, _flags, rc, _props):
        if rc == 0:
            self.connected = True
            client.publish(self.topic_status, json.dumps({"status": "online"}), qos=1, retain=True)
            logger.info("ONLINE  %s/%s (mTLS verified)", self.org_slug, self.device_uid)
        else:
            logger.error("CONNECT FAILED %s/%s rc=%s", self.org_slug, self.device_uid, rc)

    def _on_disconnect(self, _client, _ud, _flags, rc, _props):
        self.connected = False
        if not self.offline_simulated:
            logger.warning("DISCONNECTED %s/%s rc=%s", self.org_slug, self.device_uid, rc)

    def start(self) -> None:
        self.client.connect_async(self.broker, self.port, keepalive=30)
        self.client.loop_start()

    def stop(self) -> None:
        try:
            self.client.publish(self.topic_status, json.dumps({"status": "offline"}), qos=1, retain=True)
            time.sleep(0.1)
        except Exception:
            pass
        self.client.loop_stop()
        self.client.disconnect()

    def publish_tick(self, fault_mode: str | None) -> None:
        if fault_mode == "offline":
            if not self.offline_simulated:
                self.offline_simulated = True
                self.client.publish(self.topic_status, json.dumps({"status": "offline"}), qos=1, retain=True)
                self.client.disconnect()
                logger.warning("FAULT[offline] %s/%s simulated power loss!", self.org_slug, self.device_uid)
            return

        if self.offline_simulated:
            self.offline_simulated = False
            self.client.reconnect()
            return

        if not self.connected:
            return

        self.tick += 1
        wave = math.sin(self.tick * 0.25)
        temp = self.base_temp + wave * 0.8 + random.uniform(-0.3, 0.3)
        hum = self.base_hum + math.cos(self.tick * 0.15) * 2.0 + random.uniform(-0.5, 0.5)
        vib = self.base_vib + wave * 0.4 + random.uniform(-0.3, 0.3)
        power = self.base_power + wave * 3.0 + random.uniform(-1.5, 1.5)

        if fault_mode == "bearing_wear":
            self.fault_step = min(self.fault_step + 1, 10)
            ramp = self.fault_step / 5.0
            temp += 3.5 * ramp
            vib += 2.8 * ramp
            power += 14.0 * ramp
        elif fault_mode == "overheat":
            self.fault_step = min(self.fault_step + 1, 6)
            temp += 5.0 + self.fault_step * 1.4
            power += 18.0
        elif fault_mode == "power_spike":
            power += 55.0 + random.uniform(-3, 5)
            temp += 3.0
        elif fault_mode == "vib_critical":
            vib += 11.0 + random.uniform(0, 2.0)
            temp += 4.0
        else:
            self.fault_step = 0

        payload = {
            "device_id": self.device_uid,
            "temperature": round(temp, 2),
            "humidity": round(max(5.0, min(99.0, hum)), 1),
            "vibration_hz": round(max(0.5, vib), 2),
            "power_w": round(max(5.0, power), 1),
            "sim_sensors": "virtual_factory_fleet",
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        }
        self.client.publish(self.topic_telemetry, json.dumps(payload), qos=1)
        tag = f" [FAULT:{fault_mode}]" if fault_mode else ""
        logger.info(
            "TX %s/%s | T=%.1fC H=%.0f%% Vib=%.1fHz Pwr=%.0fW%s",
            self.org_slug,
            self.device_uid,
            payload["temperature"],
            payload["humidity"],
            payload["vibration_hz"],
            payload["power_w"],
            tag,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Future Eagle Multi-Factory mTLS Fleet Simulator")
    parser.add_argument("--broker", default=os.getenv("EMQX_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(os.getenv("EMQX_PORT", "8883")))
    parser.add_argument("--valkey", default=os.getenv("VALKEY_URL", "redis://localhost:6379/0"))
    parser.add_argument("--certs", default=os.getenv("CERTS_DIR", "./infra/certs"))
    parser.add_argument("--interval", type=float, default=3.0, help="Publish interval seconds")
    args = parser.parse_args()

    r = redis.from_url(args.valkey, decode_responses=True)
    certs_dir = Path(args.certs)
    devices = [
        VirtualDevice(org, uid, t, h, v, p, args.broker, args.port, certs_dir)
        for (org, uid, t, h, v, p) in DEFAULT_FLEET
    ]
    for d in devices:
        d.start()

    logger.info("Simulating %d devices across 2 factories every %.1fs (Ctrl+C to stop)...", len(devices), args.interval)
    try:
        while True:
            for d in devices:
                fault_mode = None
                try:
                    fault_mode = r.get(f"sim:fault:{d.device_uid}")
                except Exception:
                    pass
                d.publish_tick(fault_mode)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        logger.info("Stopping simulator...")
    finally:
        for d in devices:
            d.stop()


if __name__ == "__main__":
    main()
