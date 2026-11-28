/**
 * The attendance rules for ONE day, as a pure function: punches + shift + leave
 * + holiday in, the AttendanceDay figures out. Pure so every rule (late, half
 * day, overtime, breaks, overnight, auto-close) is unit-tested without a DB,
 * and so monthSummary can compute days nobody punched on without writing rows.
 */
import {
  shiftWindow, minutesBetween, weekday, MINUTE_MS,
} from './time.js';

/** Used when an employee has no shift and the company has no default shift yet (ADR §6 defaults). */
export const FALLBACK_SHIFT = Object.freeze({
  _id: null,
  start: '10:00',
  end: '19:00',
  graceMinutes: 10,
  earlyGraceMinutes: 10,
  latesPerHalfDayLop: 3,
  halfDayMinMinutes: 270,
  absentBelowMinutes: 120,
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

const floorMinute = (at) => Math.floor(new Date(at).getTime() / MINUTE_MS);
/** Whole clock minutes `firstIn` is after `start` (0 when on time or early). */
const clockLate = (firstIn, start) => Math.max(0, floorMinute(firstIn) - floorMinute(start));
/** Whole clock minutes `lastOut` is before `end` (0 when at or after the end). */
const clockEarly = (lastOut, end) => Math.max(0, floorMinute(end) - floorMinute(lastOut));

/**
 * The overtime approval state after a recompute, from the row as it was and
 * the freshly computed overtime minutes. Pure.
 *   - no overtime                                   → none (and nothing approved)
 *   - never decided                                 → pending
 *   - decided, and the hours did not grow past it   → the decision stands
 *     (approved minutes shrink with the hours, never grow on their own)
 *   - decided, but more overtime appeared since     → pending again, the approved
 *     minutes kept, so the extra gets its own decision
 */
export function overtimeStateAfter(before, overtimeMinutes) {
  if (!(overtimeMinutes > 0)) return { overtimeStatus: 'none', overtimeApprovedMinutes: 0 };
  const status = before?.overtimeStatus;
  const approved = Math.min(before?.overtimeApprovedMinutes || 0, overtimeMinutes);
  if (status !== 'approved' && status !== 'rejected') {
    // Rows written before overtimeStatus existed may carry an approval already.
    if (!status && approved > 0) return { overtimeStatus: 'approved', overtimeApprovedMinutes: approved };
    return { overtimeStatus: 'pending', overtimeApprovedMinutes: approved };
  }
  if (overtimeMinutes > (before.overtimeDecidedOn || 0)) return { overtimeStatus: 'pending', overtimeApprovedMinutes: approved };
  return { overtimeStatus: status, overtimeApprovedMinutes: approved };
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

  const closed = hasWork && !(w.open && !isPast);
  let status;
  if (holiday || weeklyOff) status = hasWork ? 'holiday_worked' : (holiday ? 'holiday' : 'weekly_off');
  else if (leave?.halves >= 2) status = 'leave';
  else if (leave?.halves === 1) status = 'half_leave';
  else if (!hasWork) status = 'absent';
  else if (!closed) status = 'present'; // still at work today
  else if (workedMinutes < (shift.absentBelowMinutes ?? FALLBACK_SHIFT.absentBelowMinutes)) status = 'absent';
  else status = workedMinutes >= shift.halfDayMinMinutes ? 'present' : 'half_day';

  // Late / early are measured on a normal working day without leave, by the
  // CLOCK MINUTE (seconds dropped): with a 09:00 start and 10 min grace, 09:10:59
  // is on time and 09:11 is late; with an 18:00 end, leaving at 17:50 is fine
  // and 17:49 is early. That is what the employee and HR read on the clock.
  const workingDay = hasWork && (status === 'present' || status === 'half_day');
  const { start, end } = shiftWindow(date, shift);
  const lateMinutes = workingDay ? clockLate(w.firstIn, start) : 0;
  const isLate = lateMinutes > (shift.graceMinutes || 0);
  // Early only once the day is closed by a real punch: the auto-close punch is
  // at the shift end by definition, and an open day has not ended yet.
  const earlyMinutes = workingDay && closed && w.lastOut ? clockEarly(w.lastOut, end) : 0;
  const isEarly = earlyMinutes > (shift.earlyGraceMinutes ?? FALLBACK_SHIFT.earlyGraceMinutes);
  // A mark only on a full 'present' day: a short day already costs pay.
  const lateMark = isLate && status === 'present';
  const earlyMark = isEarly && status === 'present';

  // Hours closed by the auto-close job are a guess at the shift end: never overtime.
  const overtimeMinutes = hasWork && !w.autoClosed ? Math.max(0, workedMinutes - shift.overtimeAfterMinutes) : 0;

  return {
    shift: shift._id || null,
    status,
    firstIn: w.firstIn || null,
    lastOut: w.lastOut || null,
    workedMinutes,
    breakMinutes: w.breakMinutes,
    lateMinutes: isLate ? lateMinutes : 0,
    isLate,
    earlyMinutes: isEarly ? earlyMinutes : 0,
    isEarly,
    lateMark,
    earlyMark,
    overtimeMinutes,
    autoClosed: w.autoClosed,
    needsReview: pending || (w.open && isPast),
  };
}
