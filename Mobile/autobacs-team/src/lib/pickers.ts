/**
 * Conversions between the app's strings ('YYYY-MM-DD', 'HH:MM') and the Date a
 * native picker works with. The picker shows the phone's local calendar; we
 * read back the local Y/M/D the person tapped, so the chosen day never shifts
 * across a time zone. Noon avoids DST edges. Pure — tests/pickers.test.ts.
 */
import { isRealDate } from './dates';

export function dateToPicker(date: string): Date {
  if (!isRealDate(date)) return new Date();
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function pickerToDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function timeToPicker(hhmm: string, base = new Date()): Date {
  const m = TIME_RE.exec(hhmm.trim());
  const d = new Date(base);
  d.setHours(m ? Number(m[1]) : 9, m ? Number(m[2]) : 0, 0, 0);
  return d;
}

export function pickerToTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** '7:05 pm' for a 'HH:MM' string. */
export function formatTime12(hhmm: string): string {
  const m = TIME_RE.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/** Clamp a 'YYYY-MM-DD' into [min, max] (either optional). */
export function clampDate(date: string, min?: string, max?: string): string {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}
