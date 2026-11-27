/**
 * Payroll maths — worked rupee examples for every rule (owner decisions 2026-11-26).
 * Pure functions: no database, no HTTP.
 *
 * The house example: ₹30,000 a month (basic ₹15,000 + HRA ₹6,000 + special ₹9,000),
 * November 2026 = 30 days, so one day = ₹1,000 and a 9 h shift hour = ₹111.11.
 */
import { computePayslip, notEmployedDays } from '../services/hr/payroll/calculate.js';
import { payrollRules } from '../services/hr/payroll/rules.js';
import { ratio, applyRate, toHalfDays } from '../services/hr/payroll/money.js';
import { finalSettlement } from '../services/hr/exit/settlement.js';
import { cleanStructureInput } from '../services/hr/payroll/salaryService.js';

const R = (rupees) => Math.round(rupees * 100); // paise
const rules = (x = {}) => payrollRules({ pfEmployeeRate: 0.12, pfEmployerRate: 0.12, ...x });
const comp = (code, rupees, prorate = true) => ({ code, label: code.toUpperCase(), kind: 'earning', monthlyPaise: R(rupees), prorate });
const house = (x = {}) => ({
  components: [comp('basic', 15000), comp('hra', 6000), comp('special', 9000)],
  pfApplicable: true, pfCapAtCeiling: true, esiApplicable: true, ptState: '',
  overtimeEligible: true, overtimeMultiplier: null, punctualityBonusEligible: true, tdsMonthlyPaise: 0, ...x,
});
const summary = (x = {}) => ({
  daysInMonth: 30, lopDays: 0, marks: 0, marksLopDays: 0, lateCount: 0, earlyCount: 0,
  otApprovedMinutes: 0, absentUnapproved: 0, shiftMinutes: 540, ...x,
});
const run = (x = {}) => computePayslip({
  month: '2026-11', structure: house(x.structure), summary: summary(x.summary), employee: x.employee || {}, rules: x.rules || rules(), adjustments: x.adjustments || [],
});
const lineOf = (r, code) => r.lines.find((l) => l.code === code);
const amt = (r, code) => lineOf(r, code)?.amountPaise;

describe('money: one rounding rule (single fraction, rounded once, halves up)', () => {
  test('halves round up, everything else to nearest', () => {
    expect(ratio([1], [2])).toBe(1);
    expect(ratio([5], [2])).toBe(3);
    expect(ratio([4], [3])).toBe(1);
    expect(ratio([5], [3])).toBe(2);
    expect(applyRate(R(15000), 0.12)).toBe(R(1800));
    expect(applyRate(1813333, 0.0075)).toBe(13600); // 13599.9975 → 13600
  });
  test('days must be whole or half', () => {
    expect(toHalfDays(2.5)).toBe(5);
    expect(() => toHalfDays(0.3)).toThrow(/half/);
    expect(() => toHalfDays(-1)).toThrow();
  });
  test('huge figures stay exact (BigInt), never floats', () => {
    expect(ratio([99999999, 99999, 3000000], [31, 540, 1000000])).toBe(Math.round((99999999 * 99999 * 3) / (31 * 540)));
  });
});

