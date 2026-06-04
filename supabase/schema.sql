-- Supabase Schema for Multi-Sensor AI Agent
-- 1. Devices Table
CREATE TABLE
     devices (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
          device_name TEXT NOT NULL UNIQUE,
          device_type TEXT DEFAULT 'motor',
          location TEXT,
          created_at TIMESTAMP
          WITH
               TIME ZONE DEFAULT CURRENT_TIMESTAMP
     );

-- 2. Sensor Readings Table (Time-Series)
CREATE TABLE
     sensor_readings (
          id BIGSERIAL PRIMARY KEY,
          device_id TEXT NOT NULL, -- references device_name in devices or just a string ID
          temperature FLOAT,
          humidity FLOAT,
          vibration_hz FLOAT,
          power_w FLOAT,
          metadata JSONB,
          timestamp TIMESTAMP
          WITH
               TIME ZONE DEFAULT CURRENT_TIMESTAMP
     );

-- Create an index for time-series queries
CREATE INDEX idx_sensor_readings_timestamp ON sensor_readings (timestamp DESC);

CREATE INDEX idx_sensor_readings_device_id ON sensor_readings (device_id);

-- 3. Alerts Table
CREATE TABLE
     alerts (
          id BIGSERIAL PRIMARY KEY,
          device_id TEXT NOT NULL,
          severity TEXT CHECK (severity IN ('NORMAL', 'WARNING', 'CRITICAL')),
          message TEXT,
          is_resolved BOOLEAN DEFAULT FALSE,
          timestamp TIMESTAMP
          WITH
               TIME ZONE DEFAULT CURRENT_TIMESTAMP
     );

-- 4. Enable Row Level Security (RLS)
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read data
CREATE POLICY "Allow authenticated read access" ON devices FOR
SELECT
     TO authenticated USING (true);

CREATE POLICY "Allow authenticated read access" ON sensor_readings FOR
SELECT
     TO authenticated USING (true);

CREATE POLICY "Allow authenticated read access" ON alerts FOR
SELECT
     TO authenticated USING (true);

-- Allow service role (ETL) to insert data
CREATE POLICY "Allow service_role insert" ON sensor_readings FOR INSERT TO service_role
WITH
     CHECK (true);

CREATE POLICY "Allow service_role insert" ON alerts FOR INSERT TO service_role
WITH
     CHECK (true);