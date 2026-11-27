/**
 * The monthly payroll run (models/hr/PayrollRun.js):
 *
 *   prepare (HR) ─▶ draft ──lock (HR)──▶ locked ──approve (ADMIN)──▶ approved ──▶ payouts
 *                    ▲  recompute          │ unlock (HR, reason)        │ reopen (ADMIN, reason,
 *                    └─────────────────────┘                            │  only before payouts)
 *                    └──────────────────────────────────────────────────┘
 *
 * - One run per month (unique index): preparing the same month twice returns the
 *   same run.
 * - Every figure is computed here from server data (calculate.js). Nothing in a
 *   request body is a money figure except an HR adjustment's own amount.
 * - Payslips are written only while the run is draft; locked/approved runs are
 *   frozen. Every transition is a compare-and-set on { status, rev }.
 * - `inputsFingerprint` hashes every input (rules, salary rows, attendance
 *   summaries, adjustments, join/exit dates) when the payslips are computed.
 *   Lock and approve re-read the inputs and refuse when anything moved since:
 *   "changed since computed — recompute". So an approved run is always exactly
 *   what the inputs said at approval.
 * - Locking flags the month's AttendanceDays `payrollLocked` (attendance's own
 *   export, in the same transaction).
 * - Approval releases the payslips to the employees and raises one
 *   PaymentRequest per payslip (payouts.js), idempotent per payslip.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../../../utils/AppError.js';
import payrollRepository from '../../../repositories/hr/payrollRepository.js';
import salaryRepository from '../../../repositories/hr/salaryRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { MONTH_RE, PAYROLL_ADJUSTMENT_KINDS } from '../../../config/hr.js';
import { getHrSettings } from '../settings.js';
import { recordHrAudit } from '../audit.js';
import { monthAttendanceSummary, markMonthLocked, markMonthUnlocked } from './attendanceSource.js';
import { computePayslip, daysInMonth, BLOCKING_WARNINGS, EARNING_ADJUSTMENTS } from './calculate.js';
import { payrollRules } from './rules.js';
import { withTx, isDuplicateKey } from './tx.js';
import { createPayouts, payslipNumber } from './payouts.js';
import { notifyPayslipsReleased } from './notify.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const ROSTER_MAX = 2000;
const SUMMARY_CONCURRENCY = 5;
const MAX_ADJUSTMENT_PAISE = 100000000; // ₹10 lakh: a typo guard

const STALE = 'Someone changed this payroll since you opened it. Reload and try again.';
const CHANGED = 'Attendance, salary or adjustments changed since the payslips were worked out. Recompute first.';

export const istMonth = (now = new Date()) => new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 7);

function checkMonth(month) {
  if (!MONTH_RE.test(String(month))) throw fail('Month must look like 2026-12.', 400);
  return String(month);
}

const historyRow = (actor, action, reason = '') => ({
  action, at: new Date(), by: actor?._id || null, byName: actor ? (actor.name || actor.email || 'user') : 'system', reason: String(reason || '').slice(0, 1000),
});

const needRev = (rev) => {
  if (rev === undefined || rev === null || rev === '' || !Number.isInteger(Number(rev))) throw fail('Missing rev — reload the payroll and try again.', 400);
  return Number(rev);
};
const needReason = (reason) => {
  const r = String(reason || '').trim();
  if (r.length < 3) throw fail('Please give a reason.', 400);
  return r.slice(0, 1000);
};

// ── Inputs ───────────────────────────────────────────────────────────────────

async function roster(month) {
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const rows = await employeeRepository.list({
    status: { $in: ['active', 'notice', 'exited'] },
    $and: [
      { $or: [{ joinDate: null }, { joinDate: { $lte: end } }] },
      { $or: [{ exitDate: null }, { exitDate: { $gte: start } }] },
    ],
  }, {
    select: 'name employeeCode designation team status joinDate exitDate panLast4 uan bank.accountLast4',
    sort: { name: 1, _id: 1 },
    limit: ROSTER_MAX,
  });
  if (rows.length >= ROSTER_MAX) throw fail(`More than ${ROSTER_MAX} employees — payroll needs batching first.`, 500);
  // An 'exited' profile without a last day has nothing to pay this month.
  return rows.filter((e) => !(e.status === 'exited' && !e.exitDate));
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i; i += 1; out[k] = await fn(items[k]); }
  }));
  return out;
}

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof mongoose.Types.ObjectId)) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v instanceof mongoose.Types.ObjectId ? String(v) : v;
};

/** Everything a month's payslips depend on, and its fingerprint. Read-only. */
export async function gatherInputs(month) {
  const [settings, employees, adjustments] = await Promise.all([
    getHrSettings(), roster(month), payrollRepository.listAdjustments(month),
  ]);
  const rules = payrollRules(settings);
  const structures = await salaryRepository.inForce(employees.map((e) => e._id), month);
  const adjBy = new Map();
  for (const a of adjustments) {
    const k = String(a.employee);
    if (!adjBy.has(k)) adjBy.set(k, []);
    adjBy.get(k).push(a);
  }
  const skipped = [];
  const paid = [];
  for (const e of employees) {
    const structure = structures.get(String(e._id));
    if (!structure) skipped.push({ employee: e._id, name: e.name, reason: 'No salary set for this month' });
    else paid.push({ employee: e, structure, adjustments: adjBy.get(String(e._id)) || [] });
  }
  // Adjustments for someone not in this month's run would silently vanish: say so.
  const inRun = new Set(paid.map((p) => String(p.employee._id)));
  for (const [emp, rows] of adjBy) {
    if (!inRun.has(emp) && rows.some((r) => !r.cancelledAt) && !skipped.some((s) => String(s.employee) === emp)) {
      skipped.push({ employee: emp, name: '', reason: 'Has adjustments but is not employed this month' });
    }
  }
  const summaries = await mapLimit(paid, SUMMARY_CONCURRENCY, (p) => monthAttendanceSummary(p.employee._id, month));
  paid.forEach((p, i) => { p.summary = summaries[i]; });

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(sortKeys({
    month,
    rules,
    entries: paid.map((p) => ({
      employee: String(p.employee._id),
      joinDate: p.employee.joinDate || null,
      exitDate: p.employee.exitDate || null,
      structure: String(p.structure._id),
      structureAt: p.structure.updatedAt ? new Date(p.structure.updatedAt).toISOString() : null,
      summary: p.summary,
      adjustments: p.adjustments.map((a) => ({ id: String(a._id), kind: a.kind, amountPaise: a.amountPaise, cancelled: !!a.cancelledAt })),
    })),
  }))).digest('hex');

  return { month, rules, entries: paid, skipped, fingerprint };
}

