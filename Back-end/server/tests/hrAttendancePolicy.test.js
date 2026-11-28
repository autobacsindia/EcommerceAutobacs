/**
 * Attendance policy (owner decisions 2026-11-26) as worked examples, no DB:
 *   - late: 09:00 shift, 10 min grace → 09:10 on time, 09:11 a mark
 *   - early leave: 18:00 end, 10 min early grace → 17:50 fine, 17:49 a mark
 *   - a short (half) day is never also a mark; worked < 120 min = absent
 *   - every 3 marks = ½ day LOP: 3/6/7/9 marks → 0.5/1/1/1.5 days
 *   - overtime: unapproved = 0 paid; auto-closed never; approval follows the hours
 *   - who may decide overtime (HR, own team head, never yourself)
 *   - the month summary payroll reads (payable/LOP/marks/OT/absences)
 */
import { computeDay, overtimeStateAfter, FALLBACK_SHIFT } from '../services/hr/attendance/dayRules.js';
import {
  summariseAttendanceMonth, marksLop, shiftLengthMinutes,
} from '../services/hr/attendance/monthRules.js';
import { canDecideOvertime } from '../services/hr/attendance/overtimeService.js';
import { istInstant } from '../services/hr/attendance/time.js';

const D = '2026-12-02'; // a Wednesday
const NINE_TO_SIX = { ...FALLBACK_SHIFT, start: '09:00', end: '18:00' };
const p = (type, hhmm, extra = {}) => ({
  type, at: istInstant(D, hhmm), status: 'accepted', source: 'app', ...extra,
});
const atSec = (hhmm, sec) => new Date(istInstant(D, hhmm).getTime() + sec * 1000);
const day = (punches, extra = {}) => computeDay({
  date: D, shift: NINE_TO_SIX, punches, today: '2026-12-10', ...extra,
});

describe('late mark (09:00 start, 10 min grace)', () => {
  test('09:10 → no mark; 09:11 → mark with 11 late minutes', () => {
    expect(day([p('in', '09:10'), p('out', '18:00')])).toMatchObject({
      status: 'present', isLate: false, lateMark: false, lateMinutes: 0,
    });
    expect(day([p('in', '09:11'), p('out', '18:00')])).toMatchObject({
      status: 'present', isLate: true, lateMark: true, lateMinutes: 11,
    });
  });
  test('seconds do not count: 09:10:59 is still on time', () => {
    expect(day([{ ...p('in', '09:10'), at: atSec('09:10', 59) }, p('out', '18:00')]).lateMark).toBe(false);
  });
  test('a different grace from the shift is honoured', () => {
    expect(day([p('in', '09:11'), p('out', '18:00')], { shift: { ...NINE_TO_SIX, graceMinutes: 15 } }).lateMark).toBe(false);
  });
});

describe('early-leave mark (18:00 end, 10 min early grace)', () => {
  test('17:50 → no mark; 17:49 → mark with 11 early minutes', () => {
    expect(day([p('in', '09:00'), p('out', '17:50')])).toMatchObject({ isEarly: false, earlyMark: false, earlyMinutes: 0 });
    expect(day([p('in', '09:00'), p('out', '17:49')])).toMatchObject({
      status: 'present', isEarly: true, earlyMark: true, earlyMinutes: 11,
    });
  });
  test('17:49:30 on the clock is 17:49 → a mark', () => {
    expect(day([p('in', '09:00'), { ...p('out', '17:49'), at: atSec('17:49', 30) }]).earlyMark).toBe(true);
  });
  test('late AND early on one day = two marks', () => {
    expect(day([p('in', '09:30'), p('out', '17:30')])).toMatchObject({ status: 'present', lateMark: true, earlyMark: true });
  });
  test('earlyGraceMinutes from the shift is honoured', () => {
    expect(day([p('in', '09:00'), p('out', '17:45')], { shift: { ...NINE_TO_SIX, earlyGraceMinutes: 20 } }).earlyMark).toBe(false);
  });
  test('an open day (still at work today) is never early', () => {
    expect(day([p('in', '09:00'), p('out', '12:00'), p('in', '13:00')], { today: D })).toMatchObject({ status: 'present', earlyMark: false });
  });
  test('an auto-closed day (closed at the shift end) is not early', () => {
    expect(day([p('in', '09:00'), p('out', '18:00', { source: 'auto_close' })])).toMatchObject({ earlyMark: false, autoClosed: true });
  });
});