describe('the full worked example (₹30,000, Nov 2026)', () => {
  // 2 days absent, 4 marks (→ ½ day), 120 min approved OT, so no bonus.
  const r = run({ summary: { lopDays: 2, absentUnapproved: 2, marks: 4, lateCount: 3, earlyCount: 1, marksLopDays: 0.5, otApprovedMinutes: 120 } });

  test('earnings are the full monthly components', () => {
    expect(amt(r, 'basic')).toBe(R(15000));
    expect(amt(r, 'hra')).toBe(R(6000));
    expect(amt(r, 'special')).toBe(R(9000));
  });
  test('LOP: 2 days × ₹1,000 = ₹2,000', () => {
    expect(amt(r, 'lop')).toBe(R(2000));
    expect(lineOf(r, 'lop').basis).toMatchObject({ lopDays: 2, absentUnapproved: 2, perDayPaise: R(1000), dayDivisor: 30 });
  });
  test('marks LOP: 4 marks → ½ day = ₹500, and says so', () => {
    expect(amt(r, 'marks_lop')).toBe(R(500));
    expect(lineOf(r, 'marks_lop').calc).toBe('Late/early marks: 4 → ½ day LOP ₹500');
    expect(lineOf(r, 'marks_lop').basis).toMatchObject({ marks: 4, lateCount: 3, earlyCount: 1, marksLopDays: 0.5 });
  });
  test('OT: 120 min ÷ 60 × (₹30,000 ÷ 30 ÷ 9 h) × 2 = ₹444.44', () => {
    expect(amt(r, 'overtime')).toBe(44444);
    expect(lineOf(r, 'overtime').basis).toMatchObject({ otApprovedMinutes: 120, multiplier: 2, hourlyPaise: 11111, shiftMinutes: 540 });
  });
  test('bonus: none, because of unapproved absences', () => {
    expect(amt(r, 'punctuality_bonus')).toBe(0);
    expect(lineOf(r, 'punctuality_bonus').calc).toMatch(/none: 2 unapproved absences/);
  });
  test('PF: 12% of basic earned (₹15,000 × 27.5/30 = ₹13,750) = ₹1,650; employer the same, not deducted', () => {
    expect(lineOf(r, 'pf').basis.pfWagePaise).toBe(R(13750));
    expect(amt(r, 'pf')).toBe(R(1650));
    expect(lineOf(r, 'pf_employer')).toMatchObject({ kind: 'employer', amountPaise: R(1650) });
  });
  test('ESI: none above the ₹21,000 gross threshold', () => {
    expect(lineOf(r, 'esi')).toBeUndefined();
  });
  test('totals: gross ₹30,444.44 − deductions ₹4,150 = net ₹26,294.44', () => {
    expect(r.grossPaise).toBe(R(30000) + 44444);
    expect(r.deductionsPaise).toBe(R(2000) + R(500) + R(1650));
    expect(r.netPaise).toBe(2629444);
    expect(r.employerPaise).toBe(R(1650));
    expect(r.attendance).toMatchObject({ paidDays: 27.5, lopDays: 2, marksLopDays: 0.5, marks: 4, overtimeMinutes: 120 });
  });
});

describe('punctuality bonus (₹500)', () => {
  test.each([
    [0, 0, R(500)], [2, 0, R(500)], [3, 0, R(250)], [4, 0, R(250)], [5, 0, 0], [9, 0, 0], [0, 1, 0],
  ])('%i marks, %i unapproved absences → %i paise', (marks, absent, paise) => {
    expect(amt(run({ summary: { marks, absentUnapproved: absent } }), 'punctuality_bonus')).toBe(paise);
  });
  test('not eligible → no line at all', () => {
    expect(lineOf(run({ structure: { punctualityBonusEligible: false } }), 'punctuality_bonus')).toBeUndefined();
  });
  test('HR settings (HrSettings names, PR #658) move the mark limits: full ≤ 0, half ≤ 1', () => {
    const tight = rules({ punctualityFullMaxMarks: 0, punctualityHalfMaxMarks: 1 });
    expect(amt(run({ rules: tight, summary: { marks: 0 } }), 'punctuality_bonus')).toBe(R(500));
    expect(amt(run({ rules: tight, summary: { marks: 1 } }), 'punctuality_bonus')).toBe(R(250));
    expect(amt(run({ rules: tight, summary: { marks: 2 } }), 'punctuality_bonus')).toBe(0);
  });
  test('half an unapproved absence still loses the bonus', () => {
    const r = run({ summary: { absentUnapproved: 0.5 } });
    expect(amt(r, 'punctuality_bonus')).toBe(0);
    expect(lineOf(r, 'punctuality_bonus').calc).toMatch(/none: ½ unapproved absence/);
  });
  test('HR setting changes the amount; half of an odd amount rounds up', () => {
    expect(amt(run({ rules: rules({ punctualityBonusPaise: 50001 }), summary: { marks: 3 } }), 'punctuality_bonus')).toBe(25001);
  });
});

describe('overtime', () => {
  test('not eligible: shown at ₹0 with the minutes', () => {
    const r = run({ structure: { overtimeEligible: false }, summary: { otApprovedMinutes: 90 } });
    expect(lineOf(r, 'overtime')).toMatchObject({ amountPaise: 0 });
    expect(lineOf(r, 'overtime').calc).toMatch(/not eligible/);
  });
  test('a per-employee 1.5× overrides the company 2×: 60 min = ₹166.67', () => {
    expect(amt(run({ structure: { overtimeMultiplier: 1.5 }, summary: { otApprovedMinutes: 60 } }), 'overtime')).toBe(16667);
  });
  test('company rate from HrSettings (2.5×): 60 min = ₹277.78', () => {
    expect(amt(run({ rules: rules({ overtimeMultiplier: 2.5 }), summary: { otApprovedMinutes: 60 } }), 'overtime')).toBe(27778);
  });
  test('an 8 h shift makes the hour dearer: 60 min × ₹125 × 2 = ₹250', () => {
    expect(amt(run({ summary: { otApprovedMinutes: 60, shiftMinutes: 480 } }), 'overtime')).toBe(R(250));
  });
  test('no approved minutes → no line', () => {
    expect(lineOf(run(), 'overtime')).toBeUndefined();
  });
});

