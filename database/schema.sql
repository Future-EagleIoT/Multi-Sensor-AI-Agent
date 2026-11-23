-- ============================================================================
-- Future Eagle IIoT SaaS — Standalone PostgreSQL 16 + TimescaleDB + pgvector DDL
-- Derived from: infra/postgres/init.sql & backend/alembic/versions/0001_initial_saas_schema.py
-- ============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Dedicated non-superuser role for the FastAPI application (enforces PostgreSQL RLS)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'eagle_app') THEN
        CREATE ROLE eagle_app LOGIN PASSWORD 'eagle_app_password_change_me' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO eagle_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO eagle_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eagle_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eagle_app;

-- ============================================================================
-- 3. Core Multi-Tenant & RBAC Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE,
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'pro',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(160) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'engineer'
        CHECK (role IN ('owner', 'admin', 'engineer', 'technician', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_membership_org_user UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships (org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id);

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'technician'
        CHECK (role IN ('owner', 'admin', 'engineer', 'technician', 'viewer')),
    token VARCHAR(128) NOT NULL UNIQUE,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations (org_id);

-- ============================================================================
-- 4. Factory Hierarchy & Device Inventory
-- ============================================================================

CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    location VARCHAR(255),
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sites_org ON sites (org_id);

CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lines_org_site ON production_lines (org_id, site_id);

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    line_id UUID REFERENCES production_lines(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    asset_type VARCHAR(64) NOT NULL DEFAULT 'motor',
    manufacturer VARCHAR(120),
    model_number VARCHAR(120),
    rated_power_kw DOUBLE PRECISION,
    rated_rpm INTEGER,
    health_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
    maintenance_mode BOOLEAN NOT NULL DEFAULT false,
    last_telemetry_at TIMESTAMPTZ,
    latest_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_org_site ON assets (org_id, site_id);

CREATE TABLE IF NOT EXISTS asset_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
    baseline_temp DOUBLE PRECISION NOT NULL DEFAULT 30.0,
    baseline_humidity DOUBLE PRECISION NOT NULL DEFAULT 55.0,
    baseline_vibration_hz DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    baseline_power_w DOUBLE PRECISION NOT NULL DEFAULT 85.0,
    warn_temp DOUBLE PRECISION NOT NULL DEFAULT 35.0,
    crit_temp DOUBLE PRECISION NOT NULL DEFAULT 37.0,
    warn_humidity DOUBLE PRECISION NOT NULL DEFAULT 75.0,
    crit_humidity DOUBLE PRECISION NOT NULL DEFAULT 80.0,
    warn_vibration_hz DOUBLE PRECISION NOT NULL DEFAULT 17.0,
    crit_vibration_hz DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    warn_power_w DOUBLE PRECISION NOT NULL DEFAULT 115.0,
    crit_power_w DOUBLE PRECISION NOT NULL DEFAULT 130.0,
    corr_min_signals INTEGER NOT NULL DEFAULT 3,
    corr_temp_delta DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    corr_vib_delta DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    corr_power_delta DOUBLE PRECISION NOT NULL DEFAULT 16.0,
    rapid_window INTEGER NOT NULL DEFAULT 3,
    rapid_temp_delta DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    cooldown_base_sec INTEGER NOT NULL DEFAULT 10,
    cooldown_multiplier INTEGER NOT NULL DEFAULT 2,
    cooldown_max_sec INTEGER NOT NULL DEFAULT 120,
    normal_reset_readings INTEGER NOT NULL DEFAULT 3,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_org ON asset_profiles (org_id);

CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    device_uid VARCHAR(80) NOT NULL,
    protocol VARCHAR(32) NOT NULL DEFAULT 'mqtt',
    firmware_version VARCHAR(32),
    cert_cn VARCHAR(180) NOT NULL UNIQUE,
    cert_fingerprint VARCHAR(128),
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(32) NOT NULL DEFAULT 'provisioned',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_device_org_uid UNIQUE (org_id, device_uid)
);
CREATE INDEX IF NOT EXISTS idx_devices_org_asset ON devices (org_id, asset_id);

-- ============================================================================
-- 5. Time-Series Telemetry (TimescaleDB Hypertable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sensor_readings (
    time TIMESTAMPTZ NOT NULL,
    org_id UUID NOT NULL,
    device_id UUID NOT NULL,
    asset_id UUID,
    temperature DOUBLE PRECISION,
    humidity DOUBLE PRECISION,
    vibration_hz DOUBLE PRECISION,
    power_w DOUBLE PRECISION,
    vib_rms_mm_s DOUBLE PRECISION,
    iso_zone VARCHAR(8),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (time, org_id, device_id)
);

SELECT create_hypertable(
    'sensor_readings',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => true
);

CREATE INDEX IF NOT EXISTS idx_readings_org_asset_time ON sensor_readings (org_id, asset_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_readings_org_device_time ON sensor_readings (org_id, device_id, time DESC);

-- ============================================================================
-- 6. Operations, AI Diagnostics, RAG Manuals, Webhooks & Audit Logs
-- ============================================================================

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('WARNING', 'CRITICAL')),
    status VARCHAR(24) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resolved', 'false_positive')),
    trigger_reason TEXT NOT NULL,
    trigger_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (ai_status IN ('pending', 'completed', 'fallback')),
    ai_diagnosis JSONB,
    ai_feedback SMALLINT CHECK (ai_feedback IN (-1, 1)),
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_org_status_time ON alerts (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_org_asset ON alerts (org_id, asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    priority VARCHAR(16) NOT NULL DEFAULT 'high'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(24) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_orders_org ON work_orders (org_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS asset_manuals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manuals_org_asset ON asset_manuals (org_id, asset_id);

CREATE TABLE IF NOT EXISTS manual_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    manual_id UUID NOT NULL REFERENCES asset_manuals(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    section_title VARCHAR(200),
    content TEXT NOT NULL,
    embedding vector(384) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_org_asset ON manual_chunks (org_id, asset_id);

CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    url VARCHAR(512) NOT NULL,
    secret VARCHAR(128),
    events JSONB NOT NULL DEFAULT '["alert.created", "device.offline"]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks (org_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(64),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_logs (org_id, created_at DESC);

-- ============================================================================
-- 7. Strict Multi-Tenant Row-Level Security (RLS)
-- ============================================================================

DO $$
DECLARE
    tbl TEXT;
    tenant_tables TEXT[] := ARRAY[
        'invitations',
        'sites',
        'production_lines',
        'assets',
        'asset_profiles',
        'devices',
        'sensor_readings',
        'alerts',
        'work_orders',
        'asset_manuals',
        'manual_chunks',
        'webhooks',
        'audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', tbl, tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I '
            'USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid) '
            'WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
            tbl, tbl
        );
    END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eagle_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eagle_app;

-- ============================================================================
-- 8. EMQX PostgreSQL Dynamic Authorization (MQTT Topic ACL View)
-- ============================================================================

CREATE OR REPLACE VIEW mqtt_acl AS
SELECT
    'service:ingestor'::text AS username,
    'all'::text AS action,
    'allow'::text AS permission,
    'tenants/#'::text AS topic
UNION ALL
SELECT
    d.cert_cn::text AS username,
    'publish'::text AS action,
    'allow'::text AS permission,
    ('tenants/' || o.slug || '/devices/' || d.device_uid || '/#')::text AS topic
FROM devices d
JOIN organizations o ON o.id = d.org_id
WHERE d.is_revoked = false
UNION ALL
SELECT
    d.cert_cn::text AS username,
    'subscribe'::text AS action,
    'allow'::text AS permission,
    ('tenants/' || o.slug || '/devices/' || d.device_uid || '/cmd/#')::text AS topic
FROM devices d
JOIN organizations o ON o.id = d.org_id
WHERE d.is_revoked = false;
