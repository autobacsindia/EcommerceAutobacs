/**
 * Business-hours arithmetic for support SLAs, pinned to India Standard Time.
 *
 * WHY THIS IS SEPARATE FROM utils/datetime.js
 * -------------------------------------------
 * datetime.js is the *presentation* edge (UTC → human-readable IST strings).
 * This module does *arithmetic on instants*: "given this ticket arrived at T,
 * when is the 4-business-hour first-response deadline?" The two must not be
 * conflated — formatting a date and advancing a clock through a working
 * calendar are different problems.
 *
 * WHY A FIXED OFFSET IS SAFE HERE
 * -------------------------------
 * India has never observed daylight saving, and IST has been a flat UTC+05:30
 * since 1955. That lets us do exact arithmetic with a constant offset instead of
 * pulling in a tz-aware date library for one feature. This assumption is
 * load-bearing: if India ever adopts DST, replace the offset constant with a
 * real tz library rather than patching call sites.
 *
 * All inputs and outputs are UTC `Date` instants — the IST wall clock only ever
 * exists inside this module. Mongo keeps storing UTC, as it should.
 */

import { BUSINESS_HOURS } from '../config/supportPolicy.js';

/** IST is UTC+05:30, always. */
const IST_OFFSET_MS = 330 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/**
 * Safety bound on the day-skipping loops. Eight days comfortably clears the
 * longest possible non-working stretch (a Sunday plus a multi-day holiday
 * block) while guaranteeing termination if the calendar config is ever
 * misconfigured to have no working days at all.
 */
const MAX_DAY_SKIPS = 8;

/**
 * Read the IST wall clock off a UTC instant.
 *
 * The trick: shift the instant forward by the offset, then read it with the
 * `getUTC*` accessors. Those are offset-free, so what comes back is the IST
 * calendar/clock without ever consulting the host machine's timezone — which is
 * UTC on Railway and something else on a developer's laptop.
 */
const istParts = (date) => {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};

/**
 * Build a UTC instant from IST wall-clock components.
 * `Date.UTC` normalises overflow, so passing day = 32 or month = 12 rolls over
 * correctly — which is what makes the "advance to tomorrow" step safe at month
 * and year boundaries.
 */
const fromIstParts = (year, month, day, hour = 0, minute = 0) =>
  new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - IST_OFFSET_MS);

/** "2026-08-04" in IST — the key format for the holiday list. */
const istDateKey = (date) => {
  const p = istParts(date);
  const mm = String(p.month + 1).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
};

/**
 * Is this IST calendar day one the support team works?
 * Combines the weekly pattern with the holiday exception list.
 */
const isWorkingDay = (date, holidays) => {
  const { weekday } = istParts(date);
  if (!BUSINESS_HOURS.workingDays.includes(weekday)) return false;
  return !holidays.has(istDateKey(date));
};

/** Opening instant of the IST day containing `date`. */
const openingOf = (date) => {
  const p = istParts(date);
  return fromIstParts(p.year, p.month, p.day, BUSINESS_HOURS.startHour, 0);
};

/** Closing instant of the IST day containing `date`. */
const closingOf = (date) => {
  const p = istParts(date);
  return fromIstParts(p.year, p.month, p.day, BUSINESS_HOURS.endHour, 0);
};

/** Midnight IST at the start of the day after the one containing `date`. */
const nextMidnight = (date) => {
  const p = istParts(date);
  return fromIstParts(p.year, p.month, p.day + 1, 0, 0);
};

/** Normalise a holiday list (array of "YYYY-MM-DD" IST strings) to a Set. */
const toHolidaySet = (holidays) =>
  holidays instanceof Set ? holidays : new Set(holidays || []);

/**
 * Is the given instant inside published support hours?
 * @param {Date|string|number} value
 * @param {string[]|Set<string>} [holidays] - IST "YYYY-MM-DD" closures
 * @returns {boolean}
 */
export const isWithinBusinessHours = (value, holidays = []) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const set = toHolidaySet(holidays);
  if (!isWorkingDay(date, set)) return false;
  return date >= openingOf(date) && date < closingOf(date);
};

