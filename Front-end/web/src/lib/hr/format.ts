/**
 * Display-only helpers. Every number shown was computed by the server; nothing
 * here adds, multiplies or rounds pay — it only turns paise into "₹27,840".
 */
import { formatRupees } from '@/lib/formatRupees';
import { formatTimeIST } from '@/lib/datetime';

/** Server paise → "₹27,840" (paise shown only when present). */
export const paise = (value: number | null | undefined): string =>
  formatRupees(Number.isFinite(Number(value)) ? Number(value) / 100 : 0, { exact: true });

/** Half-days (integers) → "1 day", "½ day", "4.5 days". */
export function halfDaysLabel(halfDays: number | null | undefined): string {
  const n = Number(halfDays) || 0;
  if (n === 1) return '½ day';
  const days = n / 2;
  const text = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${text} ${days === 1 ? 'day' : 'days'}`;
}

/** Half-days → plain number "4.5" (for balance tiles). */
export const halfDaysNumber = (halfDays: number | null | undefined): string => {
  const days = (Number(halfDays) || 0) / 2;
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
};

const DATE_FMT = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH_FMT = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** 'YYYY-MM-DD' (an IST calendar day) → "Fri, 4 Dec". Parsed as UTC so the day never shifts. */
export function dayLabel(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '—';
  return DATE_FMT.format(new Date(`${date}T00:00:00Z`));
}

/** 'YYYY-MM' → "November 2026". */
export function monthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return MONTH_FMT.format(new Date(`${month}-01T00:00:00Z`));
}

/** Leave range → "Fri, 4 Dec" or "Mon, 21 Dec – Thu, 24 Dec", with the half marked. */
export function leaveWhen(r: { from: string; to: string; firstHalfOnly?: boolean; secondHalfOnly?: boolean }): string {
  const base = r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`;
  if (r.firstHalfOnly) return `${base} (first half)`;
  if (r.secondHalfOnly) return `${base} (second half)`;
  return base;
}

export const timeLabel = (at: string | null | undefined): string => formatTimeIST(at ?? null);

/** Minutes → "9h 08m". */
export function minutesLabel(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** The current IST month 'YYYY-MM'. */
export function currentMonthIST(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 7);
}

/** 'YYYY-MM' shifted by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
