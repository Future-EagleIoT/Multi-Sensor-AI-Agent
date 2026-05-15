# === FILE: agent.py ===
# Multi-Sensor Correlation AI Agent
# MQTT Subscriber → gemma4:4b (Ollama)
# Signals: temperature (real), humidity (real), vibration (simulated), power_draw (simulated)


import json
import time
import paho.mqtt.client as mqtt
import ollama

# -----------------------------------------------
# CONFIGURATION
# -----------------------------------------------
MQTT_BROKER  = "[IP_ADDRESS]"
MQTT_PORT    = 1883
MQTT_TOPIC   = "future_eagle/sensors/motor01"
OLLAMA_MODEL = "gemma4:latest"

# Motor baselines — what "healthy and idle" looks like
BASELINE = {
    "temperature":  30.0,   # °C
    "humidity":     55.0,   # %
    "vibration_hz": 12.0,   # Hz
    "power_w":      85.0    # Watts
}

# Alert thresholds — single-signal hard limits
THRESHOLDS = {
    "temperature":  37.0,   # °C
    "humidity":     80.0,   # %
    "vibration_hz": 20.0,   # Hz
    "power_w":     130.0    # Watts
}

# Correlation trigger — how many signals must deviate together
CORRELATION_MIN_SIGNALS   = 3     # Require at least 3 signals above deviation
CORRELATION_TEMP_DELTA    = 5.0   # °C above baseline
CORRELATION_VIB_DELTA     = 2   # Hz above baseline
CORRELATION_POWER_DELTA   = 16.0  # W above baseline
RAPID_CHANGE_WINDOW       = 3     # readings
RAPID_TEMP_DELTA          = 3.0   # °C change in N readings

# Cooldown configuration
COOLDOWN_BASE_SECONDS     = 10    # First cooldown after an alert fires
COOLDOWN_MULTIPLIER       = 2     # Doubles each consecutive alert
COOLDOWN_MAX_SECONDS      = 120   # Hard ceiling — never wait longer than this
NORMAL_RESET_READINGS     = 3     # Consecutive normal readings needed to reset cooldown

# Rolling reading history
reading_history  = []
MAX_HISTORY      = 5


# -----------------------------------------------
# ALERT COOLDOWN MANAGER
# Tracks per-severity exponential backoff.
# Fires immediately on first alert or severity escalation.
# Suppresses repeat calls during cooldown.
# Resets after N consecutive normal readings.
# -----------------------------------------------
class AlertCooldownManager:
    SEVERITY_RANK = {"NORMAL": 0, "WARNING": 1, "CRITICAL": 2}

    def __init__(self, base_seconds, multiplier, max_seconds, normal_reset_readings):
        self.base_seconds          = base_seconds
        self.multiplier            = multiplier
        self.max_seconds           = max_seconds
        self.normal_reset_readings = normal_reset_readings

        self.last_alert_time       = 0.0   # epoch seconds of last fired alert
        self.consecutive_alerts    = 0     # how many alerts have fired without a reset
        self.last_severity         = "NORMAL"
        self.consecutive_normals   = 0     # normal readings since last alert

    def _current_cooldown(self) -> float:
        """Cooldown duration for the NEXT suppression window."""
        raw = self.base_seconds * (self.multiplier ** (self.consecutive_alerts - 1))
        return min(raw, self.max_seconds)

    def _is_escalation(self, new_severity: str) -> bool:
        return (
            self.SEVERITY_RANK.get(new_severity, 0)
            > self.SEVERITY_RANK.get(self.last_severity, 0)
        )

    def should_call_llm(self, severity: str) -> tuple[bool, str]:
        """
        Returns (allowed: bool, reason: str).
        Call this BEFORE firing the LLM.
        """
        now = time.time()

        # Severity escalation always fires immediately
        if self._is_escalation(severity):
            return True, f"escalation {self.last_severity} → {severity}"

        # First alert ever (no prior alert in this fault window)
        if self.consecutive_alerts == 0:
            return True, "first alert in fault window"

        # Check if we are still inside the cooldown window
        elapsed  = now - self.last_alert_time
        cooldown = self._current_cooldown()
        if elapsed < cooldown:
            remaining = cooldown - elapsed
            return False, f"cooldown {remaining:.0f}s remaining (window: {cooldown:.0f}s)"

        # Cooldown has expired — allow
        return True, f"cooldown expired ({elapsed:.0f}s elapsed)"

    def record_alert(self, severity: str):
        """Call this immediately AFTER the LLM fires."""
        self.last_alert_time     = time.time()
        self.consecutive_alerts += 1
        self.last_severity       = severity
        self.consecutive_normals = 0

    def record_normal(self):
        """Call this on every NORMAL reading."""
        self.consecutive_normals += 1
        if self.consecutive_normals >= self.normal_reset_readings:
            self._reset()

    def _reset(self):
        """Fault window closed — reset all state."""
        if self.consecutive_alerts > 0:
            print(
                f"  [Cooldown] ✅ {self.consecutive_normals} normal readings — "
                f"fault window closed. Backoff reset."
            )
        self.consecutive_alerts  = 0
        self.last_severity       = "NORMAL"
        self.last_alert_time     = 0.0
        self.consecutive_normals = 0

    def status_line(self) -> str:
        """One-line summary for terminal display."""
        if self.consecutive_alerts == 0:
            return "backoff: reset"
        elapsed  = time.time() - self.last_alert_time
        cooldown = self._current_cooldown()
        remaining = max(0.0, cooldown - elapsed)
        return (
            f"backoff: alert #{self.consecutive_alerts} | "
            f"next window: {cooldown:.0f}s | "
            f"cooldown remaining: {remaining:.0f}s"
        )


