/**
 * Leave types (models/hr/LeaveType.js): HR/admin CRUD + an optional seed of the
 * defaults from the owner-approved plan. Quotas are HALF-DAYS on the wire too
 * (`annualQuotaHalfDays: 16` = 8 days), matching the ledger.
 */
import leaveTypeRepository from '../../../repositories/hr/leaveTypeRepository.js';
import { LEAVE_ACCRUALS } from '../../../config/hr.js';
import { recordHrAudit, diffFields } from '../audit.js';
import { fail, isDup, isId, inTransaction } from './common.js';

/** Defaults (docs/ADR-hr-system.md §6): CL 8, SL 6, EL 12 carry ≤ 30, LOP unpaid. */
export const DEFAULT_LEAVE_TYPES = Object.freeze([
  Object.freeze({ code: 'CL', name: 'Casual leave', paid: true, annualQuotaHalfDays: 16, accrual: 'yearly_upfront', minNoticeDays: 1 }),
  Object.freeze({ code: 'SL', name: 'Sick leave', paid: true, annualQuotaHalfDays: 12, accrual: 'yearly_upfront', documentAfterDays: 2 }),
  Object.freeze({
    code: 'EL', name: 'Earned leave', paid: true, annualQuotaHalfDays: 24, accrual: 'monthly', carryForwardMaxHalfDays: 60, encashable: true, minNoticeDays: 7, sandwich: true,
  }),
  Object.freeze({ code: 'LOP', name: 'Leave without pay', paid: false, annualQuotaHalfDays: 0, allowNegative: true }),
]);

const FIELDS = {
  code: 'string', name: 'string', paid: 'boolean', annualQuotaHalfDays: 'int', accrual: 'accrual', carryForwardMaxHalfDays: 'int',
  encashable: 'boolean', allowHalfDay: 'boolean', minNoticeDays: 'int', sandwich: 'boolean', documentAfterDays: 'int',
  allowNegative: 'boolean', active: 'boolean',
};

/** Whitelist + type-check the input; unknown fields are ignored. */
function clean(input, { requireAll = false } = {}) {
  const out = {};
  for (const [k, kind] of Object.entries(FIELDS)) {
    const v = input[k];
    if (v === undefined) continue;
    if (kind === 'string') {
      const s = String(v ?? '').trim();
      if (!s) throw fail(`${k === 'code' ? 'Code' : 'Name'} is required`, 400);
      if (k === 'code' && !/^[A-Za-z0-9]{1,10}$/.test(s)) throw fail('Code is 1–10 letters or digits (e.g. CL)', 400);
      out[k] = k === 'code' ? s.toUpperCase() : s.slice(0, 60);
    } else if (kind === 'boolean') {
      if (typeof v !== 'boolean') throw fail(`${k} must be true or false`, 400);
      out[k] = v;
    } else if (kind === 'int') {
      if (!Number.isInteger(v) || v < 0) throw fail(`${k} must be a whole number ≥ 0`, 400);
      out[k] = v;
    } else if (kind === 'accrual') {
      if (!LEAVE_ACCRUALS.includes(v)) throw fail(`accrual must be one of ${LEAVE_ACCRUALS.join(', ')}`, 400);
      out[k] = v;
    }
  }
  if (requireAll && (!out.code || !out.name)) throw fail('Code and name are required', 400);
  return out;
}

export const shapeLeaveType = (t) => (t ? {
  id: String(t._id),
  code: t.code,
  name: t.name,
  paid: t.paid !== false,
  annualQuotaHalfDays: t.annualQuotaHalfDays || 0,
  accrual: t.accrual,
  carryForwardMaxHalfDays: t.carryForwardMaxHalfDays || 0,
  encashable: !!t.encashable,
  allowHalfDay: t.allowHalfDay !== false,
  minNoticeDays: t.minNoticeDays || 0,
  sandwich: !!t.sandwich,
  documentAfterDays: t.documentAfterDays || 0,
  allowNegative: !!t.allowNegative,
  active: t.active !== false,
  rev: t.rev || 0,
} : null);

export async function listLeaveTypes({ activeOnly = false } = {}) {
  return (await leaveTypeRepository.list({ activeOnly })).map(shapeLeaveType);
}

export async function createLeaveType(actor, input, req = null) {
  const doc = clean(input || {}, { requireAll: true });
  try {
    return shapeLeaveType(await inTransaction(async (session) => {
      const row = await leaveTypeRepository.create({ ...doc, createdBy: actor._id }, session);
      await recordHrAudit({
        action: 'leave_type.created', entity: 'LeaveType', entityId: row._id, actor, req, session,
        changes: diffFields({}, doc),
      });
      return row;
    }));
  } catch (err) {
    if (isDup(err)) throw fail(`A leave type with code ${doc.code} already exists`, 409);
    throw err;
  }
}

export async function updateLeaveType(actor, id, input, { rev, reason = '', req = null } = {}) {
  if (!isId(id)) throw fail('Leave type not found', 404);
  if (!Number.isInteger(rev)) throw fail('rev is required', 400);
  const set = clean(input || {});
  // The code is the ledger's and the payroll export's identifier — fixed once created.
  delete set.code;
  if (!Object.keys(set).length) throw fail('Nothing to change', 400);
  return shapeLeaveType(await inTransaction(async (session) => {
    const before = await leaveTypeRepository.findById(id, session);
    if (!before) throw fail('Leave type not found', 404);
    const row = await leaveTypeRepository.updateIfRev(id, rev, set, session);
    if (!row) throw fail('This leave type was changed by someone else. Reload and try again.', 409);
    await recordHrAudit({
      action: 'leave_type.updated', entity: 'LeaveType', entityId: row._id, actor, reason, req, session,
      changes: diffFields(before, set),
    });
    return row;
  }));
}

/**
 * Create whichever default types don't exist yet (by code). Idempotent: pressing
 * it twice — or concurrently — creates each default once.
 */
export async function seedDefaultLeaveTypes(actor, req = null) {
  const existing = new Set((await leaveTypeRepository.findByCodes(DEFAULT_LEAVE_TYPES.map((t) => t.code))).map((t) => t.code));
  const created = [];
  for (const def of DEFAULT_LEAVE_TYPES) {
    if (existing.has(def.code)) continue;
    try {
      created.push(await createLeaveType(actor, { ...def }, req));
    } catch (err) {
      if (err.statusCode !== 409) throw err; // created by a concurrent press
    }
  }
  return { created, types: await listLeaveTypes() };
}
