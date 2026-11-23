"""
CLI fault injector for the Virtual Factory Fleet Simulator.
Usage:
  python simulator/inject_fault.py acme-motor-01 bearing_wear --ttl 60
  python simulator/inject_fault.py nordic-comp-01 overheat --ttl 45
  python simulator/inject_fault.py acme-pump-02 offline --ttl 30
  python simulator/inject_fault.py acme-motor-01 clear
"""

import argparse
import os

import redis

VALID_MODES = ("bearing_wear", "overheat", "power_spike", "vib_critical", "offline", "clear")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inject or clear a live fault on a simulated factory device")
    parser.add_argument("device_uid", help="e.g. acme-motor-01 or nordic-comp-01")
    parser.add_argument("mode", choices=VALID_MODES)
    parser.add_argument("--ttl", type=int, default=60, help="Auto-recover after N seconds")
    parser.add_argument("--valkey", default=os.getenv("VALKEY_URL", "redis://localhost:6379/0"))
    args = parser.parse_args()

    r = redis.from_url(args.valkey, decode_responses=True)
    key = f"sim:fault:{args.device_uid}"
    if args.mode == "clear":
        r.delete(key)
        print(f"[Fault Injector] Cleared fault on {args.device_uid}")
    else:
        r.set(key, args.mode, ex=args.ttl)
        print(f"[Fault Injector] Active fault '{args.mode}' on {args.device_uid} for {args.ttl}s")


if __name__ == "__main__":
    main()