# Single shared instance
cooldown = AlertCooldownManager(
    base_seconds          = COOLDOWN_BASE_SECONDS,
    multiplier            = COOLDOWN_MULTIPLIER,
    max_seconds           = COOLDOWN_MAX_SECONDS,
    normal_reset_readings = NORMAL_RESET_READINGS,
)


# -----------------------------------------------
# TRIGGER LOGIC — Correlation-Aware
# Returns (should_trigger: bool, reason: str, severity: str)
# -----------------------------------------------
def evaluate_triggers(reading: dict) -> tuple[bool, str, str]:
    temp  = float(reading.get("temperature",  0))
    hum   = float(reading.get("humidity",     0))
    vib   = float(reading.get("vibration_hz", 0))
    power = float(reading.get("power_w",      0))

    reasons = []

    # --- Hard threshold breaches (single-signal) ---
    if temp  >= THRESHOLDS["temperature"]:
        reasons.append(f"🔴 TEMP {temp}°C ≥ {THRESHOLDS['temperature']}°C")
    if hum   >= THRESHOLDS["humidity"]:
        reasons.append(f"🟡 HUMIDITY {hum}% ≥ {THRESHOLDS['humidity']}%")
    if vib   >= THRESHOLDS["vibration_hz"]:
        reasons.append(f"🟠 VIBRATION {vib:.1f} Hz ≥ {THRESHOLDS['vibration_hz']} Hz")
    if power >= THRESHOLDS["power_w"]:
        reasons.append(f"🔴 POWER {power:.0f}W ≥ {THRESHOLDS['power_w']}W")

    if reasons:
        return True, " | ".join(reasons), "CRITICAL"

    # --- Multi-signal correlation trigger ---
    deviations = 0
    dev_notes  = []
    if temp  - BASELINE["temperature"]  >= CORRELATION_TEMP_DELTA:
        deviations += 1
        dev_notes.append(f"temp +{temp - BASELINE['temperature']:.1f}°C")
    if vib   - BASELINE["vibration_hz"] >= CORRELATION_VIB_DELTA:
        deviations += 1
        dev_notes.append(f"vib +{vib - BASELINE['vibration_hz']:.1f} Hz")
    if power - BASELINE["power_w"]      >= CORRELATION_POWER_DELTA:
        deviations += 1
        dev_notes.append(f"power +{power - BASELINE['power_w']:.0f}W")

    if deviations >= CORRELATION_MIN_SIGNALS:
        return True, f"⚡ CORRELATION: {', '.join(dev_notes)}", "WARNING"

    # --- Rapid temperature change trigger ---
    if len(reading_history) >= RAPID_CHANGE_WINDOW:
        recent_temps = [float(r["temperature"]) for r in reading_history[-RAPID_CHANGE_WINDOW:]]
        delta = recent_temps[-1] - recent_temps[0]
        if abs(delta) >= RAPID_TEMP_DELTA:
            return True, f"📈 RAPID CHANGE: {delta:+.1f}°C over {RAPID_CHANGE_WINDOW} readings", "WARNING"

    return False, "", "NORMAL"


