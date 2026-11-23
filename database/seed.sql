-- ============================================================================
-- Future Eagle IIoT SaaS — Deterministic Dummy / Demo Dataset (PostgreSQL)
-- Mirrors backend/app/seed.py for standalone SQL inspection or fresh DB loads.
--
-- Note:
--   1. All demo users share password: DemoPassword123!
--   2. Running `make seed` (backend/app/seed.py) additionally generates real
--      X.509 mTLS certificate files under infra/certs/devices/ and 384-dim
--      pgvector embeddings in manual_chunks.
-- ============================================================================

BEGIN;

-- 1. Organizations (2 strictly isolated factory tenants)
INSERT INTO organizations (id, name, slug, plan_tier) VALUES
    ('11111111-1111-4111-8111-111111111101', 'Acme Packaging Co.',  'acme-packaging', 'pro'),
    ('11111111-1111-4111-8111-111111111102', 'Nordic Cold Storage', 'nordic-cold',    'pro')
ON CONFLICT (slug) DO NOTHING;

-- 2. Users (Argon2id hash for DemoPassword123!)
INSERT INTO users (id, email, full_name, password_hash, is_active) VALUES
    ('22222222-2222-4222-8222-222222222201', 'admin@future-eagle.io', 'Platform Admin (Multi-Factory Demo)',
     '$argon2id$v=19$m=65536,t=3,p=4$bQyUu1bPO7clvzukounQOQ$2fXO/g6tah+fWAhA0c4QV/uZQrpogOwUWwzc5ehJaRw', true),
    ('22222222-2222-4222-8222-222222222202', 'manager@acme-plant.io', 'Elena Rostova (Acme Plant Mgr)',
     '$argon2id$v=19$m=65536,t=3,p=4$bQyUu1bPO7clvzukounQOQ$2fXO/g6tah+fWAhA0c4QV/uZQrpogOwUWwzc5ehJaRw', true),
    ('22222222-2222-4222-8222-222222222203', 'ops@nordic-cold.io',    'Soren Lindqvist (Nordic Reliability Eng)',
     '$argon2id$v=19$m=65536,t=3,p=4$bQyUu1bPO7clvzukounQOQ$2fXO/g6tah+fWAhA0c4QV/uZQrpogOwUWwzc5ehJaRw', true)
ON CONFLICT (email) DO NOTHING;

-- 3. Memberships (RBAC)
INSERT INTO memberships (id, org_id, user_id, role) VALUES
    ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111101', '22222222-2222-4222-8222-222222222201', 'owner'),
    ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111102', '22222222-2222-4222-8222-222222222201', 'owner'),
    ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111101', '22222222-2222-4222-8222-222222222202', 'owner'),
    ('33333333-3333-4333-8333-333333333304', '11111111-1111-4111-8111-111111111102', '22222222-2222-4222-8222-222222222203', 'owner')
ON CONFLICT (org_id, user_id) DO NOTHING;

-- 4. Sites
INSERT INTO sites (id, org_id, name, location, timezone) VALUES
    ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111101', 'Porto Packaging Plant', 'Porto, Portugal',    'Europe/Lisbon'),
    ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111102', 'Gothenburg Cold Hub',   'Gothenburg, Sweden', 'Europe/Stockholm')
ON CONFLICT (id) DO NOTHING;

-- 5. Production Lines
INSERT INTO production_lines (id, org_id, site_id, name, description) VALUES
    ('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111101', '44444444-4444-4444-8444-444444444401', 'Bottling Line A',     'High-speed bottle filling and palletizing line'),
    ('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111102', '44444444-4444-4444-8444-444444444402', 'Blast Freezer Bank 1', 'Primary ammonia refrigeration & glycol loop')
ON CONFLICT (id) DO NOTHING;

