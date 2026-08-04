/**
 * Store-timezone date helpers.
 *
 * The business runs in a single timezone (India), but the servers run in UTC.
 * Every "this year / this month" boundary must therefore be anchored to the
 * STORE offset, not the process timezone — otherwise `new Date(y, 0, 1)` on a
 * Railway container means 1 Jan 00:00 UTC, i.e. 31 Dec 05:30 IST, and the last
 * 5½ hours of the previous period leak into the current one. Small window, real
 * money: a New Year's Eve evening order would land in the wrong year's revenue.
 *
 * The offset is the same one the admin Orders date filters use, so a date range
 * computed here and a `startDate=YYYY-MM-DD` sent to that endpoint describe the
 * exact same window.
 */

// If the business ever goes multi-region this should become a per-store setting.
export const STORE_TZ_OFFSET = process.env.STORE_TZ_OFFSET || '+05:30';

/** India's financial year starts 1 April. 0-indexed month, so 3 = April. */
const FISCAL_YEAR_START_MONTH = 3;

/** "+05:30" → 330. Falls back to IST if the env var is malformed. */
function offsetMinutes(offset = STORE_TZ_OFFSET) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offset).trim());
  if (!m) return 330;
  const [, sign, hours, minutes] = m;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

/** The store-local wall-clock parts of an instant. */
function storeParts(date) {
  const shifted = new Date(date.getTime() + offsetMinutes() * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/** The UTC instant for a store-local wall-clock midnight. */
function storeMidnight(year, month, day) {
  return new Date(Date.UTC(year, month, day) - offsetMinutes() * 60_000);
}

/** "YYYY-MM-DD" for an instant, as seen in the store timezone. */
export function storeDateString(date) {
  const { year, month, day } = storeParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The Indian financial year containing `now` (1 Apr → 31 Mar).
 * @returns {{ start: Date, startDate: string, label: string }}
 *   `start` is the UTC instant of 1 Apr 00:00 store-local; `startDate` is the
 *   same boundary as the "YYYY-MM-DD" the admin Orders filter expects.
 */
export function currentFiscalYear(now = new Date()) {
  const { year, month } = storeParts(now);
  const startYear = month >= FISCAL_YEAR_START_MONTH ? year : year - 1;
  const start = storeMidnight(startYear, FISCAL_YEAR_START_MONTH, 1);
  return {
    start,
    startDate: storeDateString(start),
    // "FY 26-27" — how the number will be described in any finance conversation.
    label: `FY ${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`,
  };
}
