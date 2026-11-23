# Database Folder (`schema.sql`, `seed.sql` & Conception Diagrams)

This folder provides a standalone SQL and visual representation of the **Future Eagle IIoT SaaS** database (PostgreSQL 16 + TimescaleDB + `pgvector`).

## Files

| File | Purpose |
|---|---|
| [schema.sql](./schema.sql) | Complete DDL: extensions (`timescaledb`, `vector`, `pgcrypto`), non-superuser `eagle_app` role, all 16 tables, `sensor_readings` TimescaleDB hypertable, strict `FORCE ROW LEVEL SECURITY` policies on all 13 tenant tables, and the `mqtt_acl` view for EMQX. |
| [seed.sql](./seed.sql) | Deterministic dummy/demo dataset: 2 isolated tenants (`Acme Packaging Co.` & `Nordic Cold Storage`), 3 demo users (password `DemoPassword123!`), sites, production lines, 6 assets + `asset_profiles`, 6 provisioned `devices`, sample `sensor_readings`, an open `alert` + `work_order`, and `asset_manuals` metadata. |
| [conception_diagrams.md](./conception_diagrams.md) | Mermaid Entity-Relationship Diagram (MLD), UML Class Diagram (all 16 domain models), and 3-layer multi-tenant security architecture. |

## How This Relates to `make migrate` & `make seed`

- **Docker/Alembic workflow (recommended for the running app):**
  `make migrate` runs [0001_initial_saas_schema.py](../backend/alembic/versions/0001_initial_saas_schema.py), and `make seed` runs [seed.py](../backend/app/seed.py). `seed.py` additionally generates real X.509 mTLS certificate files in `infra/certs/devices/` and 384-dim `pgvector` embeddings for RAG manual chunks.
- **Standalone SQL workflow (inspecting or loading into a fresh Postgres + TimescaleDB instance):**
  ```bash
  psql -U eagle_admin -d future_eagle_saas -v ON_ERROR_STOP=1 -f database/schema.sql
  psql -U eagle_admin -d future_eagle_saas -v ON_ERROR_STOP=1 -f database/seed.sql
  ```

## Demo Accounts Seeded by `seed.sql` (Password: `DemoPassword123!`)

| Role / Scope | Email |
|---|---|
| Multi-Factory Admin (both orgs) | `admin@future-eagle.io` |
| Acme Packaging Co. Owner | `manager@acme-plant.io` |
| Nordic Cold Storage Owner | `ops@nordic-cold.io` |
