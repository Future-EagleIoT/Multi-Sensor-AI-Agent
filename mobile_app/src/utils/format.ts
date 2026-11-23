import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

export type TimestampInput = Date | string | number | null | undefined;

export function parseTs(value: TimestampInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  const d = typeof value === 'string' ? parseISO(value) : new Date(value);
  return isValid(d) ? d : null;
}

export function formatClock(value: TimestampInput): string {
  const d = parseTs(value);
  return d ? format(d, 'HH:mm:ss') : '—';
}

export function formatDateTime(value: TimestampInput): string {
  const d = parseTs(value);
  return d ? format(d, 'MMM d · HH:mm') : '—';
}

export function formatRelative(value: TimestampInput): string {
  const d = parseTs(value);
  if (!d) return '—';
  return formatDistanceToNow(d, { addSuffix: true });
}

export function fmtNum(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}
