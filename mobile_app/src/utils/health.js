export function severityTone(severity) {
  const s = (severity || '').toUpperCase();
  if (s === 'CRITICAL') return 'critical';
  if (s === 'WARNING') return 'warning';
  return 'ok';
}

/**
 * Single source of truth: maps backend-computed asset.health_status to UI banner state.
 */
export function healthFromStatus(status) {
  const s = (status || 'UNKNOWN').toUpperCase();
  if (s === 'CRITICAL') {
    return { status: 'CRITICAL', label: 'Critical fault active — inspect immediately', tone: 'critical' };
  }
  if (s === 'WARNING') {
    return { status: 'WARNING', label: 'Early anomaly or correlation warning', tone: 'warning' };
  }
  if (s === 'MAINTENANCE') {
    return { status: 'MAINTENANCE', label: 'Planned maintenance mode — alerts muted', tone: 'neutral' };
  }
  if (s === 'OFFLINE') {
    return { status: 'OFFLINE', label: 'Sensor offline (MQTT LWT received)', tone: 'critical' };
  }
  if (s === 'NOMINAL') {
    return { status: 'NOMINAL', label: 'All signals within asset profile limits', tone: 'ok' };
  }
  return { status: 'UNKNOWN', label: 'Waiting for telemetry from device', tone: 'neutral' };
}

export function metricStatus(key, value, profile) {
  if (value == null || !profile) return 'ok';
  const v = Number(value);
  const map = {
    temperature: [profile.warn_temp, profile.crit_temp],
    humidity: [profile.warn_humidity, profile.crit_humidity],
    vibration_hz: [profile.warn_vibration_hz, profile.crit_vibration_hz],
    power_w: [profile.warn_power_w, profile.crit_power_w],
  };
  const limits = map[key];
  if (!limits) return 'ok';
  if (v >= limits[1]) return 'critical';
  if (v >= limits[0]) return 'warning';
  return 'ok';
}
