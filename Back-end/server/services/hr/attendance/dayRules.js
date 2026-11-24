/**
 * The attendance rules for ONE day, as a pure function: punches + shift + leave
 * + holiday in, the AttendanceDay figures out. Pure so every rule (late, half
 * day, overtime, breaks, overnight, auto-close) is unit-tested without a DB,
 * and so monthSummary can compute days nobody punched on without writing rows.
 */
import { shiftWindow, minutesBetween, weekday } from './time.js';

/** Used when an employee has no shift and the company has no default shift yet (ADR §6 defaults). */
export const FALLBACK_SHIFT = Object.freeze({
  _id: null,
  start: '10:00',
  end: '19:00',
  graceMinutes: 10,
  latesPerHalfDayLop: 3,
  halfDayMinMinutes: 270,
  fullDayMinutes: 540,
  overtimeAfterMinutes: 540,
  breakAllowanceMinutes: 60,
  weeklyOff: Object.freeze([0]),
});

/**
 * Walk the ACCEPTED punches in time order. Out-of-sequence rows (only possible
 * from HR manual entries) are skipped rather than trusted.
 */
export function walkPunches(punches) {
  let state = 'none';
  let sessionStart = null;
  let breakStart = null;
  let sessionMinutes = 0;
  let breakMinutes = 0;
  let firstIn = null;
  let lastOut = null;
  let autoClosed = false;
  for (const p of punches) {
    if (p.status !== 'accepted') continue;
    if (p.type === 'in' && (state === 'none' || state === 'out')) {
      sessionStart = p.at; firstIn = firstIn || p.at; state = 'in';
    } else if (p.type === 'break_start' && state === 'in') {
      breakStart = p.at; state = 'break';
    } else if (p.type === 'break_end' && state === 'break') {
      breakMinutes += minutesBetween(breakStart, p.at); state = 'in';
    } else if (p.type === 'out' && (state === 'in' || state === 'break')) {
      if (state === 'break') breakMinutes += minutesBetween(breakStart, p.at);
      sessionMinutes += minutesBetween(sessionStart, p.at);
      lastOut = p.at;
      if (p.source === 'auto_close') autoClosed = true;
      state = 'out';
    }
  }
  return {
    state, firstIn, lastOut, sessionMinutes, breakMinutes, autoClosed, open: state === 'in' || state === 'break',
  };
}

/**
 * Which punch types may come next after `state` (the app's buttons, and the
 * server's sequence rule).
 */
export const NEXT_TYPES = Object.freeze({
  none: ['in'],
  out: ['in'],
  in: ['break_start', 'out'],
  break: ['break_end', 'out'],
});

/** Is the list (time order, accepted + pending) a valid sequence? */
export function isValidSequence(punches) {
  let state = 'none';
  for (const p of punches) {
    if (!NEXT_TYPES[state].includes(p.type)) return false;
    state = { in: 'in', out: 'out', break_start: 'break', break_end: 'in' }[p.type];
  }
  return true;
}

/** State after a time-ordered list of punches (accepted + pending). */
export function stateAfter(punches) {
  let state = 'none';
  for (const p of punches) {
    if (NEXT_TYPES[state].includes(p.type)) state = { in: 'in', out: 'out', break_start: 'break', break_end: 'in' }[p.type];
  }
  return state;
}

/**
 * @param {object} a
 * @param {string} a.date        IST workday
 * @param {object} a.shift       HrShift (or FALLBACK_SHIFT)
 * @param {Array}  a.punches     that workday's punches (accepted + pending), time order
 * @param {object} [a.leave]     { halves: 1|2, paid } or null
 * @param {boolean}[a.holiday]
 * @param {string} a.today       IST date "now", to tell past days from today
 * @returns the AttendanceDay fields (without employee/locks)
 */
export function computeDay({
  date, shift = FALLBACK_SHIFT, punches = [], leave = null, holiday = false, today,
}) {
  const w = walkPunches(punches);
  const pending = punches.some((p) => p.status === 'pending_review');
  const isPast = date < today;
  const weeklyOff = (shift.weeklyOff || []).includes(weekday(date));
  const hasWork = !!w.firstIn;

  // Breaks within the allowance are paid time; only the excess is deducted.
  const excessBreak = Math.max(0, w.breakMinutes - (shift.breakAllowanceMinutes || 0));
  const workedMinutes = Math.max(0, w.sessionMinutes - excessBreak);

  let status;
  if (holiday || weeklyOff) status = hasWork ? 'holiday_worked' : (holiday ? 'holiday' : 'weekly_off');
  else if (leave?.halves >= 2) status = 'leave';
  else if (leave?.halves === 1) status = 'half_leave';
  else if (!hasWork) status = 'absent';
  else if (w.open && !isPast) status = 'present'; // still at work today
  else status = workedMinutes >= shift.halfDayMinMinutes ? 'present' : 'half_day';

  // Late marks only on a normal working day without leave.
  let lateMinutes = 0;
  let isLate = false;
  if (hasWork && (status === 'present' || status === 'half_day')) {
    const { start } = shiftWindow(date, shift);
    lateMinutes = minutesBetween(start, w.firstIn);
    isLate = new Date(w.firstIn) - start > (shift.graceMinutes || 0) * 60000;
    if (!isLate) lateMinutes = 0;
  }

  // Hours closed by the auto-close job are a guess at the shift end: never overtime.
  const overtimeMinutes = hasWork && !w.autoClosed ? Math.max(0, workedMinutes - shift.overtimeAfterMinutes) : 0;

  return {
    shift: shift._id || null,
    status,
    firstIn: w.firstIn || null,
    lastOut: w.lastOut || null,
    workedMinutes,
    breakMinutes: w.breakMinutes,
    lateMinutes,
    isLate,
    overtimeMinutes,
    autoClosed: w.autoClosed,
    needsReview: pending || (w.open && isPast),
  };
}
