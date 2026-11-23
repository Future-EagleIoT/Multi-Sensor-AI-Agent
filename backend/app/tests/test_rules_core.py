"""Unit tests for deterministic industrial rules, ISO 20816 zones, and per-device cooldown isolation."""

from app.workers.rules_core import (
    CooldownState,
    ProfileConfig,
    classify_iso_20816,
    estimate_vib_rms_mm_s,
    evaluate_triggers,
)


def test_iso_20816_zones():
    assert classify_iso_20816(1.1) == "A"
    assert classify_iso_20816(3.2) == "B"
    assert classify_iso_20816(7.4) == "C"
    assert classify_iso_20816(12.5) == "D"


def test_nominal_reading():
    p = ProfileConfig()
    reading = {"temperature": 30.2, "humidity": 54.0, "vibration_hz": 12.1, "power_w": 86.0}
    triggered, reason, sev = evaluate_triggers(reading, [reading], p)
    assert triggered is False
    assert sev == "NOMINAL"
    assert reason == ""


def test_hard_critical_threshold():
    p = ProfileConfig()
    reading = {"temperature": 38.5, "humidity": 55.0, "vibration_hz": 12.0, "power_w": 85.0}
    triggered, reason, sev = evaluate_triggers(reading, [reading], p)
    assert triggered is True
    assert sev == "CRITICAL"
    assert "TEMP" in reason


def test_multi_signal_correlation_warning():
    p = ProfileConfig()
    # Each signal is below hard critical, but all 3 deviate above correlation deltas!
    reading = {
        "temperature": 35.2,   # +5.2 >= 5.0
        "humidity": 55.0,
        "vibration_hz": 14.5,  # +2.5 >= 2.0
        "power_w": 103.0,      # +18 >= 16
        "vib_rms_mm_s": 3.4,   # Zone B
        "iso_zone": "B",
    }
    triggered, reason, sev = evaluate_triggers(reading, [reading], p)
    assert triggered is True
    assert sev == "WARNING"
    assert "CORRELATION" in reason


def test_rapid_temperature_change_trigger():
    p = ProfileConfig(rapid_window=3, rapid_temp_delta=3.0)
    history = [
        {"temperature": 29.0, "humidity": 50.0, "vibration_hz": 12.0, "power_w": 85.0},
        {"temperature": 30.8, "humidity": 50.0, "vibration_hz": 12.0, "power_w": 85.0},
        {"temperature": 32.5, "humidity": 50.0, "vibration_hz": 12.0, "power_w": 85.0},
    ]
    triggered, reason, sev = evaluate_triggers(history[-1], history, p)
    assert triggered is True
    assert sev == "WARNING"
    assert "RAPID TEMP CHANGE" in reason


def test_cooldown_backoff_escalation_and_reset():
    p = ProfileConfig(cooldown_base_sec=10, cooldown_multiplier=2, cooldown_max_sec=120, normal_reset_readings=3)
    cd = CooldownState()

    # First WARNING fires immediately
    ok, _ = cd.should_fire("WARNING", 100.0, p)
    assert ok is True
    cd.record_alert("WARNING", 100.0)

    # Repeat WARNING 5s later is suppressed (window = 10s)
    ok, _ = cd.should_fire("WARNING", 105.0, p)
    assert ok is False

    # Escalation to CRITICAL ALWAYS fires immediately even during cooldown!
    ok, reason = cd.should_fire("CRITICAL", 105.0, p)
    assert ok is True
    assert "escalation" in reason
    cd.record_alert("CRITICAL", 105.0)

    # Second window doubles to 20s
    ok, _ = cd.should_fire("CRITICAL", 120.0, p)
    assert ok is False
    ok, _ = cd.should_fire("CRITICAL", 126.0, p)
    assert ok is True

    # 3 consecutive normal readings reset cooldown state
    assert cd.record_normal(p) is False
    assert cd.record_normal(p) is False
    assert cd.record_normal(p) is True
    assert cd.consecutive_alerts == 0
    assert cd.last_severity == "NOMINAL"


def test_per_device_isolation_via_serialization():
    p = ProfileConfig()
    dev_a = CooldownState()
    dev_b = CooldownState()
    dev_a.record_alert("CRITICAL", 1000.0)

    # Round-trip Valkey hash format
    restored_a = CooldownState.from_dict(dev_a.to_dict())
    restored_b = CooldownState.from_dict(dev_b.to_dict())

    assert restored_a.should_fire("CRITICAL", 1005.0, p)[0] is False
    assert restored_b.should_fire("CRITICAL", 1005.0, p)[0] is True


def test_vib_rms_estimation():
    assert estimate_vib_rms_mm_s(12.0) < 1.8
    assert estimate_vib_rms_mm_s(21.0) > 8.0
