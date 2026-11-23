import type { NavigatorScreenParams } from '@react-navigation/native';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  role?: string | null;
}

export interface SessionData {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  user_id: string;
  email: string;
  full_name: string;
  active_org: OrgSummary;
  organizations: OrgSummary[];
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  activeOrg: OrgSummary;
  organizations: OrgSummary[];
}

export interface AssetProfile {
  id: string;
  asset_id: string;
  baseline_temp: number;
  baseline_humidity: number;
  baseline_vibration_hz: number;
  baseline_power_w: number;
  warn_temp: number;
  crit_temp: number;
  warn_humidity: number;
  crit_humidity: number;
  warn_vibration_hz: number;
  crit_vibration_hz: number;
  warn_power_w: number;
  crit_power_w: number;
  corr_min_signals: number;
  corr_temp_delta: number;
  corr_vib_delta: number;
  corr_power_delta: number;
  rapid_window: number;
  rapid_temp_delta: number;
  cooldown_base_sec: number;
  cooldown_multiplier: number;
  cooldown_max_sec: number;
  normal_reset_readings: number;
  updated_at?: string;
}

export interface LatestMetrics {
  temperature?: number | null;
  humidity?: number | null;
  vibration_hz?: number | null;
  power_w?: number | null;
  vib_rms_mm_s?: number | null;
  iso_zone?: string | null;
}

export interface Asset {
  id: string;
  org_id: string;
  site_id: string;
  line_id: string | null;
  name: string;
  asset_type: string;
  manufacturer: string | null;
  model_number: string | null;
  rated_power_kw: number | null;
  rated_rpm: number | null;
  health_status: string;
  maintenance_mode: boolean;
  last_telemetry_at: string | null;
  latest_metrics: LatestMetrics;
  created_at?: string;
  profile: AssetProfile | null;
}

export interface Device {
  id: string;
  org_id?: string;
  asset_id: string | null;
  device_uid: string;
  protocol: string;
  firmware_version: string | null;
  cert_cn: string;
  cert_fingerprint: string | null;
  is_revoked: boolean;
  status: string;
  last_seen_at: string | null;
  created_at?: string;
}

export interface TelemetryPoint {
  time: string;
  timestamp?: string | null;
  temperature: number | null;
  humidity: number | null;
  vibration_hz: number | null;
  power_w: number | null;
  vib_rms_mm_s: number | null;
  iso_zone: string | null;
  sample_count?: number;
}

export interface AIDiagnosis {
  severity_assessment: string;
  summary: string;
  probable_root_cause: string;
  confidence: number;
  immediate_actions: string[];
  safety_precaution: string;
  cited_manual_section: string | null;
  provider: string;
}

export type AlertSeverity = 'WARNING' | 'CRITICAL';

export type AlertStatus =
  | 'open'
  | 'acknowledged'
  | 'in_progress'
  | 'resolved'
  | 'false_positive';

export interface AlertItem {
  id: string;
  org_id?: string;
  asset_id: string;
  asset_name?: string;
  device_id: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  trigger_reason: string;
  trigger_snapshot: Record<string, unknown>;
  ai_status: string;
  ai_diagnosis: AIDiagnosis | null;
  ai_feedback: number | null;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export type Tone = 'ok' | 'warning' | 'critical' | 'neutral' | 'live';

export interface HealthBannerState {
  status: string;
  label: string;
  tone: Tone;
}

export type MetricKey = 'temperature' | 'humidity' | 'vibration_hz' | 'power_w';

export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

export type MainTabParamList = {
  Live: undefined;
  Alerts: undefined;
  History: undefined;
  Devices: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList> | undefined;
  AlertDetail: { id: string };
};