describe('short days and absences', () => {
  test('a half day is not also a mark (late + left early, 3 h worked)', () => {
    const d = day([p('in', '10:00'), p('out', '13:00')]);
    expect(d).toMatchObject({ status: 'half_day', isLate: true, isEarly: true, lateMark: false, earlyMark: false });
  });
  test('worked under absentBelowMinutes (120) is absent; exactly 120 is a half day', () => {
    expect(day([p('in', '09:00'), p('out', '10:59')]).status).toBe('absent');
    expect(day([p('in', '09:00'), p('out', '11:00')]).status).toBe('half_day');
    expect(day([p('in', '09:00'), p('out', '10:30')], { shift: { ...NINE_TO_SIX, absentBelowMinutes: 60 } }).status).toBe('half_day');
  });
  test('an absent (too short) day carries no marks', () => {
    expect(day([p('in', '15:00'), p('out', '16:00')])).toMatchObject({ status: 'absent', lateMark: false, earlyMark: false });
  });
  test('a half-leave day is never a mark', () => {
    expect(day([p('in', '13:30'), p('out', '18:00')], { leave: { halves: 1, paid: true } }))
      .toMatchObject({ status: 'half_leave', lateMark: false, earlyMark: false });
  });
});

describe('overtime', () => {
  test('after 9 h worked; auto-closed days never earn it', () => {
    expect(day([p('in', '09:00'), p('out', '20:00')]).overtimeMinutes).toBe(120);
    expect(day([p('in', '07:00'), p('out', '20:00', { source: 'auto_close' })]).overtimeMinutes).toBe(0);
  });
  test('overtimeStateAfter: new overtime waits for a decision with 0 approved (unapproved = 0 paid)', () => {
    expect(overtimeStateAfter(null, 120)).toEqual({ overtimeStatus: 'pending', overtimeApprovedMinutes: 0 });
    expect(overtimeStateAfter(null, 0)).toEqual({ overtimeStatus: 'none', overtimeApprovedMinutes: 0 });
  });
  test('a decision stands while the hours do not grow; shrinking hours shrink the approval', () => {
    const approved = { overtimeStatus: 'approved', overtimeApprovedMinutes: 120, overtimeDecidedOn: 120 };
    expect(overtimeStateAfter(approved, 120)).toEqual({ overtimeStatus: 'approved', overtimeApprovedMinutes: 120 });
    expect(overtimeStateAfter(approved, 90)).toEqual({ overtimeStatus: 'approved', overtimeApprovedMinutes: 90 });
    expect(overtimeStateAfter({ overtimeStatus: 'rejected', overtimeApprovedMinutes: 0, overtimeDecidedOn: 120 }, 60))
      .toEqual({ overtimeStatus: 'rejected', overtimeApprovedMinutes: 0 });
  });
  test('more hours after a decision → pending again, earlier approval kept', () => {
    const approved = { overtimeStatus: 'approved', overtimeApprovedMinutes: 60, overtimeDecidedOn: 120 };
    expect(overtimeStateAfter(approved, 180)).toEqual({ overtimeStatus: 'pending', overtimeApprovedMinutes: 60 });
  });
  test('hours gone (e.g. corrected to auto-close) → none, nothing approved', () => {
    expect(overtimeStateAfter({ overtimeStatus: 'approved', overtimeApprovedMinutes: 60, overtimeDecidedOn: 60 }, 0))
      .toEqual({ overtimeStatus: 'none', overtimeApprovedMinutes: 0 });
  });
});

describe('who may decide overtime', () => {
  const emp = { _id: 'e1', user: 'u-alice', team: 'sales' };
  const staff = (id, team, x = {}) => ({ _id: id, role: 'staff', staff: { active: true, team, ...x } });
  test('HR, admin and the own team head may; others may not', () => {
    expect(canDecideOvertime(staff('u-hr', 'hr'), emp)).toBe(true);
    expect(canDecideOvertime({ _id: 'u-admin', role: 'admin' }, emp)).toBe(true);
    expect(canDecideOvertime(staff('u-head', 'sales', { isHead: true }), emp)).toBe(true);
    expect(canDecideOvertime(staff('u-ph', 'procurement', { isHead: true }), emp)).toBe(false);
    expect(canDecideOvertime(staff('u-bob', 'sales'), emp)).toBe(false);
    expect(canDecideOvertime(staff('u-head', 'sales', { isHead: true, active: false }), emp)).toBe(false);
  });
  test('nobody but an admin decides their own overtime', () => {
    expect(canDecideOvertime(staff('u-alice', 'hr'), { ...emp, team: 'hr' })).toBe(false);
    expect(canDecideOvertime(staff('u-alice', 'sales', { isHead: true }), emp)).toBe(false);
    expect(canDecideOvertime({ _id: 'u-alice', role: 'admin' }, emp)).toBe(true);
  });
});

