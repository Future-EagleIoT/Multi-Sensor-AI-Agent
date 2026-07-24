import { thresholds } from '../theme/tokens';

export function severityTone(severity) {
  const s = (severity || '').toUpperCase();
  if (s === 'CRITICAL') return 'critical';
  if (s === 'WARNING') return 'warning';
  return 'ok';
}

export function evaluateReadingHealth(reading) {
  if (!reading) {
    return { status: 'UNKNOWN', label: 'Waiting for data', tone: 'neutral' };
  }

  const breaches = [];
  if (Number(reading.temperature) >= thresholds.temperature) breaches.push('temperature');
  if (Number(reading.humidity) >= thresholds.humidity) breaches.push('humidity');
  if (Number(reading.vibration_hz) >= thresholds.vibration_hz) breaches.push('vibration');
  if (Number(reading.power_w) >= thresholds.power_w) breaches.push('power');

  if (breaches.length >= 2) {
    return {
      status: 'CRITICAL',
      label: 'Critical — multi-signal breach',
      tone: 'critical',
      breaches,
    };
  }
  if (breaches.length === 1) {
    return {
      status: 'WARNING',
      label: `Warning — ${breaches[0]} high`,
      tone: 'warning',
      breaches,
    };
  }

  return {
    status: 'NOMINAL',
    label: 'All signals nominal',
    tone: 'ok',
    breaches: [],
  };
}

export function metricStatus(key, value) {
  const limit = thresholds[key];
  if (limit == null || value == null) return 'ok';
  return Number(value) >= limit ? (key === 'humidity' ? 'warning' : 'critical') : 'ok';
}
