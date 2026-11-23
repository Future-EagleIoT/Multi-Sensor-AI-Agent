# Mobile App (TypeScript)

Expo React Native (TypeScript) field operations client for the **Future Eagle IIoT SaaS** platform.

## Features

- Multi-tenant JWT authentication & organization switcher (no guest mode, PostgreSQL RLS-enforced)
- Live dashboard with multi-asset selector, backend-authoritative health banner, ISO 20816 zone, and 4-signal grid
- Real-time updates via tenant-scoped FastAPI WebSockets (`/api/v1/ws`)
- Alerts feed with status/severity filters, AI Copilot diagnosis & manual RAG citations, acknowledge & resolve with notes
- Asset telemetry history & provisioned mTLS device inventory

## Setup

1. Ensure the localhost SaaS backend stack is running (`make up && make migrate && make seed && make sim` from the repo root).
2. Configure environment variables:

```bash
cd mobile_app
cp .env.example .env
# Set EXPO_PUBLIC_API_URL=http://<YOUR_LAN_IP>:8080/api/v1 (or http://localhost:8080/api/v1 for Expo Web)
```

3. Install dependencies, typecheck, and run:

```bash
npm install
npm run typecheck
npx expo start
```

### Demo Logins (Password: `DemoPassword123!`)

- Multi-Factory Admin (Org Switcher): `admin@future-eagle.io`
- Acme Packaging Co. only: `manager@acme-plant.io`
- Nordic Cold Storage only: `ops@nordic-cold.io`
