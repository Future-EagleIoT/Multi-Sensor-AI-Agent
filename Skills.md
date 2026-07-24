# Skills.md — Build the Multi-Sensor AI Agent (End to End)

This document is a complete, step-by-step playbook for building, configuring, running, and extending the **Future Eagle IoT Multi-Sensor AI Agent**.

It captures the as-built system: ESP32 edge sensing → MQTT (TLS/mTLS) → Python correlation AI agent (Ollama / Gemma) → Supabase → React Native realtime dashboard.

---

## 1. What You Are Building

### Product goal

Industrial IoT motor health monitoring that:

1. Collects multi-sensor telemetry at the edge (temperature, humidity, vibration, power).
2. Transports data securely over MQTT.
3. Detects anomalies with **rules first** (thresholds + multi-signal correlation + rapid change).
4. Calls a **local LLM** only when needed (alert cooldown / backoff).
5. Stores readings and alerts in Supabase.
6. Shows live data on a React Native mobile dashboard.

### Problems this design solves

| Problem | Approach in this app |
|--------|----------------------|
| Single-signal alerts miss failure patterns | Multi-signal correlation (≥3 signals deviate together) |
| Alert fatigue / LLM spam | Exponential backoff cooldown + severity escalation |
| Cloud AI latency / cost / privacy | Local Ollama + Gemma |
| Unencrypted IoT traffic | Mosquitto TLS/mTLS |
| Stale mobile views | Supabase Realtime INSERT subscriptions |

### Repo layout (what each piece does)

```text
Multi-Sensor-AI-Agent/
├── esp32_dht11.ino          # Edge firmware (sense + publish)
├── multi_sensors_agent.py   # MQTT subscriber + triggers + LLM + ETL
├── requirements.txt         # Python deps
├── .env.example             # Agent env template
├── docker-compose.yml       # Mosquitto broker
├── generate_certs.sh        # CA + broker + client certs
├── mosquitto/config/        # Broker config + certs mount
├── supabase/schema.sql      # Postgres tables + RLS
├── mobile_app/              # React Native dashboard
│   ├── App.js
│   └── src/
│       ├── screens/DashboardScreen.js
│       └── services/supabase.js
├── README.md
└── Skills.md                # This playbook
```

---

## 2. Prerequisites

Install before you start:

| Tool | Why |
|------|-----|
| Python 3.8+ | AI agent |
| Docker + Docker Compose | Mosquitto broker |
| OpenSSL | Certificate generation (`generate_certs.sh`) |
| Ollama | Local LLM runtime |
| Node.js + npm | Mobile app |
| Arduino IDE (or PlatformIO) | Flash ESP32 |
| ESP32 board + DHT11 on GPIO4 | Physical sensing |
| Supabase account | Postgres + Realtime |
| Android Studio / Xcode (optional) | Run mobile app on device/emulator |
| Git Bash / WSL (Windows) | Run `generate_certs.sh` |

Arduino libraries for firmware:

- `PubSubClient`
- `DHT sensor library` (Adafruit or compatible)
- `ArduinoJson`

---

## 3. Architecture (mental model)

```text
DHT11 ──► ESP32 firmware ──publish JSON──► MQTT Broker (Mosquitto)
                                              │
                                              ▼ subscribe
                                     Python AI Agent
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
              always INSERT        evaluate triggers     if allowed
              sensor_readings      (threshold / corr /   call Ollama
                                   rapid change)         (Gemma)
                                              │
                                              ▼
                                        INSERT alerts
                                              │
                                              ▼
                                         Supabase
                                              │
                                       Realtime INSERT
                                              │
                                              ▼
                                   React Native Dashboard
```

### Layers

1. **Edge** — `esp32_dht11.ino`
2. **Network** — Mosquitto (`docker-compose.yml`, `mosquitto/config/mosquitto.conf`)
3. **Processing** — `multi_sensors_agent.py` + Ollama
4. **Storage** — Supabase (`supabase/schema.sql`)
5. **Application** — React Native (`mobile_app/`)

---

## 4. Build Order (follow this sequence)

Build in this order so each layer has something to talk to:

1. Supabase schema + keys  
2. MQTT broker + certificates  
3. Python agent + Ollama  
4. ESP32 firmware  
5. Mobile app  
6. End-to-end validation  

