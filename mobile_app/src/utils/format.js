import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns';

export function parseTs(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = typeof value === 'string' ? parseISO(value) : new Date(value);
  return isValid(d) ? d : null;
}

export function formatClock(value) {
  const d = parseTs(value);
  return d ? format(d, 'HH:mm:ss') : '—';
}

export function formatDateTime(value) {
  const d = parseTs(value);
  return d ? format(d, 'MMM d · HH:mm') : '—';
}

export function formatRelative(value) {
  const d = parseTs(value);
  if (!d) return '—';
  return formatDistanceToNow(d, { addSuffix: true });
}

export function fmtNum(value, digits = 1) {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}