# -----------------------------------------------
# gemma 4 AGENT — Multi-Signal Correlation Prompt
# -----------------------------------------------
def analyse_with_gemma(current: dict, history: list, trigger_reason: str) -> str:
    temp  = float(current.get("temperature",  0))
    hum   = float(current.get("humidity",     0))
    vib   = float(current.get("vibration_hz", 0))
    power = float(current.get("power_w",      0))

    d_temp  = temp  - BASELINE["temperature"]
    d_vib   = vib   - BASELINE["vibration_hz"]
    d_power = power - BASELINE["power_w"]

    # --- Determine primary focus signal (worst offender by % deviation) ---
    pct_temp  = abs(d_temp)  / BASELINE["temperature"]
    pct_vib   = abs(d_vib)   / BASELINE["vibration_hz"]
    pct_power = abs(d_power) / BASELINE["power_w"]

    focus_map = {
        "temperature rise and its thermal stress implications":   pct_temp,
        "vibration pattern and bearing health implications":      pct_vib,
        "power consumption anomaly and electrical load insights": pct_power,
    }
    primary_focus = max(focus_map, key=focus_map.get)

    # --- Trend direction for each signal ---
    def trend(key, current_val):
        if len(history) < 2:
            return "insufficient data"
        prev = float(history[-2].get(key, current_val))
        delta = current_val - prev
        if abs(delta) < 0.3:
            return "stable"
        return f"rising (+{delta:.1f})" if delta > 0 else f"falling ({delta:.1f})"

    trend_temp  = trend("temperature",  temp)
    trend_vib   = trend("vibration_hz", vib)
    trend_power = trend("power_w",      power)

    # --- Build history block ---
    if len(history) > 1:
        history_lines = []
        for i, r in enumerate(history[:-1]):
            history_lines.append(
                f"  {i+1}. Temp: {r.get('temperature')}°C  "
                f"Hum: {r.get('humidity')}%  "
                f"Vib: {float(r.get('vibration_hz', 0)):.1f} Hz  "
                f"Power: {float(r.get('power_w', 0)):.0f}W"
            )
        history_str = "\n".join(history_lines)
    else:
        history_str = "  No prior readings yet."

    prompt = f"""You are an IIoT motor health monitoring AI agent. Analyse multi-sensor data and identify failure patterns.
MOTOR BASELINES (healthy idle):
  Temperature: {BASELINE['temperature']}°C | Humidity: {BASELINE['humidity']}% | Vibration: {BASELINE['vibration_hz']} Hz | Power: {BASELINE['power_w']} W
CURRENT READING — {current.get('device_id')}:
  Temperature:  {temp}°C  (deviation: {d_temp:+.1f}°C, trend: {trend_temp})
  Humidity:     {hum}%
  Vibration:    {vib:.2f} Hz  (deviation: {d_vib:+.1f} Hz, trend: {trend_vib})
  Power Draw:   {power:.1f} W  (deviation: {d_power:+.0f} W, trend: {trend_power})
TRIGGER: {trigger_reason}
RECENT HISTORY (oldest → newest):
{history_str}
YOUR TASK — focus your analysis specifically on: {primary_focus}
1. State severity: NORMAL / WARNING / CRITICAL
2. In 2 sentences, describe what the combined signal pattern and trend suggest about motor condition. Emphasise the primary focus area.
3. Give ONE specific, actionable recommendation for the maintenance team.
Rules: plain text only, no markdown, no bullet points, under 100 words total."""

    try:
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.75, "top_p": 0.9}   # ← prevents repetitive outputs
        )
        return response["message"]["content"].strip()
    except Exception as e:
        return f"[Agent Error] Ollama call failed: {e}"

