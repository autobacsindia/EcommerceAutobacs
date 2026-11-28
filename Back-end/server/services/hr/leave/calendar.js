/**
 * Pure calendar maths for leave (docs/ADR-hr-system.md §4 Leave). No I/O, so
 * every rule here is unit-tested directly.
 *
 * Days are IST 'YYYY-MM-DD' strings. Leave is counted in HALF-DAYS: a full day
 * is 2, a half day is 1.
 */
import { DATE_RE } from '../../../config/hr.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** A real calendar date in 'YYYY-MM-DD' (2026-02-31 is not). */
export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const toUtc = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (s, n) => fromUtc(toUtc(s) + n * DAY_MS);
/** Whole days from a to b (b − a). */
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (s) => new Date(toUtc(s)).getUTCDay();
export const yearOf = (s) => Number(String(s).slice(0, 4));

/** Today in India, 'YYYY-MM-DD'. `now` is injectable for tests. */
export const istToday = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Every date from `from` to `to`, both included. */
export function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The leave days a request costs.
 *
 *   from, to           inclusive range (from ≤ to, same calendar year — checked by the caller)
 *   firstHalfOnly      `from` is a half day
 *   secondHalfOnly     `to` is a half day (on a one-day request: use only one flag)
 *   weeklyOff          [0..6] from the employee's shift
 *   holidays           Set of holiday dates that apply to the employee
 *   sandwich           off days BETWEEN two leave days count as leave
 *
 * Returns { halfDays, days: [{ date, halves }] } with only the charged days.
 * Off days at the edges of the range are never charged (Fri–Mon over a weekend
 * is 2 days without sandwich, 4 with it). A half-day flag on an off day is
 * ignored — that day costs nothing anyway.
 */
export function countLeave({
  from, to, firstHalfOnly = false, secondHalfOnly = false, weeklyOff = [], holidays = new Set(), sandwich = false,
}) {
  const offs = new Set(weeklyOff);
  const dates = eachDate(from, to);
  const isOff = (d) => offs.has(weekdayOf(d)) || holidays.has(d);
  const working = dates.filter((d) => !isOff(d));
  if (!working.length) return { halfDays: 0, days: [] };
  const firstWorking = working[0];
  const lastWorking = working[working.length - 1];

  const days = [];
  for (const d of dates) {
    let halves;
    if (!isOff(d)) halves = 2;
    else if (sandwich && d > firstWorking && d < lastWorking) halves = 2;
    else continue;
    if (d === from && firstHalfOnly && !isOff(d)) halves = 1;
    if (d === to && secondHalfOnly && !isOff(d)) halves = 1;
    days.push({ date: d, halves });
  }
  return { halfDays: days.reduce((s, x) => s + x.halves, 0), days };
}

/**
 * Pro-rated share of a yearly quota for someone who joined during `year`.
 * Joining on or before the 15th counts that month; after the 15th starts the
 * next month. Rounded DOWN to a whole half-day (never grants a fraction).
 */
export function proRatedQuota(quotaHalfDays, year, joinDate) {
  if (!joinDate || yearOf(joinDate) < year) return quotaHalfDays;
  if (yearOf(joinDate) > year) return 0;
  const month = Number(joinDate.slice(5, 7));
  const day = Number(joinDate.slice(8, 10));
  const firstMonth = day <= 15 ? month : month + 1;
  const months = Math.max(0, 13 - firstMonth);
  return Math.floor((quotaHalfDays * months) / 12);
}

/**
 * Monthly accrual for month `m` (1–12): the cumulative share minus last month's,
 * so twelve months always add up to exactly the yearly quota (no rounding drift).
 */
export const monthlyShare = (quotaHalfDays, m) => Math.floor((quotaHalfDays * m) / 12) - Math.floor((quotaHalfDays * (m - 1)) / 12);

/** First month (1–12) of `year` a person who joined on `joinDate` accrues in; 13 = none. */
export function firstAccrualMonth(year, joinDate) {
  if (!joinDate || yearOf(joinDate) < year) return 1;
  if (yearOf(joinDate) > year) return 13;
  const month = Number(joinDate.slice(5, 7));
  return Number(joinDate.slice(8, 10)) <= 15 ? month : month + 1;
}
