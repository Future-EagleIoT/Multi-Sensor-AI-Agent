-- Initial database setup for Future Eagle IIoT SaaS (runs once on fresh volume)
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Dedicated non-superuser role for the FastAPI app so PostgreSQL Row-Level Security (RLS)
-- is ALWAYS enforced on tenant-scoped queries.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'eagle_app') THEN
    CREATE ROLE eagle_app LOGIN PASSWORD 'eagle_app_password_change_me' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE future_eagle_saas TO eagle_app;
GRANT USAGE ON SCHEMA public TO eagle_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eagle_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eagle_app;

-- Bootstrap mqtt_acl view so EMQX Postgres Authorizer initializes cleanly on first boot.
-- Milestone 2 Alembic migration replaces this view with a live join over organizations & devices.
CREATE OR REPLACE VIEW mqtt_acl AS
SELECT
  'service:ingestor'::text AS username,
  'all'::text AS action,
  'allow'::text AS permission,
  'tenants/#'::text AS topic;
