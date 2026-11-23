"""
Pure, unit-testable industrial anomaly detection, ISO 20816 classification,
and per-device exponential backoff cooldown logic.
"""

from dataclasses import dataclass
from typing import Any


def estimate_vib_rms_mm_s(vibration_hz: float, baseline_hz: float = 12.0) -> float:
    """
    Converts frequency-based demo vibration (Hz) to approximate ISO 20816 RMS velocity (mm/s)
    when the sensor node does not provide direct triaxial RMS velocity.
    Healthy idle (~12 Hz) maps near ~1.1 mm/s (Zone A); >=20 Hz maps >7.5 mm/s (Zone C/D).
    """
    delta = max(0.0, vibration_hz - baseline_hz)
    rms = 0.9 + (vibration_hz * 0.03) + (delta * 0.85)
    return round(max(0.1, rms), 2)


def classify_iso_20816(vib_rms_mm_s: float) -> str:
    """ISO 20816-3 Group 2 (Medium Industrial Machines 15-300 kW, rigid foundation)."""
    if vib_rms_mm_s < 1.8:
        return "A"  # Newly commissioned / excellent
    if vib_rms_mm_s < 4.5:
        return "B"  # Acceptable for unrestricted long-term operation
    if vib_rms_mm_s < 11.2:
        return "C"  # Unsatisfactory — schedule maintenance
    return "D"      # Unacceptable — damage likely, immediate stop


@dataclass
class ProfileConfig:
    baseline_temp: float = 30.0
    baseline_humidity: float = 55.0
    baseline_vibration_hz: float = 12.0
    baseline_power_w: float = 85.0
    warn_temp: float = 35.0
    crit_temp: float = 37.0
    warn_humidity: float = 75.0
    crit_humidity: float = 80.0
    warn_vibration_hz: float = 17.0
    crit_vibration_hz: float = 20.0
    warn_power_w: float = 115.0
    crit_power_w: float = 130.0
    corr_min_signals: int = 3
    corr_temp_delta: float = 5.0
    corr_vib_delta: float = 2.0
    corr_power_delta: float = 16.0
    rapid_window: int = 3
    rapid_temp_delta: float = 3.0
    cooldown_base_sec: int = 10
    cooldown_multiplier: int = 2
    cooldown_max_sec: int = 120
    normal_reset_readings: int = 3


def evaluate_triggers(
    reading: dict[str, Any],
    history: list[dict[str, Any]],
    profile: ProfileConfig,
) -> tuple[bool, str, str]:
    """
    Single source of truth for asset health & trigger evaluation.
    Returns: (should_trigger, trigger_reason, severity['NOMINAL'|'WARNING'|'CRITICAL'])
    """
    temp = float(reading["temperature"])
    hum = float(reading["humidity"])
    vib = float(reading["vibration_hz"])
    power = float(reading["power_w"])
    iso_zone = reading.get("iso_zone") or classify_iso_20816(
        float(reading.get("vib_rms_mm_s") or estimate_vib_rms_mm_s(vib, profile.baseline_vibration_hz))
    )

    # 1. Hard CRITICAL thresholds
    crit_reasons: list[str] = []
    if temp >= profile.crit_temp:
        crit_reasons.append(f"TEMP {temp:.1f}°C >= {profile.crit_temp:.1f}°C")
    if hum >= profile.crit_humidity:
        crit_reasons.append(f"HUMIDITY {hum:.1f}% >= {profile.crit_humidity:.1f}%")
    if vib >= profile.crit_vibration_hz:
        crit_reasons.append(f"VIBRATION {vib:.1f}Hz >= {profile.crit_vibration_hz:.1f}Hz")
    if power >= profile.crit_power_w:
        crit_reasons.append(f"POWER {power:.0f}W >= {profile.crit_power_w:.0f}W")
    if iso_zone == "D":
        crit_reasons.append(f"ISO 20816 ZONE D ({reading.get('vib_rms_mm_s')} mm/s)")

    if crit_reasons:
        return True, " | ".join(crit_reasons), "CRITICAL"

    # 2. Multi-signal correlation trigger (catches early bearing wear before hard limits)
    deviations = 0
    dev_notes: list[str] = []
    if temp - profile.baseline_temp >= profile.corr_temp_delta:
        deviations += 1
        dev_notes.append(f"temp +{temp - profile.baseline_temp:.1f}°C")
    if vib - profile.baseline_vibration_hz >= profile.corr_vib_delta:
        deviations += 1
        dev_notes.append(f"vib +{vib - profile.baseline_vibration_hz:.1f}Hz")
    if power - profile.baseline_power_w >= profile.corr_power_delta:
        deviations += 1
        dev_notes.append(f"power +{power - profile.baseline_power_w:.0f}W")

    if deviations >= profile.corr_min_signals:
        return True, f"CORRELATION ({deviations} signals): {', '.join(dev_notes)}", "WARNING"

    # 3. Rapid temperature rate-of-change trigger
    if len(history) >= profile.rapid_window:
        window = history[-profile.rapid_window :]
        delta = float(window[-1]["temperature"]) - float(window[0]["temperature"])
        if abs(delta) >= profile.rapid_temp_delta:
            return True, f"RAPID TEMP CHANGE: {delta:+.1f}°C over {profile.rapid_window} readings", "WARNING"

    # 4. Warning thresholds / ISO Zone C
    warn_reasons: list[str] = []
    if temp >= profile.warn_temp:
        warn_reasons.append(f"TEMP {temp:.1f}°C >= warn {profile.warn_temp:.1f}°C")
    if hum >= profile.warn_humidity:
        warn_reasons.append(f"HUMIDITY {hum:.1f}% >= warn {profile.warn_humidity:.1f}%")
    if vib >= profile.warn_vibration_hz:
        warn_reasons.append(f"VIBRATION {vib:.1f}Hz >= warn {profile.warn_vibration_hz:.1f}Hz")
    if power >= profile.warn_power_w:
        warn_reasons.append(f"POWER {power:.0f}W >= warn {profile.warn_power_w:.0f}W")
    if iso_zone == "C":
        warn_reasons.append(f"ISO 20816 ZONE C ({reading.get('vib_rms_mm_s')} mm/s)")

    if warn_reasons:
        return True, " | ".join(warn_reasons), "WARNING"

    return False, "", "NOMINAL"