---

## 5. Step 1 — Clone and environment

```bash
git clone <your-repo-url>
cd Multi-Sensor-AI-Agent
cp .env.example .env
```

Edit `.env` (never commit secrets):

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY
MQTT_BROKER=localhost
MQTT_PORT=8883
MQTT_TOPIC=future_eagle_iot/sensors/motor01
CA_CERT=./mosquitto/config/certs/ca.crt
CLIENT_CERT=./mosquitto/config/certs/client.crt
CLIENT_KEY=./mosquitto/config/certs/client.key
```

Optional (supported by the agent code):

```env
OLLAMA_MODEL=gemma4:latest
```

---

## 6. Step 2 — Supabase database

### 6.1 Create project

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Paste and run `supabase/schema.sql`.

### 6.2 Schema you create

**`devices`**

- `id` UUID PK
- `device_name` TEXT UNIQUE
- `device_type` TEXT (default `motor`)
- `location` TEXT
- `created_at` timestamptz

**`sensor_readings`** (time-series)

- `id` BIGSERIAL PK
- `device_id` TEXT
- `temperature`, `humidity`, `vibration_hz`, `power_w` FLOAT
- `metadata` JSONB
- `timestamp` timestamptz
- Indexes: `timestamp DESC`, `device_id`

**`alerts`**

- `id` BIGSERIAL PK
- `device_id` TEXT
- `severity` CHECK (`NORMAL` | `WARNING` | `CRITICAL`)
- `message` TEXT
- `is_resolved` BOOLEAN default false
- `timestamp` timestamptz

### 6.3 RLS policies (as shipped)

- RLS enabled on all three tables.
- `authenticated` can `SELECT` (currently global `USING (true)` — fine for a single-tenant demo).
- `service_role` can `INSERT` into `sensor_readings` and `alerts`.

### 6.4 Keys to copy

| Key | Used by | Purpose |
|-----|---------|---------|
| Project URL | Agent + Mobile | API endpoint |
| **Service role** key | Python agent only | ETL inserts (keep secret) |
| **Anon** key | Mobile app | Read + Realtime |

Optional seed:

```sql
INSERT INTO devices (device_name, device_type, location)
VALUES ('esp32-motor-01', 'motor', 'Lab Bench');
```

> Note: the agent stores `device_id` as a string matching firmware (`esp32-motor-01`), not necessarily the UUID FK.

Enable Realtime for `sensor_readings` (and ideally `alerts`) in the Supabase dashboard if not already on.

---

## 7. Step 3 — TLS certificates

From repo root (Git Bash / WSL / Linux / macOS):

```bash
chmod +x generate_certs.sh
./generate_certs.sh
```

This creates under `mosquitto/config/certs/`:

| File | Role |
|------|------|
| `ca.key` / `ca.crt` | Local Certificate Authority |
| `broker.key` / `broker.crt` | Mosquitto server identity (`CN=localhost`) |
| `client.key` / `client.crt` | Client identity for agent/device (`CN=esp32-motor-01`) |

Certs are gitignored. Regenerate locally per machine/environment.

---

## 8. Step 4 — MQTT broker (Mosquitto)

### 8.1 Broker config (`mosquitto/config/mosquitto.conf`)

Intended production/dev local config:

- Listen `8883`
- `cafile` / `certfile` / `keyfile` set
- `require_certificate true` (mTLS)
- `use_identity_as_username true`
- `allow_anonymous false`

### 8.2 Start broker

```bash
docker-compose up -d
```

Verify:

```bash
docker ps
docker logs mosquitto
```

Ports:

- `8883` — MQTT over TLS
- `9001` — mapped in compose (WebSocket capability depending on config)

---

## 9. Step 5 — Local LLM (Ollama + Gemma)

```bash
# Install Ollama from https://ollama.com, then:
ollama pull gemma4:4b
# or match whatever OLLAMA_MODEL you set, e.g. gemma4:latest
ollama list
```

Keep Ollama running while the agent is up. The agent calls:

```python
ollama.chat(model=OLLAMA_MODEL, messages=[...], options={"temperature": 0.75, "top_p": 0.9})
```

---

## 10. Step 6 — Python AI agent

### 10.1 Install deps

```bash
pip install -r requirements.txt
```

Contents:

```text
paho-mqtt
ollama
supabase
python-dotenv
```

### 10.2 Run

```bash
python multi_sensors_agent.py
```

You should see MQTT connect + subscribe confirmation.

### 10.3 What the agent does (implement this logic if rebuilding)

#### A. Connect MQTT with optional mTLS

- Read broker/port/topic/certs from env.
- If `CA_CERT` exists → `tls_set(...)`.
- For local self-signed certs the code uses `tls_insecure_set(True)` (dev convenience).
- `loop_forever()` on messages.

#### B. On every message

1. Parse JSON payload.
2. Log `device_id`, temp, humidity, vibration, power.
3. **Always** `INSERT` into `sensor_readings`.
4. Append to rolling `reading_history` (max 5).
5. Call `evaluate_triggers(reading)`.
6. If NORMAL → `cooldown.record_normal()` and return.
7. If triggered → `cooldown.should_call_llm(severity)`.
8. If suppressed → log cooldown reason; do not call LLM.
9. If allowed → `analyse_with_gemma(...)`, `record_alert`, `INSERT` into `alerts`.

#### C. Baselines (healthy idle defaults)

| Signal | Baseline |
|--------|----------|
| temperature | 30.0 °C |
| humidity | 55.0 % |
| vibration_hz | 12.0 Hz |
| power_w | 85.0 W |

#### D. Hard thresholds → CRITICAL

| Signal | Threshold |
|--------|-----------|
| temperature | ≥ 37.0 °C |
| humidity | ≥ 80.0 % |
| vibration_hz | ≥ 20.0 Hz |
| power_w | ≥ 130.0 W |

#### E. Correlation trigger → WARNING

Require **≥ 3** simultaneous deviations:

- temp ≥ baseline + 5.0 °C
- vib ≥ baseline + 2.0 Hz
- power ≥ baseline + 16.0 W

(Humidity is used in hard thresholds / prompt context; correlation set focuses on temp/vib/power.)

#### F. Rapid change → WARNING

- Look at last 3 readings’ temperatures.
- If absolute delta ≥ 3.0 °C → trigger.

#### G. Cooldown manager

| Setting | Value |
|---------|-------|
| Base cooldown | 10 s |
| Multiplier | ×2 per consecutive alert |
| Max cooldown | 120 s |
| Reset after | 3 consecutive NORMAL readings |
| Escalation | Always allow LLM if severity increases |

#### H. LLM prompt contract

Ask Gemma to:

1. State severity: `NORMAL` / `WARNING` / `CRITICAL`
2. Explain combined pattern in ~2 sentences (focus on worst % deviation signal)
3. Give **one** actionable maintenance recommendation
4. Plain text only, no markdown, under 100 words

Store alert `message` as the **first line** of the LLM response (as current code does).

---

## 11. Step 7 — ESP32 firmware

### 11.1 Hardware

- ESP32-WROOM-32
- DHT11 data pin → **GPIO 4**
- Power DHT11 at 3.3V (or per module rating) + GND

### 11.2 Configure before flash (`esp32_dht11.ino`)

Update:

```cpp
const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* MQTT_BROKER   = "YOUR_BROKER_HOST_OR_IP";
const int   MQTT_PORT     = 1883;   // or 8883 when using TLS client
const char* MQTT_TOPIC    = "future_eagle_iot/sensors/motor01";
const char* DEVICE_ID     = "esp32-motor-01";
```

**Security rules when rebuilding:**

- Never commit real Wi-Fi passwords.
- Prefer private Mosquitto + TLS/mTLS for anything beyond a lab demo.
- Public brokers (e.g. demo MQTT clouds) are only for quick connectivity tests.

### 11.3 Firmware behavior to implement

Every **5 seconds**:

1. Read real `temperature` and `humidity` from DHT11.
2. If NaN → log wiring error and skip publish.
3. Simulate vibration from temperature delta vs 30 °C baseline + noise.
4. Simulate power from temperature delta + noise.
5. Build JSON:

```json
{
  "device_id": "esp32-motor-01",
  "temperature": 31.2,
  "humidity": 54.0,
  "vibration_hz": 12.45,
  "power_w": 88.1,
  "sim_sensors": "vibration,power_w",
  "timestamp_ms": 123456
}
```

6. `mqttClient.publish(MQTT_TOPIC, payload)`.

### 11.4 Why simulate vib/power?

The demo proves **multi-signal correlation** even with one physical sensor: as real temperature rises, simulated vibration and power rise with it — mimicking early bearing wear. For production, replace simulations with real accelerometers / current sensors and remove or narrow `sim_sensors`.

### 11.5 Flash

1. Open `esp32_dht11.ino` in Arduino IDE.
2. Select correct ESP32 board + COM port.
3. Install libraries listed in Prerequisites.
4. Upload.
5. Open Serial Monitor at **115200** baud; confirm Wi-Fi + MQTT + publishes.

---

## 12. Step 8 — React Native / Expo mobile app

The mobile client is an **Expo** app under `mobile_app/` with auth, tabs, alerts, history, devices, and realtime.

### 12.1 Configure

```bash
cd mobile_app
cp .env.example .env
# Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (anon key only)
```

Apply `supabase/schema.sql` (fresh) or `supabase/migrations/002_mobile_app.sql` (existing).

### 12.2 Install and run

```bash
npm install
npx expo start
```

### 12.3 App structure

- Auth: Login / Sign up / Guest (AsyncStorage session — Supabase RN pattern)
- Tabs: Live · Alerts · History · Devices · Settings
- Realtime on `sensor_readings` + `alerts`
- Authenticated users can resolve alerts (RLS UPDATE)

See `mobile_app/README.md` for feature details.

### 12.4 (legacy stub notes removed)

Earlier bare RN stub lacked android/ios projects; the Expo app is the supported client.
---

## 13. Step 9 — End-to-end checklist

Run in this order:

1. [ ] Supabase schema applied; URL + keys ready  
2. [ ] Certs generated  
3. [ ] `docker-compose up -d` — Mosquitto healthy  
4. [ ] `ollama pull` + Ollama running  
5. [ ] `.env` filled; `python multi_sensors_agent.py` connected  
6. [ ] ESP32 flashed; Serial shows publishes  
7. [ ] Agent terminal shows `[Sensor]` lines  
8. [ ] Rows appear in Supabase `sensor_readings`  
9. [ ] Mobile app shows live cards  
10. [ ] Force a trigger (heat sensor / lower thresholds temporarily)  
11. [ ] Confirm cooldown behavior and `alerts` rows  

### How to force an AI alert in the lab

- Warm the DHT11 above threshold, **or**
- Temporarily lower `THRESHOLDS` in the agent, **or**
- Publish a test MQTT message with elevated temp/vib/power.

Example test publish shape (same topic/JSON fields the agent expects).

---

## 14. Configuration reference

### Agent env vars

| Variable | Default / example | Purpose |
|----------|-------------------|---------|
| `MQTT_BROKER` | `localhost` | Broker host |
| `MQTT_PORT` | `8883` | TLS port |
| `MQTT_TOPIC` | `future_eagle_iot/sensors/motor01` | Subscribe topic |
| `OLLAMA_MODEL` | `gemma4:latest` | Local model |
| `SUPABASE_URL` | — | Project URL |
| `SUPABASE_KEY` | — | Service role key |
| `CA_CERT` | `./mosquitto/config/certs/ca.crt` | CA |
| `CLIENT_CERT` | `./mosquitto/config/certs/client.crt` | Client cert |
| `CLIENT_KEY` | `./mosquitto/config/certs/client.key` | Client key |

### Tunable constants in `multi_sensors_agent.py`

| Constant | Meaning |
|----------|---------|
| `BASELINE` | Healthy idle values |
| `THRESHOLDS` | Hard limit CRITICAL |
| `CORRELATION_MIN_SIGNALS` | How many signals must deviate |
| `CORRELATION_*_DELTA` | Per-signal deviation sizes |
| `RAPID_CHANGE_WINDOW` / `RAPID_TEMP_DELTA` | Spike detection |
| `COOLDOWN_*` | Backoff behavior |
| `MAX_HISTORY` | Rolling window size (5) |

---

## 15. Security skills (do this correctly)

1. **Never commit** `.env`, certs, Wi-Fi passwords, or service role keys.
2. Agent uses **service role**; mobile uses **anon**.
3. Prefer private broker + mTLS for real deployments.
4. Local agent currently sets `tls_insecure_set(True)` for self-signed localhost — tighten for production domains.
5. Current RLS `USING (true)` for authenticated reads is **single-tenant demo only**. For SaaS, add `org_id` and membership-scoped policies.
6. Rotate any credentials that were ever committed to a public repo.

---

## 16. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Agent `ConnectionRefusedError` | Broker down / wrong port | `docker-compose up -d`; check `MQTT_PORT` |
| TLS handshake fails | Missing/wrong certs | Re-run `generate_certs.sh`; verify paths in `.env` |
| No `[Sensor]` logs | ESP32 offline / topic mismatch | Match `MQTT_TOPIC`; check Serial Monitor |
| DHT NaN | Wiring / power / warm-up | GPIO4 wiring; wait 2s after boot |
| Supabase insert errors | Bad URL/key / RLS | Use service role in agent; confirm policies |
| Mobile empty list | Wrong anon key / no data / Realtime off | Verify client config; check table rows |
| LLM never called | Cooldown suppressing / no trigger | Check severity + cooldown logs; lower thresholds |
| Ollama errors | Model not pulled / daemon down | `ollama list`; restart Ollama |
| Realtime not updating | Channel/table mismatch | Confirm table name `sensor_readings` + Realtime enabled |

---

## 17. Rebuild from scratch (minimal recipe)

If you recreate the project in a new folder:

1. Create the five layers’ files listed in §1.
2. Write `schema.sql` as in §6.
3. Write Mosquitto TLS config + `docker-compose.yml` as in §8.
4. Write `generate_certs.sh` as in §7.
5. Implement agent modules in one file (or split later):
   - config / env
   - `push_to_supabase`
   - `AlertCooldownManager`
   - `evaluate_triggers`
   - `analyse_with_gemma`
   - MQTT callbacks + main
6. Implement firmware publish loop as in §11.
7. Implement RN dashboard as in §12.
8. Validate with §13 checklist.

---

## 18. Natural extensions (next skills)

When the demo works, extend in this order:

1. **Real sensors** for vibration and power (remove simulation).
2. **Alerts UI** on mobile (subscribe to `alerts`, severity badges, resolve).
3. **Auth** (Supabase Auth) before any multi-user use.
4. **Multiple devices** (topic per device; agent wildcard subscribe).
5. **Per-device baselines/thresholds** stored in DB, not constants.
6. **Structured LLM JSON** (`severity`, `diagnosis`, `recommendation`, `confidence`).
7. **Notifications** (email / SMS / Slack / push).
8. **Web console** (Next.js) for fleet ops.
9. **OTA** firmware updates + remote config.
10. **Multi-tenant SaaS** (`organizations`, RLS by membership, billing).

See also the architecture canvases produced in analysis sessions for the SaaS target state.

---

## 19. Design principles to preserve

These are the “skills” that make this app good — keep them when you rewrite modules:

1. **Rules before LLM** — correlation/thresholds decide *when* AI runs.
2. **Cooldown is a feature** — protects cost, latency, and operator attention.
3. **Always store raw telemetry** — even when no alert fires.
4. **Transparent simulation** — `sim_sensors` field documents what is fake.
5. **Local AI option** — privacy and plant-floor latency.
6. **Realtime for operators** — don’t force manual refresh for live health.
7. **Secrets outside source** — env + gitignore.

---

## 20. Quick command sheet

```bash
# Certs
./generate_certs.sh

# Broker
docker-compose up -d
docker logs -f mosquitto

# LLM
ollama pull gemma4:4b
ollama serve   # if not already a system service

# Agent
cp .env.example .env   # then edit
pip install -r requirements.txt
python multi_sensors_agent.py

# Mobile
cd mobile_app
npm install
# edit src/services/supabase.js
npm start
npm run android
```

---

## 21. Definition of done

You have successfully built this app when:

- ESP32 publishes valid JSON on the shared topic every ~5s.
- The Python agent stays connected and logs every reading.
- Supabase receives continuous `sensor_readings`.
- Triggered conditions produce cooldown-aware Gemma analyses and `alerts` rows.
- The React Native app shows new readings without manual reload.

That is the full build skill for the Multi-Sensor AI Agent.
