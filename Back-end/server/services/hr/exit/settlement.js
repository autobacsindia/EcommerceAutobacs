/**
 * Final settlement (F&F) — a MINIMAL, pure calculation from an accepted exit.
 * Not wired to a route or persisted yet (see the PR: exit flow not covered).
 *
 *   salary to the last day   = the normal monthly payslip with exitDate = lastDay
 *                              (days after the last day are "not employed")
 *   + leave encashment       = encashable days × basic ÷ day divisor
 *   − notice shortfall       = days short × monthly gross ÷ day divisor
 *                              (only when HR decides to recover it)
 *
 * Same rounding rule as payroll (services/hr/payroll/money.js): each line one
 * fraction, rounded once, halves up. Gratuity, bonus-act and TDS true-up are
 * NOT handled here.
 */
import { computePayslip, daysInMonth } from '../payroll/calculate.js';
import { ratio, toHalfDays, fromHalfDays, rupees, dayText } from '../payroll/money.js';

export function finalSettlement({
  structure, summary, employee, lastDay, rules, adjustments = [], leaveEncashDays = 0, noticeShortfallDays = 0,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(lastDay || ''))) throw new Error('lastDay must be YYYY-MM-DD');
  const month = lastDay.slice(0, 7);
  const base = computePayslip({ month, structure, summary, employee: { ...employee, exitDate: lastDay }, rules, adjustments });
  const D = rules.monthDayBasis === 'fixed_30' ? 30 : daysInMonth(month);
  const earnings = (structure.components || []).filter((c) => c.kind === 'earning');
  const gross = earnings.reduce((s, c) => s + c.monthlyPaise, 0);
  const basic = earnings.find((c) => c.code === 'basic')?.monthlyPaise || 0;
  const lines = [...base.lines];

  const encHalf = toHalfDays(leaveEncashDays, 'leaveEncashDays');
  if (encHalf > 0) {
    const amt = ratio([basic, encHalf], [D * 2]);
    lines.push({ code: 'leave_encashment', label: 'Leave encashment', kind: 'earning', amountPaise: amt,
      calc: `${dayText(fromHalfDays(encHalf))} days × (${rupees(basic)} basic ÷ ${D} days)`, basis: { days: fromHalfDays(encHalf), basicPaise: basic, dayDivisor: D } });
  }
  const shortHalf = toHalfDays(noticeShortfallDays, 'noticeShortfallDays');
  if (shortHalf > 0) {
    const amt = ratio([gross, shortHalf], [D * 2]);
    lines.push({ code: 'notice_recovery', label: 'Notice period shortfall', kind: 'deduction', amountPaise: amt,
      calc: `${dayText(fromHalfDays(shortHalf))} days × (${rupees(gross)} ÷ ${D} days)`, basis: { days: fromHalfDays(shortHalf), grossPaise: gross, dayDivisor: D } });
  }
  const grossPaise = lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amountPaise, 0);
  const deductionsPaise = lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amountPaise, 0);
  const warnings = base.warnings.filter((w) => w !== 'deductions_exceed_earnings');
  let netPaise = grossPaise - deductionsPaise;
  // Negative = the employee owes the company: shown, never paid out as a negative.
  const recoverablePaise = netPaise < 0 ? -netPaise : 0;
  if (netPaise < 0) { warnings.push('employee_owes_company'); netPaise = 0; }
  return { ...base, kind: 'final_settlement', month, lines, grossPaise, deductionsPaise, netPaise, recoverablePaise, warnings };
}
