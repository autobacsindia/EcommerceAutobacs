/**
 * Read side: an employee's month, HR's "today" board, the app's status screen,
 * and the payroll exports (monthSummary / markMonthLocked / changedAfterLock).
 *
 * Days nobody punched on have no AttendanceDay row. They are computed on the
 * fly from the same pure rules (dayRules.computeDay) — absent, weekly off,
 * holiday or leave — without writing, so a month read never fans out into writes.
 */
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import attendanceDayRepository from '../../../repositories/hr/attendanceDayRepository.js';
import attendancePunchRepository from '../../../repositories/hr/attendancePunchRepository.js';
import attendanceSetupRepository from '../../../repositories/hr/attendanceSetupRepository.js';
import { MONTH_RE } from '../../../config/hr.js';
import { isHrOrAdmin, isActiveStaffUser } from '../../../middleware/hrAuth.js';
import { listEmployees } from '../employeeService.js';
import { faceStatus } from '../face/faceService.js';
import { fail } from './errors.js';
import { computeDay, stateAfter, NEXT_TYPES } from './dayRules.js';
import { shapeDay, shiftFor } from './dayService.js';
import { calendarFacts } from './calendar.js';
import { shapePunch } from './punchService.js';
import { listDevices } from './devices.js';
import { istDate, monthDates } from './time.js';
import { summariseAttendanceMonth, shiftLengthMinutes } from './monthRules.js';
import { getHrSettings } from '../settings.js';

const CHANGED_AFTER_LOCK_MAX = 5000;

/**
 * Every day of `month` up to today: stored rows, plus computed rows for days
 * without one. Also returns the inputs it read (shift, leave/holiday facts), so
 * the payroll summary does not read them twice.
 */
export async function loadMonth(employee, month, now = new Date()) {
  if (!MONTH_RE.test(String(month))) throw fail('month must look like 2026-12', 400);
  const today = istDate(now);
  const dates = monthDates(month).filter((d) => d <= today);
  const shift = await shiftFor(employee);
  if (!dates.length) return { days: [], shift, facts: { leaveByDate: new Map(), holidays: new Set() } };
  const [rows, facts] = await Promise.all([
    attendanceDayRepository.listMonth(employee._id, month),
    calendarFacts(employee._id, dates[0], dates[dates.length - 1], employee.workSites || []),
  ]);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const days = dates.map((date) => {
    const stored = byDate.get(date);
    if (stored) return { ...shapeDay(stored), stored: true };
    const c = computeDay({
      date, shift, punches: [], leave: facts.leaveByDate.get(date) || null, holiday: facts.holidays.has(date), today,
    });
    return {
      ...shapeDay({ ...c, date, overtimeApprovedMinutes: 0 }), stored: false,
    };
  });
  return { days, shift, facts };
}

async function monthDays(employee, month, now = new Date()) {
  return (await loadMonth(employee, month, now)).days;
}

const inEmployment = (employee, date) => (!employee.joinDate || date >= employee.joinDate)
  && (!employee.exitDate || date <= employee.exitDate);

function summarise(employee, month, days) {
  const s = {
    daysInMonth: monthDates(month).length,
    presentDays: 0,
    halfDays: 0,
    absentDays: 0,
    leaveDays: 0,
    holidayDays: 0,
    weeklyOffDays: 0,
    lateMarks: 0,
    earlyMarks: 0,
    overtimeApprovedMinutes: 0,
    unresolvedDays: 0,
  };
  for (const d of days) {
    if (!inEmployment(employee, d.date)) continue;
    switch (d.status) {
      case 'present': s.presentDays += 1; break;
      case 'half_day': s.halfDays += 1; break;
      case 'absent': s.absentDays += 1; break;
      case 'leave': s.leaveDays += 1; break;
      case 'half_leave': s.leaveDays += 0.5; s.presentDays += 0.5; break;
      case 'holiday': case 'holiday_worked': s.holidayDays += 1; break;
      case 'weekly_off': s.weeklyOffDays += 1; break;
      default: break;
    }
    if (d.lateMark) s.lateMarks += 1;
    if (d.earlyMark) s.earlyMarks += 1;
    s.overtimeApprovedMinutes += d.overtimeApprovedMinutes || 0;
    if (d.needsReview) s.unresolvedDays += 1;
  }
  return s;
}

/**
 * The month screen (app "My attendance", HR employee page). `summary` also
 * carries the policy counts the employee is paid on: lateCount, earlyCount,
 * marks, marksLopDays, otApprovedMinutes, otPendingMinutes (monthRules.js).
 */
export async function monthView(employee, month, now = new Date()) {
  const [{ days, shift, facts }, settings] = await Promise.all([loadMonth(employee, month, now), getHrSettings()]);
  const policy = summariseAttendanceMonth({
    month,
    days,
    leaveByDate: facts.leaveByDate,
    employment: { joinDate: employee.joinDate, exitDate: employee.exitDate },
    shiftMinutes: shiftLengthMinutes(shift),
    marksPerHalfDayLop: settings.marksPerHalfDayLop ?? 3,
  });
  return {
    month,
    days,
    summary: {
      ...summarise(employee, month, days),
      lateCount: policy.lateCount,
      earlyCount: policy.earlyCount,
      marks: policy.marks,
      marksPerHalfDayLop: policy.marksPerHalfDayLop,
      marksLopDays: policy.marksLopDays,
      otApprovedMinutes: policy.otApprovedMinutes,
      otPendingMinutes: policy.otPendingMinutes,
    },
  };
}

