-- Supabase Schema for Multi-Sensor AI Agent (fresh installs)
-- After creating a project, run this file, then optionally migrations/002_mobile_app.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Devices Table
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_name TEXT NOT NULL UNIQUE,
  device_type TEXT DEFAULT 'motor',
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Sensor Readings Table (Time-Series)
CREATE TABLE IF NOT EXISTS sensor_readings (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  temperature FLOAT,
  humidity FLOAT,
  vibration_hz FLOAT,
  power_w FLOAT,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_timestamp ON sensor_readings (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_id ON sensor_readings (device_id);

-- 3. Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('NORMAL', 'WARNING', 'CRITICAL')),
  message TEXT,
  is_resolved BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_device_id ON alerts (device_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts (is_resolved, timestamp DESC)
  WHERE is_resolved = false;

-- 4. Row Level Security
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Data API grants
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON TABLE devices, sensor_readings, alerts TO authenticated, anon;
GRANT UPDATE (is_resolved) ON TABLE alerts TO authenticated;
GRANT INSERT ON TABLE devices, sensor_readings, alerts TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

DROP POLICY IF EXISTS "Allow authenticated read access" ON devices;
DROP POLICY IF EXISTS "Allow authenticated read access" ON sensor_readings;
DROP POLICY IF EXISTS "Allow authenticated read access" ON alerts;
DROP POLICY IF EXISTS "Allow anon read access" ON devices;
DROP POLICY IF EXISTS "Allow anon read access" ON sensor_readings;
DROP POLICY IF EXISTS "Allow anon read access" ON alerts;
DROP POLICY IF EXISTS "Allow service_role insert" ON sensor_readings;
DROP POLICY IF EXISTS "Allow service_role insert" ON alerts;
DROP POLICY IF EXISTS "Allow authenticated resolve alerts" ON alerts;
DROP POLICY IF EXISTS "Allow service_role device insert" ON devices;
DROP POLICY IF EXISTS "Allow service_role device update" ON devices;

-- Single-tenant lab policies (tighten with org_id for SaaS)
CREATE POLICY "Allow authenticated read access" ON devices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read access" ON sensor_readings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read access" ON alerts
  FOR SELECT TO authenticated USING (true);

-- Anon read for signed-out / public dashboard demos (disable in production SaaS)
CREATE POLICY "Allow anon read access" ON devices
  FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read access" ON sensor_readings
  FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read access" ON alerts
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow service_role insert" ON sensor_readings
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Allow service_role insert" ON alerts
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Allow service_role device insert" ON devices
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Allow service_role device update" ON devices
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated resolve alerts" ON alerts
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE sensor_readings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

INSERT INTO devices (device_name, device_type, location)
VALUES ('esp32-motor-01', 'motor', 'Lab Bench')
ON CONFLICT (device_name) DO NOTHING;
