# Future Eagle IIoT — Multi-Tenant Industrial Predictive Maintenance SaaS

Full-stack Industrial IoT (IIoT) predictive-maintenance SaaS running **100% locally on `localhost`** with **zero AWS and zero Cloudflare dependencies**, engineered to deploy 1:1 to Hetzner / Scaleway / DigitalOcean + Coolify.

## What's Inside

| Layer | Technology (Zero AWS / Zero Cloudflare) | Local Access |
|---|---|---|
| **Web Control Room** | Vite + React 19 + TypeScript + Tailwind CSS + Apache ECharts (via Nginx) | `http://localhost:8080` |
| **Core SaaS API & WebSockets** | Python 3.12 + FastAPI + Argon2id JWT + RBAC + OpenAPI Docs | `http://localhost:8080/docs` |
| **Time-Series + Vector DB** | PostgreSQL 16 + TimescaleDB Hypertables + `pgvector` + strict **Row-Level Security (RLS)** | `localhost:5432` |
| **Multi-Tenant MQTT Broker** | EMQX 5.8 (mTLS-only on `:8883`, dynamic PostgreSQL ACLs, LWT presence) | `http://localhost:18083` (`admin` / `eagle_emqx_admin`) |
| **Stream & Job Buffer** | NATS JetStream (decouples MQTT ingestion from DB writes & LLM calls) | `localhost:4222` / `:8222` |
| **State & Cooldown Store** | Valkey 8 (isolated per-device sliding windows, exponential backoff cooldowns, pub/sub) | `localhost:6379` |
| **Object Storage (S3 API)** | Self-hosted MinIO (`pgsty/minio`) for manuals & PDF reports (swap to Hetzner/Scaleway/B2 in prod) | `http://localhost:9001` |
| **Local Email Catcher** | Mailpit (captures team invites & critical alert emails locally) | `http://localhost:8025` |
| **AI Diagnostic Copilot** | Async `pgvector` manual RAG + pluggable LLM (`mock` \| `gemini` \| `mistral` \| `ollama`) | Configured via `.env.saas` |
| **Field Ops Mobile App** | Expo React Native (`mobile_app/`) connected to FastAPI + WebSockets | `cd mobile_app && npx expo start` |
| **Edge Firmware** | Hardened ESP32 node (`firmware/esp32_sensor_node/`) with `WiFiClientSecure` mTLS, LWT, WDT, NTP | Flash via Arduino IDE / PlatformIO |

---

## Localhost Quickstart (4 Commands)

### 1. Generate SAN-Compliant PKI Certificates & Local Env
```bash
make init
```
Generates a Root CA, a SAN-compliant EMQX broker certificate (`localhost`, `emqx`, `127.0.0.1`, plus your host LAN IP), an ingestor service certificate (`CN=service:ingestor`), and copies `.env.saas.example` → `.env.saas`.

### 2. Boot the Full Localhost SaaS Stack
```bash
make up
```
Builds and starts PostgreSQL/TimescaleDB, Valkey, NATS JetStream, EMQX, Object Storage, Mailpit, FastAPI API, MQTT Ingestor, Per-Device Rules Engine, AI Copilot Worker, Web Control Room, and Nginx Gateway (`http://localhost:8080`).

### 3. Run Database Migrations & Seed 2 Isolated Demo Factories
```bash
make migrate
make seed
```
Seeds two completely isolated tenants with 6 machines, unique X.509 mTLS certificates, and pre-indexed `pgvector` maintenance manuals:

| Account | Email | Password | Scope |
|---|---|---|---|
| **Multi-Factory Admin** | `admin@future-eagle.io` | `DemoPassword123!` | Switch between **Acme Packaging** & **Nordic Cold Storage** |
| **Acme Packaging Manager** | `manager@acme-plant.io` | `DemoPassword123!` | Isolated to Acme Packaging (Porto) |
| **Nordic Cold Engineer** | `ops@nordic-cold.io` | `DemoPassword123!` | Isolated to Nordic Cold Storage (Gothenburg) |

