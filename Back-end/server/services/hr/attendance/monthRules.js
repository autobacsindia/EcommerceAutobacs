/**
 * The attendance policy for a payroll month, as PURE functions (owner
 * decisions 2026-11-26): payable / LOP days, late + early-leave marks → marks
 * LOP, approved overtime, unapproved absences. The DB layer is monthPolicy.js;
 * the app's month screen (viewService.monthView) shows the same numbers.
 *
 * All dates are IST calendar days ('YYYY-MM-DD'); the month is 'YYYY-MM'.
 */
import { monthDates, shiftWindow, MINUTE_MS } from './time.js';

/**
 * @typedef {object} AttendanceMonthSummary
 * @property {string} month              'YYYY-MM' asked for
 * @property {number} daysInMonth        calendar days in the month (28–31)
 * @property {number} shiftMinutes       the employee's shift length (start→end, e.g. 540 for 10:00–19:00).
 *                                       Hourly rate = monthly gross ÷ daysInMonth ÷ (shiftMinutes / 60).
 * @property {number} employedDays       days counted: inside joinDate..exitDate AND up to today (IST).
 *                                       After the month ends, = daysInMonth for someone employed all month.
 * @property {number} payableDays        paid days: present 1, half day ½, paid leave, holidays, weekly offs,
 *                                       the worked half of a half-leave day. Marks LOP is NOT subtracted here.
 * @property {number} lopDays            unpaid days: absent 1, half day ½, unpaid leave, an un-worked half of a
 *                                       half-leave day. payableDays + lopDays = employedDays.
 * @property {number} marks              lateCount + earlyCount (a day both late and early = 2 marks)
 * @property {number} lateCount          days with a late mark (arrived after start + graceMinutes, full days only)
 * @property {number} earlyCount         days with an early-leave mark (left before end − earlyGraceMinutes, full days only)
 * @property {number} marksPerHalfDayLop the setting used (0 = marks never cost pay)
 * @property {number} marksLopDays       floor(marks / marksPerHalfDayLop) × 0.5 — subtract from payableDays for pay
 * @property {number} otApprovedMinutes  approved overtime minutes (unapproved/rejected overtime = 0)
 * @property {number} otPendingDays      days whose overtime still waits for a decision (not paid yet)
 * @property {number} otPendingMinutes   overtime minutes still waiting for a decision
 * @property {number} absentUnapproved   absent days without approved leave (½ for an un-worked half of a half-leave day)
 * @property {number} unresolvedDays     days needing HR review (open day, pending punch) — resolve before locking
 * @property {object} breakdown          { presentDays, halfDays, absentDays, paidLeaveDays, unpaidLeaveDays,
 *                                         holidayDays, weeklyOffDays } for the payslip's explanation lines
 */

/** Minutes from shift start to shift end (overnight shifts wrap). */
export function shiftLengthMinutes(shift) {
  const { start, end } = shiftWindow('2026-01-05', shift);
  return Math.round((end - start) / MINUTE_MS);
}

/** floor(marks / per) × ½ day; per 0 = never. 3 → ½, 6 → 1, 7 → 1, 9 → 1½. */
export function marksLop(marks, per) {
  if (!(per > 0)) return 0;
  return Math.floor(marks / per) * 0.5;
}

const inEmployment = ({ joinDate, exitDate } = {}, date) => (!joinDate || date >= joinDate) && (!exitDate || date <= exitDate);

/**
 * Pure core.
 * @param {object} a
 * @param {string} a.month
 * @param {Array}  a.days        shaped days (shapeDay + date), up to today, one per date
 * @param {Map}    [a.leaveByDate] date → { halves, paid } (paid defaults to true)
 * @param {object} [a.employment] { joinDate, exitDate }
 * @param {number} a.shiftMinutes
 * @param {number} a.marksPerHalfDayLop
 * @returns {AttendanceMonthSummary}
 */
export function summariseAttendanceMonth({
  month, days, leaveByDate = new Map(), employment = {}, shiftMinutes, marksPerHalfDayLop,
}) {
  const b = {
    presentDays: 0, halfDays: 0, absentDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holidayDays: 0, weeklyOffDays: 0,
  };
  let employedDays = 0; let payableDays = 0; let lopDays = 0; let absentUnapproved = 0;
  let lateCount = 0; let earlyCount = 0; let otApprovedMinutes = 0; let otPendingDays = 0; let otPendingMinutes = 0; let unresolvedDays = 0;
  const pay = (n) => { payableDays += n; };
  const lop = (n) => { lopDays += n; };

  for (const d of days) {
    if (!inEmployment(employment, d.date)) continue;
    employedDays += 1;
    const paidLeave = leaveByDate.get(d.date)?.paid !== false;
    switch (d.status) {
      case 'present': pay(1); b.presentDays += 1; break;
      case 'half_day': pay(0.5); lop(0.5); b.halfDays += 1; break;
      case 'absent': lop(1); b.absentDays += 1; absentUnapproved += 1; break;
      case 'leave':
        if (paidLeave) { pay(1); b.paidLeaveDays += 1; } else { lop(1); b.unpaidLeaveDays += 1; }
        break;
      case 'half_leave':
        if (paidLeave) { pay(0.5); b.paidLeaveDays += 0.5; } else { lop(0.5); b.unpaidLeaveDays += 0.5; }
        // The other half must be worked; not turning up for it is an unapproved half absence.
        if (d.firstIn) { pay(0.5); b.presentDays += 0.5; } else { lop(0.5); b.absentDays += 0.5; absentUnapproved += 0.5; }
        break;
      case 'holiday': case 'holiday_worked': pay(1); b.holidayDays += 1; break;
      case 'weekly_off': pay(1); b.weeklyOffDays += 1; break;
      default: lop(1); b.absentDays += 1; absentUnapproved += 1; break; // unknown status: never pay by accident
    }
    if (d.lateMark) lateCount += 1;
    if (d.earlyMark) earlyCount += 1;
    otApprovedMinutes += d.overtimeApprovedMinutes || 0;
    if (d.overtimeStatus === 'pending') {
      otPendingDays += 1;
      otPendingMinutes += Math.max(0, (d.overtimeMinutes || 0) - (d.overtimeApprovedMinutes || 0));
    }
    if (d.needsReview) unresolvedDays += 1;
  }
  const marks = lateCount + earlyCount;
  return {
    month,
    daysInMonth: monthDates(month).length,
    shiftMinutes,
    employedDays,
    payableDays,
    lopDays,
    marks,
    lateCount,
    earlyCount,
    marksPerHalfDayLop,
    marksLopDays: marksLop(marks, marksPerHalfDayLop),
    otApprovedMinutes,
    otPendingDays,
    otPendingMinutes,
    absentUnapproved,
    unresolvedDays,
    breakdown: b,
  };
}
