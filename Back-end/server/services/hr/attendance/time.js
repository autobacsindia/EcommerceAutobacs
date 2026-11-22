/**
 * IST calendar helpers for attendance. India has no DST, so IST is a fixed
 * UTC+05:30 and plain arithmetic is exact.
 *
 *   date   'YYYY-MM-DD' (IST calendar day)
 *   month  'YYYY-MM'
 *   hhmm   'HH:mm' IST wall clock
 */
import { DATE_RE, MONTH_RE, HHMM_RE } from '../../../config/hr.js';

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** IST calendar date of an instant. */
export const istDate = (at) => new Date(new Date(at).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
export const monthOf = (date) => String(date).slice(0, 7);

/** The instant of `hhmm` IST on `date`. */
export function istInstant(date, hhmm) {
  if (!DATE_RE.test(date) || !HHMM_RE.test(hhmm)) throw new Error(`bad IST date/time ${date} ${hhmm}`);
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MS);
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for an IST calendar date. */
export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Every date of a month, in order. */
export function monthDates(month) {
  if (!MONTH_RE.test(month)) throw new Error(`bad month ${month}`);
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / MINUTE_MS));

/** Shift window for a workday: start on `date`, end on `date` or the next day (overnight). */
export function shiftWindow(date, shift) {
  const start = istInstant(date, shift.start);
  let end = istInstant(date, shift.end);
  if (end <= start) end = new Date(end.getTime() + DAY_MS);
  return { start, end };
}
