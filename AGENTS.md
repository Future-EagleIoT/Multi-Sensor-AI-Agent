# AGENTS.md — Multi-Sensor AI Agent

IIoT motor monitor: ESP32 (`esp32_dht11.ino`) → Mosquitto MQTT TLS → `multi_sensors_agent.py` (rules + local LLM) → Supabase → Expo app (`mobile_app/`). Canonical docs: `README.md` (setup), `Skills.md` (full build playbook).

## Bring-up order (matters)

```bash
./generate_certs.sh          # needs OpenSSL; output gitignored under mosquitto/config/certs/
docker-compose up -d         # Mosquitto, TLS-only 8883 per mosquitto/config/mosquitto.conf
pip install -r requirements.txt
ollama pull gemma4:4b        # agent default OLLAMA_MODEL is `gemma4:latest` — set env to match
cp .env.example .env         # fill SUPABASE_URL + SUPABASE_KEY (service-role, agent only)
python multi_sensors_agent.py
# mobile (separate shell):
cd mobile_app && cp .env.example .env && npm install && npx expo start
```

## Gotchas agents miss

- **Two env files, two keys:** root `.env` = Supabase **service-role** key (agent ETL inserts). `mobile_app/.env` = `EXPO_PUBLIC_SUPABASE_URL` + **anon** key only. Never put service-role in the app; never commit either file.
- **Firmware ≠ local broker by default:** `esp32_dht11.ino` is hardcoded to `broker.emqx.io:1883` (plaintext) and contains committed WiFi creds — replace before flashing for local runs, and note DHT11 pin is **GPIO4**, 5s publish interval, 115200 baud serial.
- **TLS is mandatory locally:** broker has `require_certificate true` / `allow_anonymous false`. Agent uses `tls_insecure_set(True)` for self-signed localhost certs — dev-only, tighten for prod domains.
- **Vibration/power are simulated** on the ESP32 (correlated to real temp) and tagged via `sim_sensors: "vibration,power_w"` → stored in `sensor_readings.metadata`. Do not "fix" as a bug; replace with real sensors only as a feature.
- **`device_id` is TEXT** (`esp32-motor-01`), not the `devices.id` UUID FK. Topic default `future_eagle_iot/sensors/motor01`.
- **Agent logic contract** (`multi_sensors_agent.py`): every MQTT message is INSERTed to `sensor_readings` first; `evaluate_triggers` order is hard thresholds (→CRITICAL) → ≥3-signal correlation (→WARNING) → rapid temp change ≥3°C/3 readings (→WARNING); LLM (`ollama.chat`, plain text, <100 words) fires only if `AlertCooldownManager` allows (base 10s ×2, cap 120s, reset after 3 NORMALs, severity escalation always fires).
- **Supabase:** fresh projects run `supabase/schema.sql`; existing ones also run `supabase/migrations/002_mobile_app.sql`. Enable Realtime on `sensor_readings` + `alerts`. RLS is single-tenant demo (`USING (true)` reads); add `org_id` scoping before any multi-tenant use.
- **Mobile:** Expo ~53 / React 19 / RN 0.79.2; tabs Live·Alerts·History·Devices·Settings; realtime on both tables; authenticated users may only UPDATE `alerts.is_resolved`.

## Conventions

- No Python/ESP32 tests, linter, formatter, or CI. Mobile has `npm run lint` (no eslint config shipped) — prefer `npx expo start` smoke test over assuming lint passes.
- Tune detection via constants in `multi_sensors_agent.py` (`BASELINE`, `THRESHOLDS`, `CORRELATION_*`, `COOLDOWN_*`), not prompt edits.
- Keep `Skills.md` §15 security rules: no secrets/certs in git, private broker + mTLS beyond lab demos, rotate anything ever committed.