# -----------------------------------------------
# MQTT CALLBACKS
# -----------------------------------------------
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[MQTT]  ✅ Connected to broker at {MQTT_BROKER}:{MQTT_PORT}")
        client.subscribe(MQTT_TOPIC)
        print(f"[MQTT]  📡 Subscribed to: {MQTT_TOPIC}")
        print(f"[Agent] 🤖 Model: {OLLAMA_MODEL}")
        print(f"[Agent] 🔧 Correlation trigger: ≥{CORRELATION_MIN_SIGNALS} signals deviating simultaneously")
        print(f"[Agent] ⏱️  Backoff: base={COOLDOWN_BASE_SECONDS}s × {COOLDOWN_MULTIPLIER} per alert, cap={COOLDOWN_MAX_SECONDS}s")
        print("-" * 65)
    else:
        print(f"[MQTT]  ❌ Connection failed. Return code: {rc}")


def on_message(client, userdata, msg):
    global reading_history

    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except json.JSONDecodeError:
        print(f"[ERROR] Cannot parse payload: {msg.payload}")
        return

    temp  = float(payload.get("temperature",  0))
    hum   = float(payload.get("humidity",     0))
    vib   = float(payload.get("vibration_hz", 0))
    power = float(payload.get("power_w",      0))

    print(
        f"[Sensor] 📊 {payload.get('device_id')} | "
        f"T: {temp}°C  H: {hum}%  "
        f"Vib: {vib:.1f}Hz  Pwr: {power:.0f}W"
    )

    # Update rolling history
    reading_history.append(payload)
    if len(reading_history) > MAX_HISTORY:
        reading_history.pop(0)

    # Evaluate signal triggers
    trigger, reason, severity = evaluate_triggers(payload)

    if not trigger:
        # Normal reading — notify cooldown manager so it can reset if sustained
        cooldown.record_normal()
        print(f"         ✅ All signals nominal.  [{cooldown.status_line()}]")
        return

    # A trigger fired — check cooldown before calling LLM
    allowed, cdm_reason = cooldown.should_call_llm(severity)

    if not allowed:
        # Suppressed — print reason so the viewer sees the backoff working
        print(f"\n  ⚠️  {reason}  [{severity}]")
        print(f"  [Cooldown] 🔇 LLM suppressed — {cdm_reason}")
        print(f"             {cooldown.status_line()}\n")
        return

    # Allowed — fire the LLM
    print(f"\n  ⚠️  {reason}  [{severity}]")
    print(f"  [Cooldown] 🟢 LLM allowed — {cdm_reason}")
    print(f"  [Agent]    🤖 Calling gemma4:4b for correlation analysis...")

    start    = time.time()
    analysis = analyse_with_gemma(payload, reading_history, reason)
    elapsed  = time.time() - start

    # Register the fired alert AFTER the call completes
    cooldown.record_alert(severity)

    print(f"\n  [gemma4 Response — {elapsed:.1f}s]  [{cooldown.status_line()}]\n")
    for line in analysis.splitlines():
        print(f"    {line}")
    print(f"\n{'-' * 65}")


# -----------------------------------------------
# MAIN
# -----------------------------------------------
if __name__ == "__main__":
    print("=" * 65)
    print("  IoT Frontier — Episode 2")
    print("  Multi-Sensor Correlation AI Agent")
    print("  gemma4:4b + ESP32 DHT11 + MQTT")
    print("=" * 65)

    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n[System] Agent stopped by user.")
    except ConnectionRefusedError:
        print(f"[ERROR] Cannot connect to MQTT at {MQTT_BROKER}:{MQTT_PORT}.")
        print("        Is Mosquitto running? → mosquitto -c mosquitto.conf -v")