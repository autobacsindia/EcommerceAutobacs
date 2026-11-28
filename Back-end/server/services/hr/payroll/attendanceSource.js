/**
 * THE one import payroll uses for attendance (hr-phase2-contract.md):
 *
 *   monthAttendanceSummary(employeeId, 'YYYY-MM') →
 *     { daysInMonth, payableDays, lopDays, marks, marksLopDays, lateCount, earlyCount,
 *       otApprovedMinutes, absentUnapproved, shiftMinutes?, unresolvedDays? }
 *
 * The real function is being built by the attendance-policy session in
 * services/hr/attendance. Until it lands, this is a STUB with the same signature,
 * adapted from phase-1 `monthSummary` (no early-leave marks yet, no paid/unpaid
 * leave split: every leave day is treated as paid).
 *
 * Switching = replace the body below with ONE line:
 *   export { monthAttendanceSummary } from '../attendance/index.js';
 *
 * Contract payroll relies on (tell the attendance-policy session if it differs):
 *   - lopDays = unapproved absences + unpaid leave, in whole or half days;
 *     days before joinDate / after exitDate are NOT in it (payroll counts those);
 *   - marksLopDays is already worked out (every N marks = ½ day);
 *   - otApprovedMinutes is only overtime someone approved.
 */
import { monthSummary, markMonthLocked, markMonthUnlocked } from '../attendance/index.js';
import { PAYROLL_DEFAULTS } from './rules.js';

export async function monthAttendanceSummary(employeeId, month) {
  const s = await monthSummary(employeeId, month);
  const lopDays = (s.absentDays || 0) + (s.halfDays || 0) * 0.5;
  const marks = s.lateMarks || 0;
  const perHalf = PAYROLL_DEFAULTS.marksPerHalfDayLop;
  return {
    daysInMonth: s.daysInMonth,
    payableDays: s.daysInMonth - lopDays,
    lopDays,
    marks,
    marksLopDays: perHalf > 0 ? Math.floor(marks / perHalf) * 0.5 : 0,
    lateCount: marks,
    earlyCount: 0,
    otApprovedMinutes: s.overtimeApprovedMinutes || 0,
    absentUnapproved: s.absentDays || 0,
    unresolvedDays: s.unresolvedDays || 0,
    shiftMinutes: PAYROLL_DEFAULTS.defaultShiftMinutes,
  };
}

/** Flag / unflag the month's AttendanceDays `payrollLocked` (attendance owns the rows). */
export { markMonthLocked, markMonthUnlocked };
