/**
 * Salary structures (models/hr/SalaryStructure.js): effective-dated. A raise is a
 * NEW row from a month; old rows are never edited, so any past month recomputes
 * exactly. HR/admin add rows; the employee reads only their own (route scope
 * 'salary': self + HR + admin, never a team head).
 *
 * Amounts are integer paise typed by HR. Statutory figures (PF/ESI/PT) are never
 * typed — payroll computes them. Fields the browser might send that the server
 * computes (gross, net, totals) are simply not read.
 *
 * Not field-encrypted: the ADR encrypts PAN, bank and face templates only. Salary
 * rows are protected by the 'salary' access scope and never listed to heads.
 */
import AppError from '../../../utils/AppError.js';
import salaryRepository from '../../../repositories/hr/salaryRepository.js';
import { MONTH_RE, SALARY_COMPONENT_KINDS } from '../../../config/hr.js';
import { recordHrAudit } from '../audit.js';
import { withTx, isDuplicateKey } from './tx.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const MAX_COMPONENTS = 20;
const MAX_MONTHLY_PAISE = 100000000; // ₹10 lakh a month per component: a typo guard
const CODE_RE = /^[a-z][a-z0-9_]{0,29}$/;

function cleanComponents(raw) {
  if (!Array.isArray(raw) || !raw.length) throw fail('Add at least one salary component (for example Basic).', 400);
  if (raw.length > MAX_COMPONENTS) throw fail(`At most ${MAX_COMPONENTS} components.`, 400);
  const seen = new Set();
  const out = raw.map((c, i) => {
    const code = String(c?.code || '').trim().toLowerCase();
    if (!CODE_RE.test(code)) throw fail(`Component ${i + 1}: code must be short lowercase letters (basic, hra, special…).`, 400);
    if (seen.has(code)) throw fail(`Component "${code}" is listed twice.`, 400);
    seen.add(code);
    const label = String(c?.label || '').trim().slice(0, 60);
    if (!label) throw fail(`Component "${code}" needs a name.`, 400);
    const kind = c?.kind || 'earning';
    if (!SALARY_COMPONENT_KINDS.includes(kind)) throw fail(`Component "${code}": kind must be earning or deduction.`, 400);
    const monthlyPaise = Number(c?.monthlyPaise);
    if (!Number.isSafeInteger(monthlyPaise) || monthlyPaise < 0 || monthlyPaise > MAX_MONTHLY_PAISE) {
      throw fail(`Component "${code}": amount must be whole paise between 0 and ₹10,00,000.`, 400);
    }
    return { code, label, kind, monthlyPaise, prorate: c?.prorate !== false };
  });
  if (!out.some((c) => c.kind === 'earning' && c.monthlyPaise > 0)) throw fail('The salary needs at least one earning above ₹0.', 400);
  return out;
}

const bool = (v, d) => (v === undefined ? d : v === true);

/** The fields of a new row, from HR's input. Unknown / computed fields are ignored. */
export function cleanStructureInput(input = {}) {
  const effectiveFrom = String(input.effectiveFrom || '');
  if (!MONTH_RE.test(effectiveFrom)) throw fail('Choose the month this salary starts from (YYYY-MM).', 400);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) throw fail('Say why (for example "Joining salary" or "Annual raise").', 400);
  const om = input.overtimeMultiplier;
  let overtimeMultiplier = null;
  if (om !== undefined && om !== null && om !== '') {
    overtimeMultiplier = Number(om);
    if (!Number.isFinite(overtimeMultiplier) || overtimeMultiplier < 1 || overtimeMultiplier > 3) throw fail('Overtime rate must be between 1× and 3×.', 400);
  }
  const tds = input.tdsMonthlyPaise === undefined ? 0 : Number(input.tdsMonthlyPaise);
  if (!Number.isSafeInteger(tds) || tds < 0) throw fail('TDS must be whole paise, 0 or more.', 400);
  return {
    effectiveFrom,
    components: cleanComponents(input.components),
    pfApplicable: bool(input.pfApplicable, true),
    pfCapAtCeiling: bool(input.pfCapAtCeiling, true),
    esiApplicable: bool(input.esiApplicable, true),
    ptState: String(input.ptState || '').trim().slice(0, 40),
    overtimeEligible: bool(input.overtimeEligible, true),
    overtimeMultiplier,
    punctualityBonusEligible: bool(input.punctualityBonusEligible, true),
    tdsMonthlyPaise: tds,
    reason: reason.slice(0, 500),
  };
}