describe('LOP edge cases', () => {
  test('half days: 2½ days = ₹2,500', () => {
    expect(amt(run({ summary: { lopDays: 2.5 } }), 'lop')).toBe(R(2500));
  });
  test('31-day month (Dec): 1 day = ₹30,000 ÷ 31 = ₹967.74', () => {
    const r = computePayslip({ month: '2026-12', structure: house(), summary: summary({ lopDays: 1 }), rules: rules() });
    expect(amt(r, 'lop')).toBe(96774);
  });
  test('fixed-30 basis: 1 day in December = ₹1,000', () => {
    const r = computePayslip({ month: '2026-12', structure: house(), summary: summary({ lopDays: 1 }), rules: rules({ monthDayBasis: 'fixed_30' }) });
    expect(amt(r, 'lop')).toBe(R(1000));
    expect(r.attendance.dayDivisor).toBe(30);
  });
  test('a fixed allowance is not cut for LOP', () => {
    const structure = house({ components: [comp('basic', 15000), comp('hra', 6000), comp('special', 9000), comp('phone', 1600, false)] });
    const r = computePayslip({ month: '2026-11', structure, summary: summary({ lopDays: 3 }), rules: rules() });
    expect(amt(r, 'lop')).toBe(R(3000)); // ₹30,000 ÷ 30 × 3; phone untouched
    expect(r.grossPaise).toBe(R(31600) + R(500)); // + punctuality bonus
  });
  test('LOP never exceeds the month: 40 days asked → 30 charged, PF on ₹0', () => {
    const r = run({ summary: { lopDays: 40, marksLopDays: 2 } });
    expect(amt(r, 'lop')).toBe(R(30000));
    expect(lineOf(r, 'marks_lop')).toBeUndefined();
    expect(lineOf(r, 'pf')).toBeUndefined();
    expect(r.attendance.paidDays).toBe(0);
  });
  test('joined on the 11th: 10 days not employed = ₹10,000', () => {
    expect(notEmployedDays('2026-11', { joinDate: '2026-11-11' })).toBe(10);
    expect(notEmployedDays('2026-11', { exitDate: '2026-11-20' })).toBe(10);
    expect(notEmployedDays('2026-11', { joinDate: '2026-12-01' })).toBe(30);
    expect(notEmployedDays('2026-11', { joinDate: '2025-01-01' })).toBe(0);
    const r = run({ employee: { joinDate: '2026-11-11' } });
    expect(amt(r, 'not_employed')).toBe(R(10000));
  });
});

describe('statutory', () => {
  test('ESI + PF + PT on ₹18,000 with 60 min OT and full bonus (worked)', () => {
    const structure = house({ components: [comp('basic', 10000), comp('hra', 8000)], ptState: 'kerala' });
    const r = computePayslip({
      month: '2026-11', structure, summary: summary({ otApprovedMinutes: 60 }),
      rules: rules({ ptSlabs: { kerala: [{ fromPaise: R(12000), ptPaise: R(200) }, { fromPaise: 0, ptPaise: 0 }] } }),
    });
    expect(amt(r, 'overtime')).toBe(13333); // 18,000 ÷ 30 ÷ 9 × 2 = ₹133.33
    expect(amt(r, 'punctuality_bonus')).toBe(R(500));
    expect(amt(r, 'pf')).toBe(R(1200)); // 12% × ₹10,000
    expect(lineOf(r, 'esi').basis.esiWagePaise).toBe(1813333); // earned ₹18,000 + OT
    expect(amt(r, 'esi')).toBe(13600); // 0.75% → ₹136.00
    expect(amt(r, 'esi_employer')).toBe(58933); // 3.25% → ₹589.33
    expect(amt(r, 'pt')).toBe(R(200));
    expect(r.grossPaise).toBe(1863333);
    expect(r.deductionsPaise).toBe(R(1200) + 13600 + R(200));
    expect(r.netPaise).toBe(1863333 - 153600);
  });
  test('PF wage ceiling ₹15,000: basic ₹25,000 → ₹1,800; uncapped → ₹3,000', () => {
    const big = { components: [comp('basic', 25000), comp('hra', 10000)] };
    expect(amt(run({ structure: big }), 'pf')).toBe(R(1800));
    expect(amt(run({ structure: { ...big, pfCapAtCeiling: false } }), 'pf')).toBe(R(3000));
  });
  test('PF / ESI off when the salary row says so', () => {
    const r = run({ structure: { pfApplicable: false, esiApplicable: false } });
    expect(lineOf(r, 'pf')).toBeUndefined();
    expect(lineOf(r, 'esi')).toBeUndefined();
  });
  test('TDS and structure deductions are deducted as typed', () => {
    const r = run({ structure: { tdsMonthlyPaise: R(1000), components: [...house().components, { code: 'canteen', label: 'Canteen', kind: 'deduction', monthlyPaise: R(300) }] } });
    expect(amt(r, 'tds')).toBe(R(1000));
    expect(amt(r, 'canteen')).toBe(R(300));
  });
});

