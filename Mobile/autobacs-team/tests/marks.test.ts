import type { AttendanceDay, MonthSummary } from '../src/api/types';
import { daysText, markRows, marksVerdict, ruleLines, totalMarks } from '../src/lib/marks';

const base: MonthSummary = { daysInMonth: 30, presentDays: 20, halfDays: 0, absentDays: 0, leaveDays: 0, holidayDays: 0, weeklyOffDays: 4, lateMarks: 2, unresolvedDays: 0 };
const day = (x: Partial<AttendanceDay>): AttendanceDay => ({
  date: '2026-11-01', status: 'present', firstIn: null, lastOut: null, workedMinutes: 540, breakMinutes: 0,
  lateMinutes: 0, isLate: false, overtimeMinutes: 0, autoClosed: false, needsReview: false, ...x,
});

describe('marks wording (server counts, app words)', () => {
  test('uses the server total when sent, else late + early, else old lateMarks', () => {
    expect(totalMarks({ ...base, marks: 5, lateCount: 1, earlyCount: 1 })).toBe(5);
    expect(totalMarks({ ...base, lateCount: 2, earlyCount: 1 })).toBe(3);
    expect(totalMarks(base)).toBe(2);
  });
  test('verdict: no marks, marks without a cut, marks with a cut', () => {
    expect(marksVerdict({ ...base, marks: 0 })).toMatch(/No marks/);
    expect(marksVerdict({ ...base, marks: 2, marksLopDays: 0 })).toBe('2 marks this month. No pay cut yet.');
    expect(marksVerdict({ ...base, marks: 3, marksLopDays: 0.5 })).toBe('3 marks this month. That cuts ½ day of pay.');
    expect(marksVerdict({ ...base, marks: 7, marksLopDays: 1 })).toBe('7 marks this month. That cuts 1 day of pay.');
  });
  test('daysText', () => {
    expect(daysText(0.5)).toBe('½ day');
    expect(daysText(1)).toBe('1 day');
    expect(daysText(1.5)).toBe('1½ days');
    expect(daysText(3)).toBe('3 days');
  });
  test('rules come from the server; without them no numbers are guessed', () => {
    const withRules = ruleLines({ ...base, rules: { graceMinutes: 10, earlyGraceMinutes: 10, marksPerHalfDayLop: 3, overtimeAfterMinutes: 540, overtimeMultiplier: 2, punctualityBonusPaise: 50000 } });
    expect(withRules.join(' ')).toMatch(/more than 10 min after/);
    expect(withRules.join(' ')).toMatch(/Every 3 marks/);
    expect(withRules.join(' ')).toMatch(/after 9 h .*2x/);
    expect(withRules.join(' ')).toMatch(/₹500/);
    expect(ruleLines(base).join(' ')).not.toMatch(/\d+ (min|marks)|\dx|₹/);
  });
  test('marksPerHalfDayLop at the top of the summary (attendance-policy shape) is used', () => {
    expect(ruleLines({ ...base, marksPerHalfDayLop: 3 }).join(' ')).toMatch(/Every 3 marks/);
  });
  test('only late/early/overtime days are listed, newest first', () => {
    const rows = markRows([
      day({ date: '2026-11-02' }),
      day({ date: '2026-11-03', isLate: true, lateMinutes: 22 }),
      day({ date: '2026-11-05', isEarly: true, earlyMinutes: 30, overtimeMinutes: 0 }),
      day({ date: '2026-11-04', overtimeMinutes: 90, overtimeStatus: 'approved', overtimeApprovedMinutes: 60 }),
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2026-11-05', '2026-11-04', '2026-11-03']);
    expect(rows[1]).toMatchObject({ otMinutes: 90, otApproved: 60, otStatus: 'approved' });
    expect(rows[2].late).toBe(22);
  });
});
