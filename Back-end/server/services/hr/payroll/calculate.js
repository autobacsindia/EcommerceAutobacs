/**
 * One employee's payslip for one month — a PURE function (no database), so
 * every rule is unit-tested with worked rupee examples.
 *
 * Inputs are all server-side: the salary row in force, the attendance summary
 * (services/hr/payroll/attendanceSource.js), the rules snapshot (rules.js), the
 * month's adjustments. Nothing a browser sends reaches this function.
 *
 * Line order on the payslip:
 *   1. earnings: salary components at their full monthly amount
 *   2. LOP (deduction): days before joining / after the last day
 *   3. LOP (deduction): absences + unpaid leave            → lopDays × daily rate
 *   4. Marks LOP (deduction): late/early marks              → marksLopDays × daily rate
 *   5. Overtime (earning): approved minutes ÷ 60 × hourly × multiplier
 *        hourly = monthly gross ÷ day divisor ÷ (shift minutes ÷ 60)
 *   6. Punctuality bonus (earning): full 0–2 marks, half 3–4, none 5+ or any
 *      unapproved absence
 *   7. Adjustments (earning / deduction), HR's one-off lines
 *   8. PF, ESI, PT, TDS (deduction); employer PF/ESI (employer, not deducted)
 *
 * daily rate = monthly pro-rated earnings ÷ day divisor, where the divisor is the
 * calendar days of the month, or 30 when HrSettings.monthDayBasis is 'fixed_30'.
 * Rounding: services/hr/payroll/money.js (one fraction per line, rounded once,
 * halves up).
 */
import { ratio, applyRate, toPpm, toHalfDays, fromHalfDays, rupees, dayText } from './money.js';

export const EARNING_ADJUSTMENTS = Object.freeze(['bonus', 'arrears', 'other_earning', 'leave_encashment']);
export const ADJUSTMENT_LABELS = Object.freeze({
  bonus: 'Bonus',
  arrears: 'Arrears',
  other_earning: 'Other earning',
  leave_encashment: 'Leave encashment',
  advance_recovery: 'Advance recovery',
  other_deduction: 'Other deduction',
});

/** Blocking warnings: the run cannot lock while a payslip carries one. */
export const BLOCKING_WARNINGS = Object.freeze(['deductions_exceed_earnings']);

/** Calendar days of 'YYYY-MM'. */
export const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Days of `month` before `joinDate` or after `exitDate` ('YYYY-MM-DD' strings). */
export function notEmployedDays(month, { joinDate, exitDate } = {}) {
  const total = daysInMonth(month);
  let first = 1;
  let last = total;
  if (joinDate && joinDate.slice(0, 7) === month) first = Number(joinDate.slice(8, 10));
  else if (joinDate && joinDate.slice(0, 7) > month) return total;
  if (exitDate && exitDate.slice(0, 7) === month) last = Number(exitDate.slice(8, 10));
  else if (exitDate && exitDate.slice(0, 7) < month) return total;
  return Math.max(0, total - Math.max(0, last - first + 1));
}

const line = (code, label, kind, amountPaise, calc, basis = {}) => ({
  code, label, kind, amountPaise, calc: String(calc).slice(0, 300), basis,
});

const intOf = (v) => Math.max(0, Math.round(Number(v) || 0));

/**
 * @param {object} p
 * @param {string} p.month 'YYYY-MM'
 * @param {object} p.structure SalaryStructure (lean)
 * @param {object} p.summary   monthAttendanceSummary(...)
 * @param {object} p.employee  { joinDate, exitDate }
 * @param {object} p.rules     payrollRules(settings)
 * @param {Array}  p.adjustments live PayrollAdjustment rows of this month
 */