describe('adjustments', () => {
  test('earnings add, deductions subtract, cancelled ones vanish', () => {
    const r = run({
      adjustments: [
        { _id: 'a1', kind: 'bonus', amountPaise: R(2000), reason: 'Diwali' },
        { _id: 'a2', kind: 'advance_recovery', amountPaise: R(1500), reason: 'Advance Oct' },
        { _id: 'a3', kind: 'bonus', amountPaise: R(9999), reason: 'typo', cancelledAt: new Date() },
      ],
    });
    expect(amt(r, 'adj_bonus')).toBe(R(2000));
    expect(amt(r, 'adj_advance_recovery')).toBe(R(1500));
    expect(r.lines.filter((l) => l.code === 'adj_bonus')).toHaveLength(1);
    expect(r.grossPaise).toBe(R(30000) + R(500) + R(2000));
  });
  test('deductions above earnings: net ₹0 and a blocking warning', () => {
    const r = run({ adjustments: [{ _id: 'x', kind: 'advance_recovery', amountPaise: R(50000), reason: 'too much' }] });
    expect(r.netPaise).toBe(0);
    expect(r.warnings).toContain('deductions_exceed_earnings');
  });
});

describe('every line explains itself', () => {
  test('each line has a calc text and a basis', () => {
    const r = run({ summary: { lopDays: 1, marks: 3, marksLopDays: 0.5, otApprovedMinutes: 30 } });
    for (const l of r.lines) {
      expect(l.calc.length).toBeGreaterThan(0);
      expect(typeof l.basis).toBe('object');
      expect(Number.isSafeInteger(l.amountPaise)).toBe(true);
    }
    expect(r.grossPaise - r.deductionsPaise).toBe(r.netPaise);
  });
});

describe('salary input', () => {
  test('client-sent totals are not read; amounts must be whole paise', () => {
    const c = cleanStructureInput({ effectiveFrom: '2026-11', reason: 'Joining', grossPaise: 1, netPaise: 999, components: [{ code: 'basic', label: 'Basic', monthlyPaise: R(15000) }] });
    expect(c).not.toHaveProperty('grossPaise');
    expect(c).not.toHaveProperty('netPaise');
    expect(() => cleanStructureInput({ effectiveFrom: '2026-11', reason: 'x y z', components: [{ code: 'basic', label: 'Basic', monthlyPaise: 10.5 }] })).toThrow(/whole paise/);
    expect(() => cleanStructureInput({ effectiveFrom: '2026-11', reason: 'x y z', components: [{ code: 'basic', label: 'B', monthlyPaise: 0 }] })).toThrow(/earning above/);
    expect(() => cleanStructureInput({ effectiveFrom: '11-2026', reason: 'x y z', components: [] })).toThrow(/month/);
  });
});

describe('final settlement (minimal F&F)', () => {
  test('last day 20 Nov, 3 days encashed, 10 days notice short (worked)', () => {
    const r = finalSettlement({
      structure: house({ pfApplicable: false, esiApplicable: false, punctualityBonusEligible: false }),
      summary: summary(), employee: { joinDate: '2024-01-01' }, lastDay: '2026-11-20', rules: rules(),
      leaveEncashDays: 3, noticeShortfallDays: 10,
    });
    expect(amt(r, 'not_employed')).toBe(R(10000)); // 21–30 Nov
    expect(amt(r, 'leave_encashment')).toBe(R(1500)); // 3 × ₹15,000 ÷ 30
    expect(amt(r, 'notice_recovery')).toBe(R(10000)); // 10 × ₹30,000 ÷ 30
    expect(r.grossPaise).toBe(R(31500));
    expect(r.deductionsPaise).toBe(R(20000));
    expect(r.netPaise).toBe(R(11500));
    expect(r.kind).toBe('final_settlement');
  });
  test('owing more than earned: net ₹0, the shortfall is shown as recoverable', () => {
    const r = finalSettlement({
      structure: house({ pfApplicable: false, esiApplicable: false, punctualityBonusEligible: false }),
      summary: summary(), employee: {}, lastDay: '2026-11-05', rules: rules(), noticeShortfallDays: 30,
    });
    expect(r.netPaise).toBe(0);
    expect(r.recoverablePaise).toBe(R(25000)); // owes ₹55,000 − earned ₹30,000
    expect(r.warnings).toContain('employee_owes_company');
  });
});