function buildPayslips(run, inputs) {
  return inputs.entries.map(({ employee, structure, summary, adjustments }) => {
    const r = computePayslip({ month: inputs.month, structure, summary, employee, rules: inputs.rules, adjustments });
    const warnings = [...r.warnings];
    if (Number(summary.unresolvedDays) > 0) warnings.push('attendance_needs_review');
    return {
      run: run._id,
      month: inputs.month,
      kind: 'monthly',
      employee: employee._id,
      snapshot: {
        name: employee.name,
        employeeCode: employee.employeeCode,
        designation: employee.designation || '',
        team: employee.team || '',
        joinDate: employee.joinDate || '',
        exitDate: employee.exitDate || '',
        panLast4: employee.panLast4 || '',
        uan: employee.uan || '',
        bankLast4: employee.bank?.accountLast4 || '',
        salaryStructure: structure._id,
      },
      attendance: r.attendance,
      lines: r.lines,
      grossPaise: r.grossPaise,
      deductionsPaise: r.deductionsPaise,
      netPaise: r.netPaise,
      employerPaise: r.employerPaise,
      warnings,
    };
  });
}

function totalsOf(slips) {
  const sumCode = (code) => slips.reduce((s, p) => s + p.lines.filter((l) => l.code === code).reduce((a, l) => a + l.amountPaise, 0), 0);
  return {
    grossPaise: slips.reduce((s, p) => s + p.grossPaise, 0),
    deductionsPaise: slips.reduce((s, p) => s + p.deductionsPaise, 0),
    netPaise: slips.reduce((s, p) => s + p.netPaise, 0),
    employerPfPaise: sumCode('pf_employer'),
    employerEsiPaise: sumCode('esi_employer'),
  };
}

