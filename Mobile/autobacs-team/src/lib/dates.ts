/**
 * Date helpers. Every HR day is an IST calendar day ('YYYY-MM-DD'); the phone
 * may be in any time zone, so "today" and display times are computed in IST
 * explicitly rather than from the device clock's zone.
 */
const IST_OFFSET_MS = 330 * 60_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** IST 'YYYY-MM-DD' for an instant. */
export function istDate(at: Date | number = Date.now()): string {
  return new Date(new Date(at).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export const istMonth = (at: Date | number = Date.now()) => istDate(at).slice(0, 7);

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'Fri 20 Nov' */
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 'November 2026' */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** '9:56 am' in IST, from an ISO instant. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

/** '10:00' (shift clock) → '10:00 am' */
export function formatClock(hhmm: string): string {
  const [h0, m] = hhmm.split(':').map(Number);
  const ap = h0 >= 12 ? 'pm' : 'am';
  return `${h0 % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
}

/** 548 → '9h 08m' */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  return `${h}h ${String(min % 60).padStart(2, '0')}m`;
}

/** An IST date + 'HH:MM' → ISO instant. */
export function istInstant(date: string, hhmm: string): string {
  return new Date(Date.parse(`${date}T${hhmm}:00Z`) - IST_OFFSET_MS).toISOString();
}

export function greeting(at: Date | number = Date.now()): string {
  const h = new Date(new Date(at).getTime() + IST_OFFSET_MS).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
