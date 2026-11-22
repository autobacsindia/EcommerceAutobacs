/**
 * Leave balances from the append-only ledger (models/hr/LeaveLedgerEntry.js).
 * Balance = Σ deltaHalfDays for (employee, leaveType, year). Every automatic row
 * has a deterministic `key`, so a re-run job or a double-click never counts twice:
 *
 *   grant:<emp>:<type>:<YYYY>        yearly_upfront types (pro-rated for joiners)
 *   grant:<emp>:<type>:<YYYY-MM>     monthly types
 *   cf-out:/cf-in:/lapse:<emp>:<type>:<YYYY>   year-end close of YYYY
 *   use:<request> / restore:<request>          written by requests.js
 *   adjust:<emp>:<clientRequestId>             HR adjustment (idempotent when the client sends an id)
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import leaveLedgerRepository from '../../../repositories/hr/leaveLedgerRepository.js';
import leaveTypeRepository from '../../../repositories/hr/leaveTypeRepository.js';
import leaveRequestRepository, { PENDING_STATUSES } from '../../../repositories/hr/leaveRequestRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { MONTH_RE } from '../../../config/hr.js';
import { recordHrAudit } from '../audit.js';
import { proRatedQuota, monthlyShare, firstAccrualMonth } from './calendar.js';
import { shapeLeaveType } from './types.js';
import {
  fail, isDup, isId, inTransaction,
} from './common.js';

const CURRENT = ['onboarding', 'active', 'notice'];
const EMPLOYEE_BATCH = 200;
const MAX_ADJUST = 730;

export const checkYear = (year) => {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) throw fail('year must be a calendar year, e.g. 2026', 400);
  return y;
};

/**
 * Balances of one employee for `year`, one row per type that is active or has
 * ledger rows. All figures are half-days. `available` = balance − pending.
 */
export async function getBalances(employeeId, year) {
  const y = checkYear(year);
  const [sums, types, pendingRows] = await Promise.all([
    leaveLedgerRepository.sumsForEmployeeYear(employeeId, y),
    leaveTypeRepository.list(),
    leaveRequestRepository.page(
      { employee: employeeId, year: y, status: { $in: PENDING_STATUSES } },
      { sort: { _id: 1 }, limit: 200, select: 'leaveType halfDays' },
    ),
  ]);
  const byType = new Map();
  const bucket = (id) => {
    const k = String(id);
    if (!byType.has(k)) {
      byType.set(k, {
        granted: 0, used: 0, adjusted: 0, carriedIn: 0, carriedOut: 0, lapsed: 0, encashed: 0, balance: 0, pending: 0,
      });
    }
    return byType.get(k);
  };
  const FIELD = {
    grant: 'granted', opening_balance: 'granted', use: 'used', restore: 'used', adjust: 'adjusted', lapse: 'lapsed', encash: 'encashed',
  };
  for (const s of sums) {
    const b = bucket(s._id.leaveType);
    b.balance += s.total;
    if (s._id.reason === 'carry_forward') b[s.total >= 0 ? 'carriedIn' : 'carriedOut'] += s.total;
    else b[FIELD[s._id.reason]] += s.total;
  }
  for (const r of pendingRows) bucket(r.leaveType).pending += r.halfDays;
  return types
    .filter((t) => t.active || byType.has(String(t._id)))
    .map((t) => {
      const b = byType.get(String(t._id)) || bucket(t._id);
      // `used` is stored negative in the ledger; report it as a positive count.
      return {
        leaveType: shapeLeaveType(t), year: y, ...b, used: -b.used, lapsed: -b.lapsed, encashed: -b.encashed, carriedOut: -b.carriedOut, available: b.balance - b.pending,
      };
    });
}