export function computePayslip({ month, structure, summary, employee = {}, rules, adjustments = [] }) {
  const lines = [];
  const warnings = [];
  const calendarDays = daysInMonth(month);
  const D = rules.monthDayBasis === 'fixed_30' ? 30 : calendarDays;
  const D2 = D * 2; // in half-days

  // ── 1. Earnings at the full monthly amount ────────────────────────────────
  const comps = (structure.components || []).map((c) => ({ ...c, monthlyPaise: intOf(c.monthlyPaise) }));
  const earnings = comps.filter((c) => c.kind === 'earning');
  const fullGross = earnings.reduce((s, c) => s + c.monthlyPaise, 0);
  const proratable = earnings.filter((c) => c.prorate !== false).reduce((s, c) => s + c.monthlyPaise, 0);
  for (const c of earnings) {
    lines.push(line(c.code, c.label, 'earning', c.monthlyPaise,
      `Monthly ${rupees(c.monthlyPaise)}${c.prorate === false ? ' (fixed, not cut for LOP)' : ''}`,
      { monthlyPaise: c.monthlyPaise, prorate: c.prorate !== false }));
  }
  const perDayText = `${rupees(proratable)} ÷ ${D} days`;
  const perDayPaise = ratio([proratable], [D]); // display only

  // ── 2–4. LOP, in half-days, never more than the whole month ─────────────
  let remaining = D2;
  const take = (h) => { const t = Math.min(h, remaining); remaining -= t; return t; };

  const notEmployed = notEmployedDays(month, employee);
  const notEmployedHalf = take(Math.min(notEmployed * 2, D2));
  if (notEmployedHalf > 0) {
    const amt = ratio([proratable, notEmployedHalf], [D2]);
    lines.push(line('not_employed', 'Not employed (before joining / after last day)', 'deduction', amt,
      `${dayText(fromHalfDays(notEmployedHalf))} days × (${perDayText})`,
      { days: fromHalfDays(notEmployedHalf), joinDate: employee.joinDate || null, exitDate: employee.exitDate || null, perDayPaise, dayDivisor: D }));
  }

  const lopHalf = take(toHalfDays(summary.lopDays, 'lopDays'));
  if (lopHalf > 0) {
    const amt = ratio([proratable, lopHalf], [D2]);
    lines.push(line('lop', 'Loss of pay (absences + unpaid leave)', 'deduction', amt,
      `${dayText(fromHalfDays(lopHalf))} days × (${perDayText})`,
      { lopDays: fromHalfDays(lopHalf), absentUnapproved: intOf(summary.absentUnapproved), perDayPaise, dayDivisor: D }));
  }

  const marks = intOf(summary.marks);
  const marksHalf = take(toHalfDays(summary.marksLopDays, 'marksLopDays'));
  if (marksHalf > 0) {
    const amt = ratio([proratable, marksHalf], [D2]);
    lines.push(line('marks_lop', 'Late / early marks', 'deduction', amt,
      `Late/early marks: ${marks} → ${dayText(fromHalfDays(marksHalf))} day LOP ${rupees(amt)}`,
      {
        marks, lateCount: intOf(summary.lateCount), earlyCount: intOf(summary.earlyCount),
        marksPerHalfDayLop: rules.marksPerHalfDayLop, marksLopDays: fromHalfDays(marksHalf), perDayPaise, dayDivisor: D,
      }));
  }
  const lopTotalHalf = D2 - remaining;
  const lopPaise = lines.filter((l) => ['not_employed', 'lop', 'marks_lop'].includes(l.code)).reduce((s, l) => s + l.amountPaise, 0);
  const earnedGross = Math.max(0, fullGross - lopPaise);

  // ── 5. Overtime ──────────────────────────────────────────────────────────
  const otMinutes = intOf(summary.otApprovedMinutes);
  const shiftMinutes = intOf(summary.shiftMinutes) || 540;
  let otPaise = 0;
  if (otMinutes > 0) {
    const mult = structure.overtimeMultiplier ?? rules.overtimeMultiplier;
    const multPpm = toPpm(mult);
    const hourlyPaise = ratio([fullGross, 60], [D, shiftMinutes]); // display only
    if (structure.overtimeEligible === false) {
      lines.push(line('overtime', 'Overtime', 'earning', 0,
        `${otMinutes} approved min — not eligible for overtime pay`, { otApprovedMinutes: otMinutes, eligible: false }));
    } else {
      // gross × minutes × mult ÷ (D × shiftMinutes): hourly × hours × multiplier in one fraction.
      otPaise = ratio([fullGross, otMinutes, multPpm], [D, shiftMinutes, 1000000]);
      lines.push(line('overtime', 'Overtime', 'earning', otPaise,
        `${otMinutes} min ÷ 60 × ${rupees(hourlyPaise)}/h × ${mult} (hourly = ${rupees(fullGross)} ÷ ${D} days ÷ ${shiftMinutes / 60} h)`,
        { otApprovedMinutes: otMinutes, multiplier: mult, hourlyPaise, shiftMinutes, dayDivisor: D, monthlyGrossPaise: fullGross, eligible: true }));
    }
  }

  // ── 6. Punctuality bonus ─────────────────────────────────────────────────
  if (structure.punctualityBonusEligible !== false && rules.punctualityBonusPaise > 0) {
    const absent = intOf(summary.absentUnapproved);
    const full = rules.punctualityBonusPaise;
    let amt;
    let why;
    let share;
    if (absent > 0) { amt = 0; share = 'none'; why = `none: ${absent} unapproved absence${absent > 1 ? 's' : ''}`; }
    else if (marks <= rules.punctualityBonusFullMaxMarks) { amt = full; share = 'full'; why = `full: ${marks} marks (0–${rules.punctualityBonusFullMaxMarks})`; }
    else if (marks <= rules.punctualityBonusHalfMaxMarks) { amt = ratio([full], [2]); share = 'half'; why = `half: ${marks} marks (${rules.punctualityBonusFullMaxMarks + 1}–${rules.punctualityBonusHalfMaxMarks})`; }
    else { amt = 0; share = 'none'; why = `none: ${marks} marks (${rules.punctualityBonusHalfMaxMarks + 1}+)`; }
    lines.push(line('punctuality_bonus', 'Punctuality bonus', 'earning', amt, `${rupees(full)} — ${why}`,
      { marks, absentUnapproved: absent, share, fullPaise: full }));
  }

  // ── 7. Adjustments ───────────────────────────────────────────────────────
  for (const a of adjustments) {
    if (a.cancelledAt) continue;
    const earning = EARNING_ADJUSTMENTS.includes(a.kind);
    lines.push(line(`adj_${a.kind}`, ADJUSTMENT_LABELS[a.kind] || a.kind, earning ? 'earning' : 'deduction',
      intOf(a.amountPaise), a.reason || '', { adjustmentId: String(a._id), kind: a.kind, system: !!a.system }));
  }

  // ── 8. Statutory + structure deductions ─────────────────────────────────
  const basic = earnings.find((c) => c.code === 'basic');
  if (structure.pfApplicable !== false) {
    if (!basic) warnings.push('no_basic_for_pf');
    const earnedBasic = !basic ? 0
      : basic.prorate === false ? basic.monthlyPaise : ratio([basic.monthlyPaise, D2 - lopTotalHalf], [D2]);
    const capped = structure.pfCapAtCeiling !== false && earnedBasic > rules.pfWageCeilingPaise;
    const pfWage = capped ? rules.pfWageCeilingPaise : earnedBasic;
    const emp = applyRate(pfWage, rules.pfEmployeeRate);
    const er = applyRate(pfWage, rules.pfEmployerRate);
    const basis = { pfWagePaise: pfWage, earnedBasicPaise: earnedBasic, capped, ceilingPaise: rules.pfWageCeilingPaise };
    if (emp > 0) lines.push(line('pf', 'Provident fund (PF)', 'deduction', emp, `${rules.pfEmployeeRate * 100}% of ${rupees(pfWage)}${capped ? ' (wage ceiling)' : ''}`, { ...basis, rate: rules.pfEmployeeRate }));
    if (er > 0) lines.push(line('pf_employer', 'Employer PF', 'employer', er, `${rules.pfEmployerRate * 100}% of ${rupees(pfWage)}`, { ...basis, rate: rules.pfEmployerRate }));
  }

  // ESI: eligibility on the monthly gross in the salary row; contribution on the
  // wages actually earned this month (after LOP, with overtime).
  if (structure.esiApplicable !== false && fullGross <= rules.esiGrossThresholdPaise) {
    const esiWage = earnedGross + otPaise;
    const emp = applyRate(esiWage, rules.esiEmployeeRate);
    const er = applyRate(esiWage, rules.esiEmployerRate);
    const basis = { esiWagePaise: esiWage, thresholdPaise: rules.esiGrossThresholdPaise };
    if (emp > 0) lines.push(line('esi', 'ESI', 'deduction', emp, `${rules.esiEmployeeRate * 100}% of ${rupees(esiWage)}`, { ...basis, rate: rules.esiEmployeeRate }));
    if (er > 0) lines.push(line('esi_employer', 'Employer ESI', 'employer', er, `${rules.esiEmployerRate * 100}% of ${rupees(esiWage)}`, { ...basis, rate: rules.esiEmployerRate }));
  }

  // PT: the slab of the state for this month's total earnings minus LOP.
  const totalEarnings = lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amountPaise, 0);
  const ptBase = Math.max(0, totalEarnings - lopPaise);
  const slabs = structure.ptState ? rules.ptSlabs[structure.ptState] || [] : [];
  const slab = [...slabs].reverse().find((s) => ptBase >= s.fromPaise);
  if (slab && slab.ptPaise > 0) {
    lines.push(line('pt', 'Professional tax', 'deduction', slab.ptPaise, `${structure.ptState}: earnings ${rupees(ptBase)} ≥ ${rupees(slab.fromPaise)}`,
      { state: structure.ptState, basePaise: ptBase, slabFromPaise: slab.fromPaise }));
  }

  const tds = intOf(structure.tdsMonthlyPaise);
  if (tds > 0) lines.push(line('tds', 'Income tax (TDS)', 'deduction', tds, 'Monthly estimate from your declaration', { monthlyPaise: tds }));

  for (const c of comps.filter((x) => x.kind === 'deduction' && x.monthlyPaise > 0)) {
    lines.push(line(c.code, c.label, 'deduction', c.monthlyPaise, `Monthly ${rupees(c.monthlyPaise)}`, { monthlyPaise: c.monthlyPaise }));
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const grossPaise = totalEarnings;
  const deductionsPaise = lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amountPaise, 0);
  const employerPaise = lines.filter((l) => l.kind === 'employer').reduce((s, l) => s + l.amountPaise, 0);
  let netPaise = grossPaise - deductionsPaise;
  if (netPaise < 0) {
    warnings.push('deductions_exceed_earnings');
    netPaise = 0;
  }

  const lopDays = fromHalfDays(lopHalf);
  const marksLopDays = fromHalfDays(marksHalf);
  return {
    lines,
    grossPaise,
    deductionsPaise,
    netPaise,
    employerPaise,
    warnings,
    attendance: {
      daysInMonth: calendarDays,
      dayDivisor: D,
      paidDays: fromHalfDays(D2 - lopTotalHalf),
      lopDays,
      presentDays: Number(summary.presentDays ?? summary.payableDays ?? 0),
      leaveDays: Number(summary.leaveDays || 0),
      lateMarks: intOf(summary.lateCount),
      overtimeMinutes: otMinutes,
      marks,
      lateCount: intOf(summary.lateCount),
      earlyCount: intOf(summary.earlyCount),
      marksLopDays,
      absentUnapproved: intOf(summary.absentUnapproved),
      notEmployedDays: fromHalfDays(notEmployedHalf),
      shiftMinutes,
    },
  };
}