const MONEY_FIELDS = ['components', 'pfApplicable', 'pfCapAtCeiling', 'esiApplicable', 'ptState', 'overtimeEligible', 'overtimeMultiplier', 'punctualityBonusEligible', 'tdsMonthlyPaise'];
const sameContent = (row, clean) => MONEY_FIELDS.every((k) => JSON.stringify(row[k] ?? null) === JSON.stringify(clean[k] ?? null));

export const shapeStructure = (r) => ({
  id: String(r._id),
  employee: String(r.employee),
  effectiveFrom: r.effectiveFrom,
  components: r.components.map(({ code, label, kind, monthlyPaise, prorate }) => ({ code, label, kind, monthlyPaise, prorate })),
  grossMonthlyPaise: r.components.filter((c) => c.kind === 'earning').reduce((s, c) => s + c.monthlyPaise, 0),
  pfApplicable: r.pfApplicable,
  pfCapAtCeiling: r.pfCapAtCeiling,
  esiApplicable: r.esiApplicable,
  ptState: r.ptState,
  overtimeEligible: r.overtimeEligible,
  overtimeMultiplier: r.overtimeMultiplier ?? null,
  punctualityBonusEligible: r.punctualityBonusEligible !== false,
  tdsMonthlyPaise: r.tdsMonthlyPaise,
  reason: r.reason,
  createdAt: r.createdAt,
});

/**
 * Add a salary row. Same month twice with the same figures (a double click, a
 * retry) → the existing row, 200. Same month with DIFFERENT figures → 409: pay
 * history is never rewritten; use a later month.
 */
export async function addSalaryStructure(actor, employee, input, req = null) {
  if (employee.status === 'exited') throw fail('This person has left. Their salary can no longer change.', 409);
  const clean = cleanStructureInput(input);
  const existing = await salaryRepository.findOne(employee._id, clean.effectiveFrom);
  const replayOr409 = (row) => {
    if (row && sameContent(row, clean)) return { structure: shapeStructure(row), replay: true };
    throw fail(`A salary from ${clean.effectiveFrom} already exists. Pay history is never edited — add the change from a later month.`, 409);
  };
  if (existing) return replayOr409(existing);
  try {
    const row = await withTx(async (session) => {
      const created = await salaryRepository.create({ ...clean, employee: employee._id, createdBy: actor._id }, session);
      await recordHrAudit({
        action: 'salary.added', entity: 'SalaryStructure', entityId: created._id, subject: employee._id, actor, reason: clean.reason, req, session,
        // Figures are kept out of the audit log on purpose (ADR: no salary values in clear).
        changes: [{ field: 'effectiveFrom', from: null, to: clean.effectiveFrom }, { field: 'components', from: null, to: clean.components.map((c) => c.code).join(',') }],
      });
      return created;
    });
    return { structure: shapeStructure(row), replay: false };
  } catch (err) {
    if (isDuplicateKey(err)) return replayOr409(await salaryRepository.findOne(employee._id, clean.effectiveFrom));
    throw err;
  }
}

/** One employee's salary rows, newest first (keyset on effectiveFrom). */
export async function listSalaryStructures(employeeId, { cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const before = cursor && MONTH_RE.test(String(cursor)) ? String(cursor) : undefined;
  const rows = await salaryRepository.listForEmployee(employeeId, { before, limit: lim + 1 });
  const items = rows.slice(0, lim).map(shapeStructure);
  return { items, nextCursor: rows.length > lim ? items[items.length - 1].effectiveFrom : null };
}
