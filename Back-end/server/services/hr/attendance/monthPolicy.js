/**
 * The attendance policy for a payroll month (owner decisions 2026-11-26):
 * payable / LOP days, late + early-leave marks → marks LOP, approved overtime,
 * unapproved absences. Payroll calls ONLY `monthAttendanceSummary`.
 *
 * Pure core (monthRules.js `summariseAttendanceMonth`) + this thin DB layer, so
 * every rule is a unit-tested worked example and this file only gathers inputs.
 *
 * All dates are IST calendar days ('YYYY-MM-DD'); the month is 'YYYY-MM'.
 */
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { MONTH_RE } from '../../../config/hr.js';
import { getHrSettings } from '../settings.js';
import { fail } from './errors.js';
import { loadMonth } from './viewService.js';
import { summariseAttendanceMonth, shiftLengthMinutes } from './monthRules.js';

export { summariseAttendanceMonth, shiftLengthMinutes, marksLop } from './monthRules.js';
/** @typedef {import('./monthRules.js').AttendanceMonthSummary} AttendanceMonthSummary */

/**
 * THE function payroll calls. Reads the employee, their shift, the month's day
 * rows (computing days nobody punched on), leave/holiday facts and HrSettings.
 * Read-only: never writes.
 *
 * @param {string|import('mongoose').Types.ObjectId} employeeId EmployeeProfile id
 * @param {string} month 'YYYY-MM' (IST)
 * @param {{ now?: Date }} [opts] `now` decides "up to today" (tests)
 * @returns {Promise<AttendanceMonthSummary>}
 * @throws 400 bad month, 404 unknown employee
 */
export async function monthAttendanceSummary(employeeId, month, { now = new Date() } = {}) {
  if (!MONTH_RE.test(String(month))) throw fail('month must look like 2026-12', 400);
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw fail('Employee not found', 404);
  const [{ days, shift, facts }, settings] = await Promise.all([loadMonth(employee, month, now), getHrSettings()]);
  return summariseAttendanceMonth({
    month,
    days,
    leaveByDate: facts.leaveByDate,
    employment: { joinDate: employee.joinDate, exitDate: employee.exitDate },
    shiftMinutes: shiftLengthMinutes(shift),
    marksPerHalfDayLop: settings.marksPerHalfDayLop ?? 3,
  });
}