### 4. Start the Virtual Multi-Factory Simulator & Inject Live Faults
```bash
make sim
```
Connects 6 virtual machines across both factories over verified mTLS (`:8883`). Now open **`http://localhost:8080`** and trigger live industrial faults:

```bash
# Multi-signal bearing wear correlation (triggers RAG AI diagnosis + Mailpit alert email!)
make fault DEVICE=acme-motor-01 TYPE=bearing_wear TTL=60

# Sudden overheat on Nordic Cold Storage compressor (strictly isolated from Acme!)
make fault DEVICE=nordic-comp-01 TYPE=overheat TTL=45

# Simulate power loss (triggers MQTT Last Will & Testament -> OFFLINE status)
make fault DEVICE=acme-pump-02 TYPE=offline TTL=30

# Clear active fault
make fault DEVICE=acme-motor-01 TYPE=clear
```

Check captured alert & invite emails at **`http://localhost:8025`** (Mailpit).

---

## Running Automated Tests & Resource Check

```bash
# Unit tests (ISO 20816, correlation rules, per-device cooldowns) + Multi-tenant RLS integration tests
make test

# Check live RAM / CPU usage across all containers
make stats
```

---

## Switching AI Copilot Provider

Edit `.env.saas` and restart `ai-worker` (`docker compose --env-file .env.saas up -d ai-worker`):
- **Default (`LLM_PROVIDER=mock`)**: Deterministic, grounded structured JSON diagnostics (0 MB extra RAM).
- **Google Gemini (`LLM_PROVIDER=gemini`)**: Set `GEMINI_API_KEY=...` (zero AWS / zero Cloudflare).
- **Mistral AI (`LLM_PROVIDER=mistral`)**: Set `MISTRAL_API_KEY=...` (EU sovereign AI).
- **Local Ollama (`LLM_PROVIDER=ollama`)**: Start optional profile `docker compose --env-file .env.saas --profile local-ai up -d` and pull a lightweight model (`docker exec eagle-ollama ollama pull qwen2.5:1.5b`).

---

## Connecting a Physical ESP32 & Mobile App

1. **ESP32 (`firmware/esp32_sensor_node/`):**
   - Copy `secrets.example.h` → `secrets.h` (gitignored).
   - Provision a device in **Web Control Room → Devices & PKI** and paste its `ca.crt`, `client.crt`, and `client.key` along with your LAN IP (`MQTT_BROKER`) into `secrets.h`.
   - Flash `esp32_sensor_node.ino` to your ESP32 (DHT11 on GPIO4, 115200 baud).
2. **Mobile App (`mobile_app/`):**
   ```bash
   cd mobile_app
   cp .env.example .env   # Set EXPO_PUBLIC_API_URL=http://<YOUR_LAN_IP>:8080/api/v1
   npm install
   npx expo start
   ```

---

## Deploying to Production (Zero AWS / Zero Cloudflare)

This stack maps 1:1 to production with no architectural rewrites:
1. **Compute:** Deploy this `docker-compose.yml` onto **Hetzner Cloud** / **Scaleway** / **DigitalOcean** using **Coolify** or **Dokploy**.
2. **DNS, CDN & WAF:** Point your domain through **Bunny.net** (Bunny DNS + Bunny Shield) and terminate TLS with **Caddy** + **CrowdSec**.
3. **Object Storage:** Swap `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` in `.env.saas` to **Hetzner Object Storage**, **Scaleway Object Storage**, or **Backblaze B2**.
4. **Email & SMS:** Swap `SMTP_*` from Mailpit to **Brevo** or **Postmark**, and add **Telnyx** / **Vonage** webhooks for 24/7 critical escalation.
5. **Backups:** Run encrypted daily `pg_dump` / `pgBackRest` archives to **Hetzner Storage Box** or **Backblaze B2**.