@dataclass
class CooldownState:
    last_alert_time: float = 0.0
    consecutive_alerts: int = 0
    last_severity: str = "NOMINAL"
    consecutive_normals: int = 0

    SEVERITY_RANK = {"NOMINAL": 0, "WARNING": 1, "CRITICAL": 2}

    def current_cooldown_sec(self, profile: ProfileConfig) -> float:
        if self.consecutive_alerts <= 0:
            return 0.0
        raw = profile.cooldown_base_sec * (profile.cooldown_multiplier ** (self.consecutive_alerts - 1))
        return float(min(raw, profile.cooldown_max_sec))

    def should_fire(self, severity: str, now_ts: float, profile: ProfileConfig) -> tuple[bool, str]:
        if self.SEVERITY_RANK.get(severity, 0) > self.SEVERITY_RANK.get(self.last_severity, 0):
            return True, f"escalation {self.last_severity} -> {severity}"
        if self.consecutive_alerts == 0:
            return True, "first alert in fault window"
        elapsed = now_ts - self.last_alert_time
        cd = self.current_cooldown_sec(profile)
        if elapsed < cd:
            return False, f"cooldown {cd - elapsed:.0f}s remaining (window {cd:.0f}s)"
        return True, f"cooldown expired ({elapsed:.0f}s elapsed)"

    def record_alert(self, severity: str, now_ts: float) -> None:
        self.last_alert_time = now_ts
        self.consecutive_alerts += 1
        self.last_severity = severity
        self.consecutive_normals = 0

    def record_normal(self, profile: ProfileConfig) -> bool:
        """Returns True if fault window reset."""
        self.consecutive_normals += 1
        if self.consecutive_normals >= profile.normal_reset_readings:
            had_alerts = self.consecutive_alerts > 0
            self.last_alert_time = 0.0
            self.consecutive_alerts = 0
            self.last_severity = "NOMINAL"
            self.consecutive_normals = 0
            return had_alerts
        return False

    def to_dict(self) -> dict[str, str]:
        return {
            "last_alert_time": str(self.last_alert_time),
            "consecutive_alerts": str(self.consecutive_alerts),
            "last_severity": self.last_severity,
            "consecutive_normals": str(self.consecutive_normals),
        }

    @classmethod
    def from_dict(cls, raw: dict[str, str] | None) -> "CooldownState":
        if not raw:
            return cls()
        return cls(
            last_alert_time=float(raw.get("last_alert_time", 0.0)),
            consecutive_alerts=int(raw.get("consecutive_alerts", 0)),
            last_severity=raw.get("last_severity", "NOMINAL"),
            consecutive_normals=int(raw.get("consecutive_normals", 0)),
        )
