/**
 * AttendanceDay — the recomputable read model (docs/ADR-hr-system.md §2).
 *
 * `recomputeDay` is called after EVERY accepted punch, decided review, approved
 * correction, auto-close and (through `recomputeDays`) every leave decision or
 * holiday change. It rebuilds the row from the source facts, so running it twice
 * is harmless and a missed call is repaired by the next one.
 *
 * Locked months: once payroll locks a month the row keeps being recomputed (the
 * truth still matters) but any change to what payroll reads sets
 * `changedAfterLock`, which payroll turns into arrears next month.
 */
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import attendanceDayRepository from '../../../repositories/hr/attendanceDayRepository.js';
import attendancePunchRepository from '../../../repositories/hr/attendancePunchRepository.js';
import attendanceSetupRepository from '../../../repositories/hr/attendanceSetupRepository.js';
import AppError from '../../../utils/AppError.js';
import { DATE_RE } from '../../../config/hr.js';
import { computeDay, FALLBACK_SHIFT } from './dayRules.js';
import { calendarFacts } from './calendar.js';
import { istDate, monthOf, addDays } from './time.js';

const MAX_RECOMPUTE_DAYS = 62;
// What payroll reads: a change to any of these after the lock is an arrears line.
const PAYROLL_FIELDS = ['status', 'workedMinutes', 'isLate', 'overtimeApprovedMinutes'];

/** The employee's shift, else the company default, else the built-in default. */
export async function shiftFor(employee, session = null) {
  if (employee?.shift) {
    const s = await attendanceSetupRepository.findShiftById(employee.shift);
    if (s && s.active) return s;
  }
  void session;
  return (await attendanceSetupRepository.findDefaultShift()) || FALLBACK_SHIFT;
}

const payrollChanged = (before, after) => !before
  || PAYROLL_FIELDS.some((f) => String(before[f] ?? '') !== String(after[f] ?? ''));

/**
 * Rebuild one day. `employee` is a lean EmployeeProfile (needs _id, shift, workSites).
 * Runs inside `session` when given (the punch/correction transaction).
 */
export async function recomputeDay(employee, date, { session = null, now = new Date(), shift = null } = {}) {
  if (!DATE_RE.test(date)) throw new AppError('Invalid date', 400, { expose: true });
  const theShift = shift || await shiftFor(employee, session);
  // Sequential on purpose: operations on one transaction session must not run concurrently.
  const punches = await attendancePunchRepository.listForDay(employee._id, date, session);
  const existing = await attendanceDayRepository.find(employee._id, date, session);
  const locked = existing?.payrollLocked || await attendanceDayRepository.isMonthLocked(monthOf(date), session);
  const { leaveByDate, holidays } = await calendarFacts(employee._id, date, date, employee.workSites || []);

  const fields = computeDay({
    date, shift: theShift, punches, leave: leaveByDate.get(date) || null, holiday: holidays.has(date), today: istDate(now),
  });
  const set = {
    ...fields,
    month: monthOf(date),
    // HR approves overtime on a figure; if the hours later shrink, the approval shrinks with them.
    overtimeApprovedMinutes: Math.min(existing?.overtimeApprovedMinutes || 0, fields.overtimeMinutes),
    computedAt: now,
  };
  if (locked) {
    set.payrollLocked = true;
    if (existing?.changedAfterLock || payrollChanged(existing, set)) set.changedAfterLock = true;
  }
  return attendanceDayRepository.upsert(employee._id, date, set, session);
}

/**
 * Recompute every day in [from, to] for one employee (leave decisions, holiday
 * edits). Exported for the leave module (services/hr/leave notifyAttendance).
 */
export async function recomputeDays(employeeId, from, to, { now = new Date() } = {}) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) throw new AppError('from/to must be dates with from ≤ to', 400, { expose: true });
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) return { recomputed: 0 };
  const shift = await shiftFor(employee);
  let n = 0;
  for (let d = from; d <= to && n < MAX_RECOMPUTE_DAYS; d = addDays(d, 1)) {
    // Only past days and today: a future day has no attendance to show yet.
    if (d > istDate(now)) break;
    await recomputeDay(employee, d, { now, shift });
    n += 1;
  }
  return { recomputed: n };
}

export const shapeDay = (d) => (d ? {
  date: d.date,
  status: d.status,
  firstIn: d.firstIn || null,
  lastOut: d.lastOut || null,
  workedMinutes: d.workedMinutes || 0,
  breakMinutes: d.breakMinutes || 0,
  lateMinutes: d.lateMinutes || 0,
  isLate: !!d.isLate,
  overtimeMinutes: d.overtimeMinutes || 0,
  overtimeApprovedMinutes: d.overtimeApprovedMinutes || 0,
  autoClosed: !!d.autoClosed,
  needsReview: !!d.needsReview,
  payrollLocked: !!d.payrollLocked,
  changedAfterLock: !!d.changedAfterLock,
} : null);
