import 'react-native-url-polyfill/auto';

const rawBase = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
export const API_URL = rawBase.replace(/\/+$/, '');
export const isApiConfigured = Boolean(API_URL);

export function buildWsUrl(token) {
  const wsBase = API_URL.replace(/^http/i, 'ws');
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}

async function request(path, token, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      detail = err.detail || detail;
    } catch {
      // ignore
    }
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const apiClient = {
  login: (email, password) =>
    request('/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email, full_name, password, organization_name) =>
    request('/auth/register', null, {
      method: 'POST',
      body: JSON.stringify({ email, full_name, password, organization_name }),
    }),
  refresh: (refresh_token) =>
    request('/auth/refresh', null, {
      method: 'POST',
      body: JSON.stringify({ refresh_token }),
    }),
  switchOrg: (token, org_id) =>
    request('/auth/switch-org', token, {
      method: 'POST',
      body: JSON.stringify({ org_id }),
    }),
  assets: (token) => request('/assets', token),
  devices: (token) => request('/devices', token),
  alerts: (token) => request('/alerts?limit=80', token),
  telemetry: (token, assetId, range = '15m') =>
    request(`/telemetry/assets/${assetId}?range=${range}&limit=60`, token),
  updateAlert: (token, id, status, resolution_notes) =>
    request(`/alerts/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolution_notes }),
    }),
  rateAlert: (token, id, feedback) =>
    request(`/alerts/${id}/feedback`, token, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
};