/**
 * Move an instant forward to the next moment the support desk is open.
 * Returns the instant unchanged when it is already inside business hours.
 *
 * This is what stops a Saturday-19:00 email from being measured as if the clock
 * had been running all Sunday: its SLA starts Monday at 10:00 IST.
 *
 * @param {Date} date
 * @param {Set<string>} holidays
 * @returns {Date}
 */
const advanceToOpen = (date, holidays) => {
  let cursor = date;

  for (let i = 0; i <= MAX_DAY_SKIPS; i += 1) {
    if (isWorkingDay(cursor, holidays)) {
      const open = openingOf(cursor);
      const close = closingOf(cursor);
      if (cursor < open) return open;      // before opening — wait for the doors
      if (cursor < close) return cursor;   // already open
    }
    // Closed for the rest of this day: jump to the start of the next one and
    // re-test. Starting at midnight (rather than at the next opening) keeps the
    // working-day test and the holiday test on the same calendar day.
    cursor = nextMidnight(cursor);
  }

  // Unreachable with a sane calendar; returning the cursor keeps the caller
  // total rather than throwing inside an SLA computation.
  return cursor;
};

/**
 * Add business minutes to an instant, skipping nights, non-working days and
 * holidays.
 *
 * @param {Date|string|number} start
 * @param {number} minutes - business minutes to add (must be >= 0)
 * @param {string[]|Set<string>} [holidays] - IST "YYYY-MM-DD" closures
 * @returns {Date} the deadline, as a UTC instant
 */
export const addBusinessMinutes = (start, minutes, holidays = []) => {
  const from = start instanceof Date ? start : new Date(start);
  if (Number.isNaN(from.getTime())) {
    throw new TypeError('addBusinessMinutes: invalid start date');
  }
  const set = toHolidaySet(holidays);

  let remaining = Math.max(0, Math.round(minutes));
  let cursor = advanceToOpen(from, set);

  // Zero-duration SLAs still snap to opening time, which is the desired
  // behaviour: an out-of-hours ticket is not instantly breached.
  if (remaining === 0) return cursor;

  for (let i = 0; i <= MAX_DAY_SKIPS * 2; i += 1) {
    const close = closingOf(cursor);
    const availableMinutes = Math.floor((close.getTime() - cursor.getTime()) / MINUTE_MS);

    if (remaining <= availableMinutes) {
      return new Date(cursor.getTime() + remaining * MINUTE_MS);
    }

    remaining -= availableMinutes;
    cursor = advanceToOpen(nextMidnight(cursor), set);
  }

  return cursor;
};

/**
 * Add business hours to an instant. Thin wrapper over addBusinessMinutes;
 * fractional hours are supported (0.5 → 30 minutes).
 *
 * @param {Date|string|number} start
 * @param {number} hours
 * @param {string[]|Set<string>} [holidays]
 * @returns {Date}
 */
export const addBusinessHours = (start, hours, holidays = []) =>
  addBusinessMinutes(start, Number(hours || 0) * 60, holidays);

/**
 * Business minutes elapsed between two instants — the measurement counterpart of
 * addBusinessMinutes, used to report true first-response and resolution times
 * rather than raw wall-clock deltas (which would make every overnight ticket
 * look like a 14-hour failure).
 *
 * @param {Date|string|number} start
 * @param {Date|string|number} end
 * @param {string[]|Set<string>} [holidays]
 * @returns {number} whole business minutes; 0 when end precedes start
 */
export const businessMinutesBetween = (start, end, holidays = []) => {
  const from = start instanceof Date ? start : new Date(start);
  const to = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  if (to <= from) return 0;

  const set = toHolidaySet(holidays);
  let cursor = advanceToOpen(from, set);
  let total = 0;

  for (let i = 0; i <= MAX_DAY_SKIPS * 400; i += 1) {
    if (cursor >= to) break;

    const close = closingOf(cursor);
    const segmentEnd = to < close ? to : close;

    if (segmentEnd > cursor) {
      total += Math.floor((segmentEnd.getTime() - cursor.getTime()) / MINUTE_MS);
    }
    if (to <= close) break;

    cursor = advanceToOpen(nextMidnight(cursor), set);
  }

  return total;
};

export default {
  isWithinBusinessHours,
  addBusinessHours,
  addBusinessMinutes,
  businessMinutesBetween,
};
