export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  role?: string;
}

export interface SessionData {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
  full_name: string;
  active_org: OrgSummary;
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
  latest_metrics: Record<string, any>;
  profile: AssetProfile | null;
}

export interface Site {
  id: string;
  name: string;
  location: string | null;
}

export interface Device {
  id: string;
  asset_id: string | null;
  device_uid: string;
  protocol: string;
  firmware_version: string | null;
  cert_cn: string;
  cert_fingerprint: string | null;
  is_revoked: boolean;
  status: string;
  last_seen_at: string | null;
}

export interface TelemetryPoint {
  time: string;
  temperature: number | null;
  humidity: number | null;
  vibration_hz: number | null;
  power_w: number | null;
  vib_rms_mm_s: number | null;
  iso_zone: string | null;
  sample_count: number;
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

export interface AlertItem {
  id: string;
  asset_id: string;
  device_id: string | null;
  severity: 'WARNING' | 'CRITICAL';
  status: 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'false_positive';
  trigger_reason: string;
  trigger_snapshot: Record<string, any>;
  ai_status: string;
  ai_diagnosis: AIDiagnosis | null;
  ai_feedback: number | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface WorkOrder {
  id: string;
  asset_id: string;
  alert_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  created_at: string;
}

export interface FleetSummary {
  total_assets: number;
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  open_alerts: number;
  critical_open_alerts: number;
  asset_status_breakdown: Record<string, number>;
}

const API_BASE = '/api/v1';

export function buildWsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${API_BASE}/ws?token=${encodeURIComponent(token)}`;
}

async function req<T>(path: string, token?: string | null, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      detail = err.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    req<SessionData>('/auth/login', null, { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, full_name: string, password: string, organization_name: string) =>
    req<SessionData>('/auth/register', null, {
      method: 'POST',
      body: JSON.stringify({ email, full_name, password, organization_name }),
    }),
  switchOrg: (token: string, org_id: string) =>
    req<SessionData>('/auth/switch-org', token, { method: 'POST', body: JSON.stringify({ org_id }) }),
  members: (token: string) => req<any[]>('/auth/members', token),
  invite: (token: string, email: string, role: string) =>
    req<any>('/auth/invitations', token, { method: 'POST', body: JSON.stringify({ email, role }) }),

  fleetSummary: (token: string) => req<FleetSummary>('/telemetry/fleet-summary', token),
  sites: (token: string) => req<Site[]>('/sites', token),
  assets: (token: string) => req<Asset[]>('/assets', token),
  createAsset: (token: string, payload: any) =>
    req<Asset>('/assets', token, { method: 'POST', body: JSON.stringify(payload) }),
  updateAsset: (token: string, id: string, payload: any) =>
    req<Asset>(`/assets/${id}`, token, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateProfile: (token: string, assetId: string, payload: Partial<AssetProfile>) =>
    req<AssetProfile>(`/assets/${assetId}/profile`, token, { method: 'PUT', body: JSON.stringify(payload) }),
  telemetry: (token: string, assetId: string, range: string) =>
    req<TelemetryPoint[]>(`/telemetry/assets/${assetId}?range=${range}`, token),

  alerts: (token: string, statusFilter?: string) =>
    req<AlertItem[]>(`/alerts${statusFilter ? `?status=${statusFilter}` : ''}`, token),
  updateAlert: (token: string, id: string, status: string, resolution_notes?: string) =>
    req<AlertItem>(`/alerts/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolution_notes }),
    }),
  rateAlert: (token: string, id: string, feedback: 1 | -1) =>
    req<AlertItem>(`/alerts/${id}/feedback`, token, { method: 'POST', body: JSON.stringify({ feedback }) }),

  workOrders: (token: string) => req<WorkOrder[]>('/work-orders', token),
  createWorkOrder: (token: string, payload: any) =>
    req<WorkOrder>('/work-orders', token, { method: 'POST', body: JSON.stringify(payload) }),
  updateWorkOrder: (token: string, id: string, payload: any) =>
    req<WorkOrder>(`/work-orders/${id}`, token, { method: 'PATCH', body: JSON.stringify(payload) }),

  devices: (token: string) => req<Device[]>('/devices', token),
  provisionDevice: (token: string, payload: { asset_id?: string | null; device_uid: string; protocol: string }) =>
    req<{ device: Device; cert_bundle: Record<string, string> }>('/devices', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeDevice: (token: string, id: string) =>
    req<Device>(`/devices/${id}/revoke`, token, { method: 'POST' }),
  rotateDeviceCert: (token: string, id: string) =>
    req<{ device: Device; cert_bundle: Record<string, string> }>(`/devices/${id}/rotate-cert`, token, {
      method: 'POST',
    }),

  manuals: (token: string, assetId: string) => req<any[]>(`/assets/${assetId}/manuals`, token),
  uploadManual: (token: string, assetId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<any>(`/assets/${assetId}/manuals`, token, { method: 'POST', body: fd });
  },

  webhooks: (token: string) => req<any[]>('/webhooks', token),
  createWebhook: (token: string, payload: any) =>
    req<any>('/webhooks', token, { method: 'POST', body: JSON.stringify(payload) }),
  deleteWebhook: (token: string, id: string) =>
    req<void>(`/webhooks/${id}`, token, { method: 'DELETE' }),
  auditLogs: (token: string) => req<any[]>('/audit-logs?limit=50', token),

  downloadReport: async (token: string, kind: 'csv' | 'pdf', hours = 24) => {
    const path = kind === 'csv' ? `/reports/telemetry.csv?hours=${hours}` : `/reports/incident.pdf?hours=${hours}`;
    const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Report export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'csv' ? `telemetry_${hours}h.csv` : `incident_report_${hours}h.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