/** HR adjustment with a reason (±half-days). One transaction with the audit row. */
export async function adjustBalance(actor, employee, {
  leaveType, year, deltaHalfDays, reason, clientRequestId,
} = {}, req = null) {
  const y = checkYear(year);
  if (!isId(leaveType)) throw fail('Pick a leave type', 400);
  if (!Number.isInteger(deltaHalfDays) || deltaHalfDays === 0 || Math.abs(deltaHalfDays) > MAX_ADJUST) {
    throw fail('deltaHalfDays must be a non-zero whole number of half-days', 400);
  }
  const why = String(reason || '').trim();
  if (why.length < 3) throw fail('Say why the balance is being changed', 400);
  const cid = clientRequestId === undefined ? crypto.randomUUID() : String(clientRequestId);
  if (!/^[\w-]{8,64}$/.test(cid)) throw fail('clientRequestId must be 8–64 letters, digits, - or _', 400);
  const key = `adjust:${employee._id}:${cid}`;

  try {
    return await inTransaction(async (session) => {
      const type = await leaveTypeRepository.findById(leaveType, session);
      if (!type) throw fail('Leave type not found', 404);
      await leaveLedgerRepository.lockEmployee(employee._id, session);
      const before = await leaveLedgerRepository.balance(employee._id, type._id, y, session);
      if (!type.allowNegative && before + deltaHalfDays < 0) {
        throw fail(`That would take the ${type.code} balance below zero (it is ${before / 2} days)`, 422);
      }
      const row = await leaveLedgerRepository.append({
        employee: employee._id, leaveType: type._id, year: y, deltaHalfDays, reason: 'adjust', key, note: why.slice(0, 500), by: actor._id,
      }, session);
      await recordHrAudit({
        action: 'leave.balance_adjusted', entity: 'LeaveLedgerEntry', entityId: row._id, subject: employee._id, actor, reason: why, req, session,
        changes: [{ field: `${type.code}.${y}`, from: before, to: before + deltaHalfDays }],
      });
      return { entry: { id: String(row._id), deltaHalfDays, reason: 'adjust' }, balance: before + deltaHalfDays, replay: false };
    });
  } catch (err) {
    if (!isDup(err)) throw err;
    const existing = await leaveLedgerRepository.findByKey(key);
    return {
      entry: { id: String(existing._id), deltaHalfDays: existing.deltaHalfDays, reason: 'adjust' },
      balance: await leaveLedgerRepository.balance(employee._id, existing.leaveType, existing.year),
      replay: true,
    };
  }
}

/** Walk every current employee in _id order, EMPLOYEE_BATCH at a time. */
async function forEachEmployeeBatch(fn) {
  let after = null;
  for (;;) {
    const query = { status: { $in: CURRENT }, ...(after ? { _id: { $gt: after } } : {}) };
    const rows = await employeeRepository.list(query, { select: '_id joinDate status', sort: { _id: 1 }, limit: EMPLOYEE_BATCH });
    if (!rows.length) return;
    await fn(rows);
    if (rows.length < EMPLOYEE_BATCH) return;
    after = rows[rows.length - 1]._id;
  }
}

/**
 * Yearly grant for every current employee and every active `yearly_upfront`
 * type with a quota. Joiners during `year` are pro-rated. Idempotent: re-run it
 * after onboarding someone new and only their rows are added.
 */
export async function yearlyGrant(year) {
  const y = checkYear(year);
  const types = (await leaveTypeRepository.list({ activeOnly: true }))
    .filter((t) => t.accrual === 'yearly_upfront' && t.annualQuotaHalfDays > 0);
  let inserted = 0;
  await forEachEmployeeBatch(async (emps) => {
    const docs = [];
    for (const e of emps) {
      for (const t of types) {
        const delta = proRatedQuota(t.annualQuotaHalfDays, y, e.joinDate);
        if (delta > 0) {
          docs.push({
            employee: e._id, leaveType: t._id, year: y, deltaHalfDays: delta, reason: 'grant', key: `grant:${e._id}:${t._id}:${y}`, note: `${y} grant`,
          });
        }
      }
    }
    inserted += await leaveLedgerRepository.appendManyIdempotent(docs);
  });
  return { year: y, types: types.map((t) => t.code), inserted };
}