/** Writes the computed payslips into a DRAFT run (CAS on rev). Returns the run. */
async function writeComputed(actor, run, inputs, action, req) {
  const slips = buildPayslips(run, inputs);
  const blocked = slips.filter((s) => s.warnings.some((w) => BLOCKING_WARNINGS.includes(w))).length;
  return withTx(async (session) => {
    const next = await payrollRepository.transitionRun(run._id, { from: ['draft'], rev: run.rev }, {
      employeeCount: slips.length,
      totals: totalsOf(slips),
      settingsSnapshot: inputs.rules,
      inputsFingerprint: inputs.fingerprint,
      skipped: inputs.skipped,
      blockedCount: blocked,
      computedAt: new Date(),
    }, historyRow(actor, action), session);
    if (!next) throw fail(STALE, 409);
    await payrollRepository.deleteRunPayslips(run._id, session);
    await payrollRepository.insertPayslips(slips, session);
    await recordHrAudit({
      action: `payroll.${action}`, entity: 'PayrollRun', entityId: run._id, actor, req, session,
      changes: [{ field: 'employeeCount', from: run.employeeCount ?? 0, to: slips.length }],
    });
    return next;
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** HR: create the month's run (or return the existing one) and work out the payslips. */
export async function prepareRun(actor, month, { now = new Date(), req = null } = {}) {
  checkMonth(month);
  if (month >= istMonth(now)) throw fail('This month has not ended yet. Payroll runs after the month is over.', 400);
  let run;
  try {
    run = await payrollRepository.ensureRun(month, {});
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    run = await payrollRepository.findRun(month);
  }
  // Already worked out (or past draft): the same run, unchanged. Recompute is its own action.
  if (run.computedAt || run.status !== 'draft') return { run: await getRun(month), created: false };
  const inputs = await gatherInputs(month);
  try {
    await writeComputed(actor, run, inputs, 'prepared', req);
  } catch (err) {
    // A parallel prepare won the CAS and computed it: same result.
    if (!(err instanceof AppError && err.statusCode === 409)) throw err;
  }
  return { run: await getRun(month), created: true };
}

/** HR: work the draft payslips out again from current data. */
export async function recomputeRun(actor, month, { rev, req = null } = {}) {
  checkMonth(month);
  const run = await payrollRepository.findRun(month);
  if (!run) throw fail('No payroll for this month yet. Prepare it first.', 404);
  if (run.status !== 'draft') throw fail(`This payroll is ${run.status}. Unlock it before recomputing.`, 409);
  if (needRev(rev) !== run.rev) throw fail(STALE, 409);
  const inputs = await gatherInputs(month);
  await writeComputed(actor, run, inputs, 'recomputed', req);
  return getRun(month);
}

/** HR: freeze the draft. Refused when a payslip is blocked or the inputs moved. */
export async function lockRun(actor, month, { rev, req = null } = {}) {
  checkMonth(month);
  const run = await payrollRepository.findRun(month);
  if (!run) throw fail('No payroll for this month yet. Prepare it first.', 404);
  if (run.status !== 'draft') throw fail(`This payroll is already ${run.status}.`, 409);
  if (needRev(rev) !== run.rev) throw fail(STALE, 409);
  if (!run.computedAt || !run.employeeCount) throw fail('There are no payslips to lock.', 409);
  if (run.blockedCount > 0) throw fail(`${run.blockedCount} payslip(s) have deductions above earnings. Fix the adjustments and recompute.`, 409);
  const inputs = await gatherInputs(month);
  if (inputs.fingerprint !== run.inputsFingerprint) throw fail(CHANGED, 409);
  await withTx(async (session) => {
    const next = await payrollRepository.transitionRun(run._id, { from: ['draft'], rev: run.rev },
      { status: 'locked', lockedAt: new Date(), lockedBy: actor._id }, historyRow(actor, 'locked'), session);
    if (!next) throw fail(STALE, 409);
    await markMonthLocked(month, session);
    await recordHrAudit({
      action: 'payroll.locked', entity: 'PayrollRun', entityId: run._id, actor, req, session,
      changes: [{ field: 'status', from: 'draft', to: 'locked' }],
    });
  });
  return getRun(month);
}

/** HR: back to draft (with a reason) — only while locked, never after approval. */
export async function unlockRun(actor, month, { rev, reason, req = null } = {}) {
  checkMonth(month);
  const why = needReason(reason);
  const run = await payrollRepository.findRun(month);
  if (!run) throw fail('No payroll for this month yet.', 404);
  if (run.status !== 'locked') throw fail(run.status === 'approved' ? 'An approved payroll can only be re-opened by an administrator.' : 'This payroll is not locked.', 409);
  if (needRev(rev) !== run.rev) throw fail(STALE, 409);
  await withTx(async (session) => {
    const next = await payrollRepository.transitionRun(run._id, { from: ['locked'], rev: run.rev },
      { status: 'draft', lockedAt: null, lockedBy: null }, historyRow(actor, 'unlocked', why), session);
    if (!next) throw fail(STALE, 409);
    await markMonthUnlocked(month, session);
    await recordHrAudit({
      action: 'payroll.unlocked', entity: 'PayrollRun', entityId: run._id, actor, reason: why, req, session,
      changes: [{ field: 'status', from: 'locked', to: 'draft' }],
    });
  });
  return getRun(month);
}

/**
 * ADMIN: approve a locked run. Re-checks rev (what the admin saw) and the inputs
 * fingerprint (nothing moved since computing), releases the payslips to the
 * employees, then raises the payment requests. Approving an approved run again
 * is not an error: it only (re-)tries the missing payment requests.
 */
export async function approveRun(actor, month, { rev, fingerprint, req = null } = {}) {
  checkMonth(month);
  const run = await payrollRepository.findRun(month);
  if (!run) throw fail('No payroll for this month yet.', 404);
  if (run.status === 'approved') {
    const payouts = await createPayouts(actor, month, { req });
    return { run: await getRun(month), payouts, replay: true };
  }
  if (run.status !== 'locked') throw fail('Only a locked payroll can be approved. HR locks it first.', 409);
  if (needRev(rev) !== run.rev) throw fail(STALE, 409);
  if (fingerprint !== undefined && fingerprint !== run.inputsFingerprint) throw fail(STALE, 409);
  const inputs = await gatherInputs(month);
  if (inputs.fingerprint !== run.inputsFingerprint) throw fail(`${CHANGED} (HR unlocks, recomputes and locks again.)`, 409);
  const at = new Date();
  await withTx(async (session) => {
    const next = await payrollRepository.transitionRun(run._id, { from: ['locked'], rev: run.rev },
      { status: 'approved', approvedAt: at, approvedBy: actor._id }, historyRow(actor, 'approved'), session);
    if (!next) throw fail(STALE, 409);
    await payrollRepository.setRunReleased(run._id, at, session);
    await recordHrAudit({
      action: 'payroll.approved', entity: 'PayrollRun', entityId: run._id, actor, req, session,
      changes: [{ field: 'status', from: 'locked', to: 'approved' }],
    });
  });
  const payouts = await createPayouts(actor, month, { req });
  // After commit: tell each employee their payslip is ready (idempotent per payslip).
  await notifyPayslipsReleased(await payrollRepository.listRunPayslips(run._id));
  return { run: await getRun(month), payouts, replay: false };
}

/**
 * ADMIN: re-open an approved run (reason required) — only while no payment
 * request has been raised for it. After that, a mistake is corrected with an
 * adjustment next month, never by rewriting a paid month.
 */
export async function reopenRun(actor, month, { rev, reason, req = null } = {}) {
  checkMonth(month);
  const why = needReason(reason);
  const run = await payrollRepository.findRun(month);
  if (!run) throw fail('No payroll for this month yet.', 404);
  if (run.status !== 'approved') throw fail('Only an approved payroll can be re-opened.', 409);
  if (needRev(rev) !== run.rev) throw fail(STALE, 409);
  if (await payrollRepository.countPayouts(run._id) > 0) {
    throw fail('Salary payment requests were already raised for this month. Correct it with an adjustment next month instead.', 409);
  }
  await withTx(async (session) => {
    const next = await payrollRepository.transitionRun(run._id, { from: ['approved'], rev: run.rev },
      { status: 'draft', approvedAt: null, approvedBy: null, lockedAt: null, lockedBy: null }, historyRow(actor, 'reopened', why), session);
    if (!next) throw fail(STALE, 409);
    await payrollRepository.setRunReleased(run._id, null, session);
    await markMonthUnlocked(month, session);
    await recordHrAudit({
      action: 'payroll.reopened', entity: 'PayrollRun', entityId: run._id, actor, reason: why, req, session,
      changes: [{ field: 'status', from: 'approved', to: 'draft' }],
    });
  });
  return getRun(month);
}

// ── Reads ────────────────────────────────────────────────────────────────────

const shapeRun = (r) => ({
  id: String(r._id),
  month: r.month,
  status: r.status,
  rev: r.rev,
  employeeCount: r.employeeCount,
  totals: r.totals,
  blockedCount: r.blockedCount || 0,
  skipped: (r.skipped || []).map((s) => ({ employee: String(s.employee), name: s.name, reason: s.reason })),
  rules: r.settingsSnapshot,
  fingerprint: r.inputsFingerprint,
  computedAt: r.computedAt,
  lockedAt: r.lockedAt,
  approvedAt: r.approvedAt,
  payoutsCreatedAt: r.payoutsCreatedAt,
  payoutsCount: r.payoutsCount || 0,
  history: (r.history || []).map(({ action, at, byName, reason }) => ({ action, at, byName, reason })),
});

export const shapePayslipRow = (p) => ({
  id: String(p._id),
  number: payslipNumber(p),
  month: p.month,
  kind: p.kind,
  employee: String(p.employee),
  name: p.snapshot?.name,
  employeeCode: p.snapshot?.employeeCode,
  grossPaise: p.grossPaise,
  deductionsPaise: p.deductionsPaise,
  netPaise: p.netPaise,
  warnings: p.warnings || [],
  released: !!p.releasedAt,
  payoutRequest: p.payoutRequest ? String(p.payoutRequest) : null,
});

/** HR/admin: the run and its payslips (headcount-bounded). */
export async function getRun(month) {
  checkMonth(month);
  const run = await payrollRepository.findRun(month);
  if (!run) throw fail('No payroll for this month yet.', 404);
  const slips = await payrollRepository.listRunPayslips(run._id);
  return { ...shapeRun(run), payslips: slips.map(shapePayslipRow) };
}

export async function listRuns({ cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const before = cursor && MONTH_RE.test(String(cursor)) ? String(cursor) : undefined;
  const rows = await payrollRepository.listRuns({ before, limit: lim + 1 });
  const items = rows.slice(0, lim).map(shapeRun);
  return { items, nextCursor: rows.length > lim ? items[items.length - 1].month : null };
}

// ── Adjustments ──────────────────────────────────────────────────────────────

async function assertMonthEditable(month) {
  const run = await payrollRepository.findRun(month);
  if (run && run.status !== 'draft') throw fail(`The ${month} payroll is ${run.status}. Adjustments can't change now.`, 409);
}

const shapeAdjustment = (a) => ({
  id: String(a._id), employee: String(a.employee), month: a.month, kind: a.kind, amountPaise: a.amountPaise,
  earning: EARNING_ADJUSTMENTS.includes(a.kind), reason: a.reason, system: !!a.system, cancelled: !!a.cancelledAt,
});

/**
 * HR: a one-off line for one employee (bonus, advance recovery…). Takes effect on
 * the next recompute. `clientRequestId` makes a double submit save once.
 */
export async function addAdjustment(actor, month, input = {}, req = null) {
  checkMonth(month);
  const kind = String(input.kind || '');
  if (!PAYROLL_ADJUSTMENT_KINDS.includes(kind)) throw fail(`Kind must be one of: ${PAYROLL_ADJUSTMENT_KINDS.join(', ')}.`, 400);
  const amountPaise = Number(input.amountPaise);
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1 || amountPaise > MAX_ADJUSTMENT_PAISE) throw fail('Amount must be whole paise, at least 1.', 400);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) throw fail('Say what this is for.', 400);
  if (!mongoose.isValidObjectId(input.employeeId)) throw fail('Employee not found', 404);
  const employee = await employeeRepository.findById(input.employeeId);
  if (!employee) throw fail('Employee not found', 404);
  const cid = String(input.clientRequestId || '').trim();
  if (cid && !/^[\w:-]{6,80}$/.test(cid)) throw fail('Bad clientRequestId.', 400);
  const key = cid ? `manual:${actor._id}:${cid}` : undefined;
  if (key) {
    const seen = await payrollRepository.findAdjustmentByKey(key);
    if (seen) return { adjustment: shapeAdjustment(seen), replay: true };
  }
  await assertMonthEditable(month);
  try {
    const row = await withTx(async (session) => {
      const created = await payrollRepository.createAdjustment({
        employee: employee._id, month, kind, amountPaise, reason: reason.slice(0, 500), createdBy: actor._id, ...(key ? { key } : {}),
      }, session);
      await recordHrAudit({
        action: 'payroll.adjustment_added', entity: 'PayrollAdjustment', entityId: created._id, subject: employee._id, actor, reason, req, session,
        changes: [{ field: 'kind', from: null, to: kind }],
      });
      return created;
    });
    return { adjustment: shapeAdjustment(row), replay: false };
  } catch (err) {
    if (key && isDuplicateKey(err)) return { adjustment: shapeAdjustment(await payrollRepository.findAdjustmentByKey(key)), replay: true };
    throw err;
  }
}

export async function cancelAdjustment(actor, id, { reason, req = null } = {}) {
  if (!mongoose.isValidObjectId(id)) throw fail('Adjustment not found', 404);
  const a = await payrollRepository.findAdjustment(id);
  if (!a) throw fail('Adjustment not found', 404);
  if (a.cancelledAt) return { adjustment: shapeAdjustment(a), replay: true };
  await assertMonthEditable(a.month);
  const row = await withTx(async (session) => {
    const r = await payrollRepository.cancelAdjustment(a._id, actor._id, new Date(), session);
    if (!r) return null;
    await recordHrAudit({
      action: 'payroll.adjustment_cancelled', entity: 'PayrollAdjustment', entityId: a._id, subject: a.employee, actor, reason: reason || '', req, session,
      changes: [{ field: 'cancelled', from: false, to: true }],
    });
    return r;
  });
  return { adjustment: shapeAdjustment(row || await payrollRepository.findAdjustment(id)), replay: !row };
}

export async function listAdjustments(month) {
  checkMonth(month);
  const rows = await payrollRepository.listAdjustments(month);
  return { items: rows.map(shapeAdjustment), nextCursor: null };
}
