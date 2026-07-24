-- Mobile app support: grants, alert resolve, realtime, device service inserts
-- Run in Supabase SQL Editor after schema.sql (safe to re-run with IF NOT EXISTS patterns)

-- Ensure Data API roles can access tables (required on some Supabase projects)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON TABLE devices, sensor_readings, alerts TO authenticated;
GRANT SELECT ON TABLE devices, sensor_readings, alerts TO anon;
GRANT UPDATE (is_resolved) ON TABLE alerts TO authenticated;
GRANT INSERT ON TABLE devices, sensor_readings, alerts TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Authenticated users can resolve alerts (UPDATE requires SELECT — already present)
DROP POLICY IF EXISTS "Allow authenticated resolve alerts" ON alerts;
CREATE POLICY "Allow authenticated resolve alerts" ON alerts
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Optional: allow authenticated users to read device inventory (already have SELECT policy)
-- Service role can upsert devices from the agent / provisioning
DROP POLICY IF EXISTS "Allow service_role device insert" ON devices;
CREATE POLICY "Allow service_role device insert" ON devices
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role device update" ON devices;
CREATE POLICY "Allow service_role device update" ON devices
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Helpful indexes for mobile queries
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_device_id ON alerts (device_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts (is_resolved, timestamp DESC)
  WHERE is_resolved = false;

-- Enable Realtime for mobile subscriptions
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

-- Seed demo device if missing
INSERT INTO devices (device_name, device_type, location)
VALUES ('esp32-motor-01', 'motor', 'Lab Bench')
ON CONFLICT (device_name) DO NOTHING;