// ── Payroll exports (docs/ADR-hr-system.md §4) ───────────────────────────────
/**
 * { daysInMonth, presentDays, halfDays, absentDays, leaveDays, holidayDays,
 *   weeklyOffDays, lateMarks, earlyMarks, overtimeApprovedMinutes, unresolvedDays }
 * (The app's month screen. Payroll uses monthAttendanceSummary — monthPolicy.js.)
 * Days before joinDate / after exitDate are not counted in any bucket (payroll
 * pro-rates on those dates). 'half_leave' counts ½ leave + ½ present;
 * 'holiday_worked' (a holiday or weekly off with punches) counts as a holiday —
 * any extra pay for it is overtime HR approves.
 */
export async function monthSummary(employeeId, month, { now = new Date() } = {}) {
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw fail('Employee not found', 404);
  const days = await monthDays(employee, month, now);
  return summarise(employee, month, days);
}

/** Payroll locked `month`: flag every day row (and remember the lock for days that get a row later). */
export async function markMonthLocked(month, session = null) {
  if (!MONTH_RE.test(String(month))) throw fail('month must look like 2026-12', 400);
  await attendanceDayRepository.setMonthLock(month, true, new Date(), session);
  const r = await attendanceDayRepository.flagMonth(month, { payrollLocked: true, changedAfterLock: false }, session);
  return { flagged: r.modifiedCount ?? 0 };
}

/** Payroll unlocked `month` (to recompute): rows stop being flagged as changed-after-lock. */
export async function markMonthUnlocked(month, session = null) {
  if (!MONTH_RE.test(String(month))) throw fail('month must look like 2026-12', 400);
  await attendanceDayRepository.setMonthLock(month, false, new Date(), session);
  const r = await attendanceDayRepository.flagMonth(month, { payrollLocked: false, changedAfterLock: false }, session);
  return { unflagged: r.modifiedCount ?? 0 };
}

/** Days of a locked month that changed after the lock: [{ employee, date, status, workedMinutes, overtimeApprovedMinutes }]. */
export async function changedAfterLock(month) {
  if (!MONTH_RE.test(String(month))) throw fail('month must look like 2026-12', 400);
  const rows = await attendanceDayRepository.listChangedAfterLock(month, CHANGED_AFTER_LOCK_MAX);
  return rows.map((r) => ({
    employee: String(r.employee), date: r.date, status: r.status, workedMinutes: r.workedMinutes, overtimeApprovedMinutes: r.overtimeApprovedMinutes || 0,
  }));
}

// ── Today board ──────────────────────────────────────────────────────────────
/**
 * HR/admin: everyone (optionally one team); an active team head: their own
 * team only, whatever `team` they ask for. Anyone else: 403.
 */
export async function todayBoard(actor, { team, cursor, limit } = {}, now = new Date()) {
  let teamFilter = team || undefined;
  if (!isHrOrAdmin(actor)) {
    if (!(isActiveStaffUser(actor) && actor.staff.isHead === true && actor.staff.team)) {
      throw fail('Only HR, an administrator or a team head can see this', 403);
    }
    teamFilter = actor.staff.team;
  }
  const date = istDate(now);
  const pageOf = await listEmployees({
    status: 'current', team: teamFilter, cursor, limit,
  });
  const ids = pageOf.items.map((e) => e.id);
  const days = ids.length ? await attendanceDayRepository.listForEmployeesOn(ids, date) : [];
  const byEmployee = new Map(days.map((d) => [String(d.employee), d]));
  return {
    date,
    items: pageOf.items.map((e) => {
      const d = byEmployee.get(e.id);
      return {
        employee: { id: e.id, name: e.name, employeeCode: e.employeeCode, team: e.team, designation: e.designation },
        day: d ? shapeDay(d) : null,
        state: d ? (d.lastOut && !d.needsReview ? 'out' : 'in') : 'not_in',
      };
    }),
    nextCursor: pageOf.nextCursor,
  };
}

// ── The app's status screen ──────────────────────────────────────────────────
/** Everything the app needs to draw the punch screen, in one call. */
export async function myStatus(employee, now = new Date()) {
  const date = istDate(now);
  const [face, shift, sites, punches, day, devices] = await Promise.all([
    faceStatus(employee._id),
    shiftFor(employee),
    (employee.workSites || []).length ? attendanceSetupRepository.findActiveSitesByIds(employee.workSites) : [],
    attendancePunchRepository.listForDay(employee._id, date),
    attendanceDayRepository.find(employee._id, date),
    listDevices(employee._id),
  ]);
  const state = stateAfter(punches);
  return {
    date,
    face,
    manualAttendance: !!employee.manualAttendance,
    anywhereAllowed: !!employee.anywhereAllowed,
    shift: {
      id: shift._id ? String(shift._id) : null, name: shift.name || 'Standard', start: shift.start, end: shift.end, weeklyOff: shift.weeklyOff,
    },
    sites: sites.map((s) => ({
      id: String(s._id), name: s.name, lat: s.lat, lng: s.lng, radiusM: s.radiusM,
    })),
    today: {
      state, allowedTypes: NEXT_TYPES[state], punches: punches.map((p) => shapePunch(p)), day: shapeDay(day),
    },
    devices: devices.filter((d) => d.active || d.pendingApproval),
  };
}
