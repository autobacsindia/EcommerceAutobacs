/**
 * Repeating tasks (ClickUp's "recurring", asked for by the owner 2026-11):
 * "Monthly office supply purchase" comes back by itself every month, due on the 1st.
 *
 *   repeat = { every: 1..REPEAT_EVERY_MAX, unit: 'day' | 'week' | 'month', day?: 1..31 }
 *
 * `day` is for months only: the day of the month it is due. It is always stored
 * for a monthly repeat (taken from the due date when not picked), so a task due
 * on the 31st goes 31 Jan → 28 Feb → 31 Mar, never drifting to the 28th.
 *
 * The next due date counts from the old DUE date, not the day it was ticked
 * done — and never lands in the past: done late on 20 July, a task due 1 May
 * comes back due 1 August (owner's call), not 1 June already overdue.
 *
 * Every date is an IST calendar day 'YYYY-MM-DD', like the rest of the Tasks
 * module. Everything here is pure, so each boundary is tested directly
 * (tests/staffTaskRepeat.test.js); creating the next task lives in
 * services/staffTaskService.js (makeNextRepeat).
 */
import AppError from '../utils/AppError.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const REPEAT_UNITS = Object.freeze(['day', 'week', 'month']);
export const REPEAT_EVERY_MAX = 99;
/** A daily repeat years behind still catches up in well under this many steps (99 years of days). */
const CATCH_UP_MAX = 40000;

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const parse = (ymd) => ymd.split('-').map(Number);
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/** Days in month `m` (1-12) of year `y`. */
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (ymd, n) => {
  const [y, m, d] = parse(ymd);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
};
const daysBetween = (from, to) => {
  const [a, b] = [parse(from), parse(to)];
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY_MS);
};

/** Month number `i` (year * 12 + month - 1) on `day`, or that month's last day when it is shorter. */
const monthDay = (i, day) => {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return ymdOf(y, m, Math.min(day, daysInMonth(y, m)));
};

/**
 * A repeat as sent by the panel, checked. null / '' / 'never' / { unit: 'never' }
 * means "does not repeat" and returns null.
 *
 * @param {unknown} raw
 * @param {string|null} dueOn the task's due date — a monthly repeat with no day takes its day
 * @returns {{ every: number, unit: string, day?: number } | null}
 */
export function cleanRepeat(raw, dueOn) {
  if (raw == null || raw === '' || raw === 'never' || raw === false) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail('Pick how often the task repeats.', 400);
  if (raw.unit == null || raw.unit === '' || raw.unit === 'never') return null;
  if (!REPEAT_UNITS.includes(raw.unit)) throw fail('Pick how often the task repeats: days, weeks or months.', 400);
  const every = raw.every == null || raw.every === '' ? 1 : Number(raw.every);
  if (!Number.isInteger(every) || every < 1 || every > REPEAT_EVERY_MAX) {
    throw fail(`A task can repeat every 1 to ${REPEAT_EVERY_MAX} ${raw.unit}s.`, 400);
  }
  if (raw.unit !== 'month') return { every, unit: raw.unit };
  let day = raw.day == null || raw.day === '' ? null : Number(raw.day);
  if (day == null) {
    if (!dueOn || !YMD.test(dueOn)) throw fail('Pick the day of the month it is due.', 400);
    day = parse(dueOn)[2];
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) throw fail('Pick a day of the month from 1 to 31.', 400);
  return { every, unit: 'month', day };
}

/** One repeat later than `ymd` (always strictly after it). */
export function stepOnce(repeat, ymd) {
  if (repeat.unit === 'day') return addDays(ymd, repeat.every);
  if (repeat.unit === 'week') return addDays(ymd, repeat.every * 7);
  const [y, m, d] = parse(ymd);
  const day = repeat.day || d;
  const here = y * 12 + (m - 1);
  // This month's "day X" if it is still ahead of `ymd`, else `every` months on.
  const same = monthDay(here, day);
  return same > ymd ? same : monthDay(here + repeat.every, day);
}

/**
 * The next copy's due date: one repeat after `fromDue`, then on until it is
 * today or later (a task done late is not born overdue).
 *
 * @param {{ every: number, unit: string, day?: number }} repeat
 * @param {string} fromDue the done task's due date (today if it had none)
 * @param {string} today IST today
 */
export function nextDueOn(repeat, fromDue, today) {
  let next = stepOnce(repeat, fromDue);
  for (let i = 0; next < today && i < CATCH_UP_MAX; i += 1) next = stepOnce(repeat, next);
  return next < today ? today : next;
}

/** The start date moved with the due date, keeping the same number of days before it. */
export function shiftStart(startOn, fromDue, nextDue) {
  if (!startOn || !fromDue) return null;
  return addDays(nextDue, -Math.max(0, daysBetween(startOn, fromDue)));
}

const ordinal = (n) => {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};

/** "Every month on the 1st", "Every 2 weeks", "Every day" — for history lines and the panel. */
export function repeatLabel(repeat) {
  if (!repeat?.unit) return 'Never';
  const base = repeat.every === 1 ? `Every ${repeat.unit}` : `Every ${repeat.every} ${repeat.unit}s`;
  return repeat.unit === 'month' && repeat.day ? `${base} on the ${ordinal(repeat.day)}` : base;
}

/** Two repeats are the same rule. */
export const sameRepeat = (a, b) => repeatLabel(a) === repeatLabel(b);