/** Monthly accrual for `month` ('YYYY-MM') for every active `monthly` type. Idempotent. */
export async function monthlyGrant(month) {
  if (!MONTH_RE.test(String(month || ''))) throw fail('month must be YYYY-MM', 400);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  checkYear(y);
  const types = (await leaveTypeRepository.list({ activeOnly: true }))
    .filter((t) => t.accrual === 'monthly' && t.annualQuotaHalfDays > 0);
  let inserted = 0;
  await forEachEmployeeBatch(async (emps) => {
    const docs = [];
    for (const e of emps) {
      if (m < firstAccrualMonth(y, e.joinDate)) continue;
      for (const t of types) {
        const delta = monthlyShare(t.annualQuotaHalfDays, m);
        if (delta > 0) {
          docs.push({
            employee: e._id, leaveType: t._id, year: y, deltaHalfDays: delta, reason: 'grant', key: `grant:${e._id}:${t._id}:${month}`, note: `${month} accrual`,
          });
        }
      }
    }
    inserted += await leaveLedgerRepository.appendManyIdempotent(docs);
  });
  return { month, types: types.map((t) => t.code), inserted };
}

/**
 * Year-end close of `year`: for each paid type, carry the positive balance into
 * year+1 up to the type's cap and lapse the rest. A negative balance stays in
 * the old year (it was LOP). Idempotent per employee/type/year by key; the
 * three rows of one employee/type are written in one transaction.
 */
export async function yearEndClose(year) {
  const y = checkYear(year);
  const types = (await leaveTypeRepository.list()).filter((t) => t.paid !== false);
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  let carried = 0;
  let lapsed = 0;
  await forEachEmployeeBatch(async (emps) => {
    const rows = await leaveLedgerRepository.balancesForEmployees(emps.map((e) => e._id), types.map((t) => t._id), y);
    for (const r of rows) {
      const t = typeById.get(String(r.leaveType));
      if (!t || r.total <= 0) continue;
      const carry = Math.min(r.total, t.carryForwardMaxHalfDays || 0);
      const lapse = r.total - carry;
      const base = `${r.employee}:${r.leaveType}:${y}`;
      const docs = [];
      if (carry > 0) {
        docs.push({ employee: r.employee, leaveType: r.leaveType, year: y, deltaHalfDays: -carry, reason: 'carry_forward', key: `cf-out:${base}`, note: `carried to ${y + 1}` });
        docs.push({ employee: r.employee, leaveType: r.leaveType, year: y + 1, deltaHalfDays: carry, reason: 'carry_forward', key: `cf-in:${base}`, note: `carried from ${y}` });
      }
      if (lapse > 0) docs.push({ employee: r.employee, leaveType: r.leaveType, year: y, deltaHalfDays: -lapse, reason: 'lapse', key: `lapse:${base}`, note: `${y} year end` });
      try {
        await inTransaction(async (session) => {
          for (const d of docs) {
            await leaveLedgerRepository.append(d, session);
          }
        });
        carried += carry;
        lapsed += lapse;
      } catch (err) {
        if (!isDup(err)) throw err; // already closed for this employee/type
      }
    }
  });
  return { year: y, carriedHalfDays: carried, lapsedHalfDays: lapsed };
}

/** Recent ledger rows (statement) for one employee/year. */
export async function ledgerFor(employeeId, year) {
  const y = checkYear(year);
  const rows = await leaveLedgerRepository.listForEmployeeYear(new mongoose.Types.ObjectId(String(employeeId)), y);
  return rows.map((r) => ({
    id: String(r._id), leaveType: String(r.leaveType), deltaHalfDays: r.deltaHalfDays, reason: r.reason, note: r.note || '', request: r.request ? String(r.request) : null, at: r.createdAt,
  }));
}
