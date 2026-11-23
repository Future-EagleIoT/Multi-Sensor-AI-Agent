import 'react-native-url-polyfill/auto';
import type {
  AlertItem,
  AlertStatus,
  Asset,
  Device,
  SessionData,
  TelemetryPoint,
} from '../types/models';

const rawBase = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080/api/v1';
export const API_URL = rawBase.replace(/\/+$/, '');
export const isApiConfigured = Boolean(API_URL);

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function buildWsUrl(token: string): string {
  const wsBase = API_URL.replace(/^http/i, 'ws');
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}

async function request<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { detail?: string };
      if (err.detail) detail = err.detail;
    } catch {
      // ignore non-JSON error body
    }
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const apiClient = {
  login: (email: string, password: string): Promise<SessionData> =>
    request<SessionData>('/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (
    email: string,
    full_name: string,
    password: string,
    organization_name: string,
  ): Promise<SessionData> =>
    request<SessionData>('/auth/register', null, {
      method: 'POST',
      body: JSON.stringify({ email, full_name, password, organization_name }),
    }),

  refresh: (refresh_token: string): Promise<SessionData> =>
    request<SessionData>('/auth/refresh', null, {
      method: 'POST',
      body: JSON.stringify({ refresh_token }),
    }),

  switchOrg: (token: string, org_id: string): Promise<SessionData> =>
    request<SessionData>('/auth/switch-org', token, {
      method: 'POST',
      body: JSON.stringify({ org_id }),
    }),

  assets: (token: string): Promise<Asset[]> => request<Asset[]>('/assets', token),

  devices: (token: string): Promise<Device[]> => request<Device[]>('/devices', token),

  alerts: (token: string): Promise<AlertItem[]> =>
    request<AlertItem[]>('/alerts?limit=80', token),

  telemetry: (token: string, assetId: string, range = '15m'): Promise<TelemetryPoint[]> =>
    request<TelemetryPoint[]>(`/telemetry/assets/${assetId}?range=${range}&limit=60`, token),

  updateAlert: (
    token: string,
    id: string,
    status: AlertStatus,
    resolution_notes?: string,
  ): Promise<AlertItem> =>
    request<AlertItem>(`/alerts/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolution_notes }),
    }),

  rateAlert: (token: string, id: string, feedback: -1 | 1): Promise<AlertItem> =>
    request<AlertItem>(`/alerts/${id}/feedback`, token, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
};