-- 6. Assets (6 machines across 2 tenants)
INSERT INTO assets (id, org_id, site_id, line_id, name, asset_type, manufacturer, model_number, rated_power_kw, rated_rpm, health_status, latest_metrics) VALUES
    ('66666666-6666-4666-8666-666666666601', '11111111-1111-4111-8111-111111111101', '44444444-4444-4444-8444-444444444401', '55555555-5555-4555-8555-555555555501',
     'Conveyor Drive Motor #1',    'motor',      'Siemens',   '1LE1001-1CB2', 15.0, 1470, 'NOMINAL', '{"temperature": 30.2, "humidity": 52.0, "vibration_hz": 12.1, "power_w": 85.4, "vib_rms_mm_s": 1.35, "iso_zone": "A"}'::jsonb),
    ('66666666-6666-4666-8666-666666666602', '11111111-1111-4111-8111-111111111101', '44444444-4444-4444-8444-444444444401', '55555555-5555-4555-8555-555555555501',
     'Bottle Filler Main Pump',    'pump',       'Grundfos',  'CRN 32-4',     11.0, 2900, 'NOMINAL', '{"temperature": 31.1, "humidity": 56.0, "vibration_hz": 11.2, "power_w": 92.0, "vib_rms_mm_s": 1.24, "iso_zone": "A"}'::jsonb),
    ('66666666-6666-4666-8666-666666666603', '11111111-1111-4111-8111-111111111101', '44444444-4444-4444-8444-444444444401', '55555555-5555-4555-8555-555555555501',
     'Palletizer Hydraulic Motor', 'motor',      'ABB',       'M3BP 160MLB',  18.5, 1480, 'NOMINAL', '{"temperature": 29.6, "humidity": 50.0, "vibration_hz": 12.4, "power_w": 88.2, "vib_rms_mm_s": 1.27, "iso_zone": "A"}'::jsonb),
    ('66666666-6666-4666-8666-666666666604', '11111111-1111-4111-8111-111111111102', '44444444-4444-4444-8444-444444444402', '55555555-5555-4555-8555-555555555502',
     'Ammonia Screw Compressor #1','compressor', 'Bitzer',    'OSKA-7461-K',  45.0, 2950, 'NOMINAL', '{"temperature": 28.2, "humidity": 48.0, "vibration_hz": 11.4, "power_w": 110.5, "vib_rms_mm_s": 1.24, "iso_zone": "A"}'::jsonb),
    ('66666666-6666-4666-8666-666666666605', '11111111-1111-4111-8111-111111111102', '44444444-4444-4444-8444-444444444402', '55555555-5555-4555-8555-555555555502',
     'Evaporator Condenser Fan A', 'fan',        'ebm-papst', 'W3G910',        7.5,  980, 'NOMINAL', '{"temperature": 26.1, "humidity": 58.0, "vibration_hz": 10.1, "power_w": 65.2, "vib_rms_mm_s": 1.20, "iso_zone": "A"}'::jsonb),
    ('66666666-6666-4666-8666-666666666606', '11111111-1111-4111-8111-111111111102', '44444444-4444-4444-8444-444444444402', '55555555-5555-4555-8555-555555555502',
     'Glycol Chiller Loop Pump',   'chiller',    'KSB',       'Etanorm 80-65',22.0, 1475, 'NOMINAL', '{"temperature": 27.6, "humidity": 54.0, "vibration_hz": 11.1, "power_w": 95.3, "vib_rms_mm_s": 1.23, "iso_zone": "A"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 7. Asset Threshold & Baseline Profiles
INSERT INTO asset_profiles (
    id, org_id, asset_id,
    baseline_temp, baseline_vibration_hz, baseline_power_w,
    warn_temp, crit_temp, warn_vibration_hz, crit_vibration_hz, warn_power_w, crit_power_w
) VALUES
    ('77777777-7777-4777-8777-777777777701', '11111111-1111-4111-8111-111111111101', '66666666-6666-4666-8666-666666666601', 30.0, 12.0,  85.0, 35.0, 37.0, 17.0, 20.0, 115.0, 130.0),
    ('77777777-7777-4777-8777-777777777702', '11111111-1111-4111-8111-111111111101', '66666666-6666-4666-8666-666666666602', 31.0, 11.0,  92.0, 36.0, 39.0, 16.5, 19.5, 122.0, 140.0),
    ('77777777-7777-4777-8777-777777777703', '11111111-1111-4111-8111-111111111101', '66666666-6666-4666-8666-666666666603', 29.5, 12.5,  88.0, 35.5, 38.0, 17.5, 20.5, 118.0, 135.0),
    ('77777777-7777-4777-8777-777777777704', '11111111-1111-4111-8111-111111111102', '66666666-6666-4666-8666-666666666604', 28.0, 11.5, 110.0, 34.0, 36.5, 16.5, 19.5, 140.0, 160.0),
    ('77777777-7777-4777-8777-777777777705', '11111111-1111-4111-8111-111111111102', '66666666-6666-4666-8666-666666666605', 26.0, 10.0,  65.0, 32.0, 35.0, 15.5, 18.5,  90.0, 105.0),
    ('77777777-7777-4777-8777-777777777706', '11111111-1111-4111-8111-111111111102', '66666666-6666-4666-8666-666666666606', 27.5, 11.0,  95.0, 33.5, 36.0, 16.0, 19.0, 125.0, 145.0)
ON CONFLICT (asset_id) DO NOTHING;

-- 8. Provisioned mTLS Devices
INSERT INTO devices (id, org_id, asset_id, device_uid, protocol, firmware_version, cert_cn, is_revoked, status) VALUES
    ('88888888-8888-4888-8888-888888888801', '11111111-1111-4111-8111-111111111101', '66666666-6666-4666-8666-666666666601', 'acme-motor-01',   'mqtt', '2.0.0', 'acme-packaging:acme-motor-01', false, 'provisioned'),
    ('88888888-8888-4888-8888-888888888802', '11111111-1111-4111-8111-111111111101', '66666666-6666-4666-8666-666666666602', 'acme-pump-02',    'mqtt', '2.0.0', 'acme-packaging:acme-pump-02',  false, 'provisioned'),
    ('88888888-8888-4888-8888-888888888803', '11111111-1111-4111-8111-111111111101', '66666666-6666-4666-8666-666666666603', 'acme-motor-03',   'mqtt', '2.0.0', 'acme-packaging:acme-motor-03', false, 'provisioned'),
    ('88888888-8888-4888-8888-888888888804', '11111111-1111-4111-8111-111111111102', '66666666-6666-4666-8666-666666666604', 'nordic-comp-01',  'mqtt', '2.0.0', 'nordic-cold:nordic-comp-01',   false, 'provisioned'),
    ('88888888-8888-4888-8888-888888888805', '11111111-1111-4111-8111-111111111102', '66666666-6666-4666-8666-666666666605', 'nordic-fan-02',   'mqtt', '2.0.0', 'nordic-cold:nordic-fan-02',    false, 'provisioned'),
    ('88888888-8888-4888-8888-888888888806', '11111111-1111-4111-8111-111111111102', '66666666-6666-4666-8666-666666666606', 'nordic-chill-03', 'mqtt', '2.0.0', 'nordic-cold:nordic-chill-03',  false, 'provisioned')
ON CONFLICT (org_id, device_uid) DO NOTHING;

-- 9. Sample Time-Series Sensor Readings (TimescaleDB Hypertable)
INSERT INTO sensor_readings (time, org_id, device_id, asset_id, temperature, humidity, vibration_hz, power_w, vib_rms_mm_s, iso_zone, metadata) VALUES
    ('2026-11-23T09:50:00Z', '11111111-1111-4111-8111-111111111101', '88888888-8888-4888-8888-888888888801', '66666666-6666-4666-8666-666666666601', 30.1, 52.0, 12.0,  85.0, 1.26, 'A', '{"seed": true}'::jsonb),
    ('2026-11-23T09:55:00Z', '11111111-1111-4111-8111-111111111101', '88888888-8888-4888-8888-888888888801', '66666666-6666-4666-8666-666666666601', 35.4, 53.0, 15.8, 106.0, 4.60, 'C', '{"seed": true}'::jsonb),
    ('2026-11-23T09:50:00Z', '11111111-1111-4111-8111-111111111102', '88888888-8888-4888-8888-888888888804', '66666666-6666-4666-8666-666666666604', 28.2, 48.0, 11.4, 110.5, 1.24, 'A', '{"seed": true}'::jsonb)
ON CONFLICT (time, org_id, device_id) DO NOTHING;

-- 10. Sample Alert & Linked Work Order (Acme Packaging Co.)
INSERT INTO alerts (id, org_id, asset_id, device_id, severity, status, trigger_reason, trigger_snapshot, ai_status, ai_diagnosis) VALUES
    (
        '99999999-9999-4999-8999-999999999901',
        '11111111-1111-4111-8111-111111111101',
        '66666666-6666-4666-8666-666666666601',
        '88888888-8888-4888-8888-888888888801',
        'WARNING',
        'open',
        'CORRELATION (3 signals): temp +5.4°C, vib +3.8Hz, power +21W',
        '{"temperature": 35.4, "humidity": 53.0, "vibration_hz": 15.8, "power_w": 106.0, "vib_rms_mm_s": 4.6, "iso_zone": "C"}'::jsonb,
        'completed',
        '{"severity_assessment": "WARNING", "summary": "Conveyor Drive Motor #1 shows correlated multi-signal elevation (+5.4C, +3.8 Hz, +21 W, ISO Zone C).", "probable_root_cause": "Progressive rolling-element bearing wear or shaft misalignment increasing mechanical friction", "confidence": 0.88, "immediate_actions": ["Inspect drive-end SKF 6309-2Z C3 bearing and check lubrication.", "Verify shaft coupling alignment tolerances."], "safety_precaution": "Apply Lockout/Tagout (LOTO) on CB-14 and verify zero voltage before opening guards.", "cited_manual_section": "Section 2: Bearing Maintenance & Vibration Limits (ISO 20816-3)", "provider": "seed"}'::jsonb
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_orders (id, org_id, asset_id, alert_id, title, description, priority, status, created_by) VALUES
    (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
        '11111111-1111-4111-8111-111111111101',
        '66666666-6666-4666-8666-666666666601',
        '99999999-9999-4999-8999-999999999901',
        '[WARNING] Inspect Conveyor Drive Motor #1 DE Bearing',
        'Check SKF 6309-2Z C3 bearing grease and coupling alignment per Section 2.',
        'high',
        'open',
        '22222222-2222-4222-8222-222222222202'
    )
ON CONFLICT (id) DO NOTHING;

-- 11. Sample Asset Manual Metadata
INSERT INTO asset_manuals (id, org_id, asset_id, filename, storage_key, chunk_count, uploaded_by) VALUES
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', '11111111-1111-4111-8111-111111111101', '66666666-6666-4666-8666-666666666601',
     'Siemens_1LE1_Motor_Manual.md', 'tenants/acme-packaging/manuals/66666666-6666-4666-8666-666666666601/Siemens_1LE1_Motor_Manual.md', 3, '22222222-2222-4222-8222-222222222202'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', '11111111-1111-4111-8111-111111111102', '66666666-6666-4666-8666-666666666604',
     'Bitzer_OSKA74_Compressor_Manual.md', 'tenants/nordic-cold/manuals/66666666-6666-4666-8666-666666666604/Bitzer_OSKA74_Compressor_Manual.md', 2, '22222222-2222-4222-8222-222222222203')
ON CONFLICT (id) DO NOTHING;

COMMIT;
