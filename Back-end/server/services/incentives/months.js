/**
 * IST calendar months as 'YYYY-MM' strings. A Roav Points month runs from
 * 00:00 IST on the 1st to 23:59:59.999 IST on its last day.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);

/** The IST month a moment falls in. */
export function monthOf(date) {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** UTC instant of 00:00 IST on the 1st of `month`. */
export function monthStart(month) {
  const [, y, m] = MONTH_RE.exec(month);
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1) - IST_OFFSET_MS);
}

export function addMonths(month, n) {
  const [, y, m] = MONTH_RE.exec(month);
  const idx = Number(y) * 12 + (Number(m) - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** [start, end) of the month. */
export const monthRange = (month) => ({ start: monthStart(month), end: monthStart(addMonths(month, 1)) });

/** Day of month in IST (1–31). */
export const istDayOfMonth = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MS).getUTCDate();
