/**
 * Public surface of the attendance module for other HR sessions
 * (docs/ADR-hr-system.md §4). Payroll, leave and exit import from HERE (or
 * devices.js for revokeDevices), never from the attendance repositories.
 *
 *   monthAttendanceSummary(employeeId, month) → THE payroll input (monthPolicy.js; payroll calls only this)
 *   monthSummary(employeeId, month)        → the app's month screen counts
 *   markMonthLocked(month, session)        → payroll locked the month
 *   markMonthUnlocked(month, session)      → payroll unlocked it (added; see PR)
 *   changedAfterLock(month)                → days changed since the lock (arrears)
 *   recomputeDays(employeeId, from, to)    → leave/holiday changes (leave calls this)
 */
export {
  monthSummary, markMonthLocked, markMonthUnlocked, changedAfterLock,
} from './viewService.js';
export { recomputeDays } from './dayService.js';
export { monthAttendanceSummary } from './monthPolicy.js';
export { revokeDevices } from './devices.js';