describe('marks → LOP', () => {
  test.each([[0, 0], [2, 0], [3, 0.5], [5, 0.5], [6, 1], [7, 1], [9, 1.5]])('%i marks → %d days', (marks, days) => {
    expect(marksLop(marks, 3)).toBe(days);
  });
  test('marksPerHalfDayLop 0 = marks never cost pay', () => {
    expect(marksLop(10, 0)).toBe(0);
  });
});

describe('summariseAttendanceMonth (what payroll reads)', () => {
  const M = '2026-12';
  const d = (date, status, x = {}) => ({ date: `${M}-${date}`, status, ...x });
  const base = { month: M, shiftMinutes: 540, marksPerHalfDayLop: 3 };

  test('a worked example: every bucket and the marks', () => {
    const days = [
      d('01', 'present', { lateMark: true }),
      d('02', 'present', { earlyMark: true }),
      d('03', 'present', { lateMark: true, earlyMark: true }),
      d('04', 'half_day'),
      d('05', 'absent'),
      d('06', 'weekly_off'),
      d('07', 'leave'),
      d('08', 'leave'),
      d('09', 'half_leave', { firstIn: '2026-12-09T08:00:00Z' }),
      d('10', 'half_leave'),
      d('11', 'holiday'),
      d('12', 'present', { overtimeApprovedMinutes: 90, overtimeStatus: 'approved' }),
      d('14', 'present', { overtimeStatus: 'pending', overtimeMinutes: 45, needsReview: true }),
    ];
    const leaveByDate = new Map([[`${M}-08`, { halves: 2, paid: false }], [`${M}-07`, { halves: 2, paid: true }]]);
    const s = summariseAttendanceMonth({ ...base, days, leaveByDate });
    expect(s).toMatchObject({
      month: M,
      daysInMonth: 31,
      shiftMinutes: 540,
      employedDays: 13,
      // present 01,02,03,12,14 = 5; half day ½; weekly off 1; paid leave 07 = 1;
      // 09 = ½ leave + ½ worked; 10 = ½ paid leave; holiday 1  → 10
      payableDays: 10,
      // half day ½; absent 1; unpaid leave 08 = 1; 10's un-worked half ½ → 3
      lopDays: 3,
      lateCount: 2,
      earlyCount: 2,
      marks: 4,
      marksLopDays: 0.5,
      otApprovedMinutes: 90,
      otPendingDays: 1,
      otPendingMinutes: 45,
      absentUnapproved: 1.5,
      unresolvedDays: 1,
    });
    expect(s.payableDays + s.lopDays).toBe(s.employedDays);
    expect(s.breakdown).toEqual({
      presentDays: 5.5, halfDays: 1, absentDays: 1.5, paidLeaveDays: 2, unpaidLeaveDays: 1, holidayDays: 1, weeklyOffDays: 1,
    });
  });

  test.each([[3, 0.5], [6, 1], [7, 1]])('%i late marks in the month → %d LOP days', (n, lop) => {
    const days = Array.from({ length: n }, (_, i) => d(String(i + 1).padStart(2, '0'), 'present', { lateMark: true }));
    expect(summariseAttendanceMonth({ ...base, days }).marksLopDays).toBe(lop);
  });

  test('unapproved overtime pays 0 minutes', () => {
    const s = summariseAttendanceMonth({ ...base, days: [d('01', 'present', { overtimeMinutes: 120, overtimeStatus: 'pending' })] });
    expect(s.otApprovedMinutes).toBe(0);
  });

  test('days outside joinDate..exitDate are in no bucket', () => {
    const days = [d('01', 'absent'), d('02', 'present'), d('03', 'present'), d('04', 'absent')];
    const s = summariseAttendanceMonth({ ...base, days, employment: { joinDate: `${M}-02`, exitDate: `${M}-03` } });
    expect(s).toMatchObject({ employedDays: 2, payableDays: 2, lopDays: 0, absentUnapproved: 0 });
  });

  test('shift length: day and overnight shifts', () => {
    expect(shiftLengthMinutes({ start: '10:00', end: '19:00' })).toBe(540);
    expect(shiftLengthMinutes({ start: '22:00', end: '06:00' })).toBe(480);
  });
});
