/**
 * Support team hours, for the after-hours auto-reply ("Nothing Extra" campaign,
 * 2026-11-23). India time, Monday–Saturday 9:30 am – 6:30 pm. Sundays are closed.
 *
 * Kept as data so a change of hours is a one-line edit. No public holidays yet:
 * on a holiday the team is "open" here, so the customer simply gets no
 * after-hours note — the safe direction (no false "we're closed").
 *
 * Pure: every function takes `now` so tests never depend on the clock.
 */

/** 0 = Sunday … 6 = Saturday (India day of week). */
export const SUPPORT_DAYS = Object.freeze([1, 2, 3, 4, 5, 6]);
/** Minutes after India midnight. */
export const SUPPORT_OPEN_MIN = 9 * 60 + 30;   // 9:30 am
export const SUPPORT_CLOSE_MIN = 18 * 60 + 30; // 6:30 pm

/** Shown to customers; no weekday names (automated mail never names a day). */
export const SUPPORT_HOURS_TEXT = '9:30 am to 6:30 pm India time, six days a week';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ist = (now) => new Date(new Date(now).getTime() + IST_OFFSET_MS);
const minutesOf = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

/** True while the support team is working. */
export function isWithinSupportHours(now = new Date()) {
  const d = ist(now);
  const m = minutesOf(d);
  return SUPPORT_DAYS.includes(d.getUTCDay()) && m >= SUPPORT_OPEN_MIN && m < SUPPORT_CLOSE_MIN;
}

/**
 * The India day ('YYYY-MM-DD') the team next opens, as seen from `now`. Every
 * moment of one closed stretch maps to the same day — Saturday 7 pm, Sunday noon
 * and Monday 8 am all give Monday — so it names "this night" for the once-only key.
 * During opening hours it is today.
 */
export function nextOpeningDay(now = new Date()) {
  let d = ist(now);
  if (SUPPORT_DAYS.includes(d.getUTCDay()) && minutesOf(d) < SUPPORT_CLOSE_MIN) {
    return d.toISOString().slice(0, 10);
  }
  for (let i = 1; i <= 7; i += 1) {
    d = new Date(d.getTime() + DAY_MS);
    if (SUPPORT_DAYS.includes(d.getUTCDay())) return d.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10); // unreachable with a non-empty SUPPORT_DAYS
}

/** Once-only key for "the after-hours note for this closed stretch". */
export const afterHoursKey = (now = new Date()) => `after-hours:${nextOpeningDay(now)}`;

export default { SUPPORT_DAYS, SUPPORT_OPEN_MIN, SUPPORT_CLOSE_MIN, SUPPORT_HOURS_TEXT, isWithinSupportHours, nextOpeningDay, afterHoursKey };
