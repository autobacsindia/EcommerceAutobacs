/**
 * Leave requests: apply → (team head) → HR → approved | rejected | cancelled.
 *
 * Invariants (tests/hrLeave*.test.js):
 *   - `halfDays` and the charged `days` are SERVER-computed (shift weekly offs,
 *     holidays of the employee's sites, half-day flags, sandwich rule).
 *   - one request per (employee, clientRequestId): a double submit returns the
 *     first request, never a second one.
 *   - no two live requests of one person overlap; a paid type cannot go below
 *     zero (pending requests reserve their days). Both checks run inside a
 *     transaction that first touches the employee's lock row, so two different
 *     requests racing each other are serialised (see models/hr/LeaveEmployeeLock.js).
 *   - every decision is a CAS on (rev, status); the final approval writes the
 *     ledger 'use' row (unique key `use:<request>`) and the audit row in ONE
 *     transaction, so a double approve writes one ledger row. Cancelling an
 *     approved request writes `restore:<request>` the same way.
 */
import leaveRequestRepository, { LIVE_STATUSES, PENDING_STATUSES } from '../../../repositories/hr/leaveRequestRepository.js';
import leaveTypeRepository from '../../../repositories/hr/leaveTypeRepository.js';
import leaveLedgerRepository from '../../../repositories/hr/leaveLedgerRepository.js';
import leaveCalendarRepository from '../../../repositories/hr/leaveCalendarRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import userRepository from '../../../repositories/userRepository.js';
import counterRepository from '../../../repositories/counterRepository.js';
import {
  canAccessEmployee, isHrOrAdmin, isAdminUser, isActiveStaffUser,
} from '../../../middleware/hrAuth.js';
import { encodeCursor, decodeCursor, afterClause, sortSpec } from '../../../utils/listQuery.js';
import { recordHrAudit } from '../audit.js';
import { getHrSettings } from '../settings.js';
import {
  countLeave, isValidDate, yearOf, daysBetween, addDays, istToday,
} from './calendar.js';
import { holidayDatesInRange } from './holidays.js';
import {
  fail, isDup, isId, inTransaction, pageSize,
} from './common.js';

/** Longest single request (inclusive days). Longer leave = several requests. */
export const MAX_SPAN_DAYS = 62;
/** Sick-type leave (minNoticeDays 0) may be reported up to this many days late. */
export const BACKDATE_DAYS = 7;
const CLIENT_ID_RE = /^[\w-]{8,64}$/;
const NEWEST = Object.freeze({ field: 'createdAt', dir: -1, type: 'date' });
const OLDEST = Object.freeze({ field: 'createdAt', dir: 1, type: 'date' });
const LIST_SELECT = 'number employee leaveType from to firstHalfOnly secondHalfOnly halfDays year paid reason status approver decisions requestedBy cancelledAt rev createdAt';

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const notFound = () => fail('Leave request not found', 404);

export function shapeRequest(r, { types = new Map(), employees = new Map() } = {}) {
  const t = types.get(String(r.leaveType));
  const e = employees.get(String(r.employee));
  return {
    id: String(r._id),
    number: r.number,
    employee: String(r.employee),
    employeeName: e?.name || undefined,
    employeeCode: e?.employeeCode || undefined,
    leaveType: String(r.leaveType),
    leaveTypeCode: t?.code || undefined,
    leaveTypeName: t?.name || undefined,
    from: r.from,
    to: r.to,
    firstHalfOnly: !!r.firstHalfOnly,
    secondHalfOnly: !!r.secondHalfOnly,
    halfDays: r.halfDays,
    year: r.year,
    paid: r.paid !== false,
    reason: r.reason || '',
    status: r.status,
    approver: r.approver ? String(r.approver) : null,
    decisions: (r.decisions || []).map((d) => ({
      step: d.step, decision: d.decision, by: String(d.by), byName: d.byName || '', at: d.at, note: d.note || '',
    })),
    requestedBy: r.requestedBy ? String(r.requestedBy) : null,
    cancelledAt: r.cancelledAt || null,
    rev: r.rev || 0,
    createdAt: r.createdAt,
  };
}

/** Lookup maps for a page of requests: two bounded batch reads, never one per row. */
async function lookups(rows) {
  const typeIds = [...new Set(rows.map((r) => String(r.leaveType)))];
  const empIds = [...new Set(rows.map((r) => String(r.employee)))];
  const [types, emps] = await Promise.all([
    typeIds.length ? leaveTypeRepository.findByIds(typeIds) : [],
    empIds.length ? employeeRepository.list({ _id: { $in: empIds } }, { select: 'name employeeCode team', sort: { _id: 1 }, limit: empIds.length }) : [],
  ]);
  return {
    types: new Map(types.map((t) => [String(t._id), t])),
    employees: new Map(emps.map((e) => [String(e._id), e])),
  };
}

async function weeklyOffFor(employee) {
  const shift = employee.shift ? await leaveCalendarRepository.findShift(employee.shift) : null;
  const fallback = shift ? null : await leaveCalendarRepository.findDefaultShift();
  return (shift || fallback)?.weeklyOff ?? [0];
}

/**
 * Who decides first: the employee's team head when the company uses the head
 * step and the employee has one (their `manager` if that person is an active
 * head of the team, otherwise the first active head). A head — or anyone with
 * no head above them — goes straight to HR.
 */
async function firstApprover(employee, settings) {
  if (!settings.leaveHeadStep || !employee.team) return null;
  const heads = await userRepository.findTeamHeads([employee.team]);
  // A head has no head above them: their leave goes straight to HR.
  if (heads.some((h) => sameId(h._id, employee.user))) return null;
  if (!heads.length) return null;
  const preferred = heads.find((h) => sameId(h._id, employee.manager));
  return (preferred || [...heads].sort((a, b) => String(a._id).localeCompare(String(b._id)))[0])._id;
}

function validateInput(input) {
  const clientRequestId = String(input.clientRequestId ?? '');
  if (!CLIENT_ID_RE.test(clientRequestId)) throw fail('clientRequestId must be 8–64 letters, digits, - or _', 400);
  if (!isId(input.leaveType)) throw fail('Pick a leave type', 400);
  const { from, to } = input;
  if (!isValidDate(from) || !isValidDate(to)) throw fail('from and to must be real days, YYYY-MM-DD', 400);
  if (to < from) throw fail('The leave must end on or after the day it starts', 400);
  if (yearOf(from) !== yearOf(to)) throw fail('Leave across the new year needs two requests (one per year)', 400);
  if (daysBetween(from, to) + 1 > MAX_SPAN_DAYS) throw fail(`One request can cover at most ${MAX_SPAN_DAYS} days`, 400);
  for (const k of ['firstHalfOnly', 'secondHalfOnly']) {
    if (input[k] !== undefined && typeof input[k] !== 'boolean') throw fail(`${k} must be true or false`, 400);
  }
  const firstHalfOnly = input.firstHalfOnly === true;
  const secondHalfOnly = input.secondHalfOnly === true;
  if (from === to && firstHalfOnly && secondHalfOnly) throw fail('For a half day on one date, set only one of firstHalfOnly / secondHalfOnly', 400);
  const reason = String(input.reason ?? '').trim();
  if (reason.length > 1000) throw fail('Keep the reason under 1000 characters', 400);
  return {
    clientRequestId, leaveType: String(input.leaveType), from, to, firstHalfOnly, secondHalfOnly, reason,
  };
}

/**
 * Apply for leave for `employee` (their own, or — `onBehalf` — by HR/admin).
 * Returns { request, replay } — replay=true when this clientRequestId was
 * already used (the original request is returned unchanged).
 */
export async function applyLeave(actor, employee, input = {}, { onBehalf = false, req = null, now = new Date() } = {}) {
  const v = validateInput(input);
  const existing = await leaveRequestRepository.findByClientId(employee._id, v.clientRequestId);
  if (existing) return { request: shapeRequest(existing), replay: true };

  if (employee.status === 'exited') throw fail('Leave cannot be applied for someone who has left', 422);
  const type = await leaveTypeRepository.findById(v.leaveType);
  if (!type || !type.active) throw fail('That leave type is not available', 400);
  if ((v.firstHalfOnly || v.secondHalfOnly) && type.allowHalfDay === false) throw fail(`${type.name} can only be taken in full days`, 400);

  if (!onBehalf) {
    const today = istToday(now);
    const notice = type.minNoticeDays || 0;
    const earliest = notice === 0 ? addDays(today, -BACKDATE_DAYS) : addDays(today, notice);
    if (v.from < earliest) {
      throw fail(notice === 0
        ? `${type.name} can be applied for at most ${BACKDATE_DAYS} days after the day. Ask HR for older dates.`
        : `${type.name} needs ${notice} day${notice === 1 ? '' : 's'} notice — the earliest start is ${earliest}`, 422);
    }
  }

  const [weeklyOff, holidays, settings] = await Promise.all([
    weeklyOffFor(employee),
    holidayDatesInRange(v.from, v.to, employee.workSites),
    getHrSettings(),
  ]);
  const { halfDays, days } = countLeave({
    from: v.from, to: v.to, firstHalfOnly: v.firstHalfOnly, secondHalfOnly: v.secondHalfOnly, weeklyOff, holidays, sandwich: !!type.sandwich,
  });
  if (halfDays === 0) throw fail('Those dates are all weekly offs or holidays — no leave needed', 422);

  const approver = onBehalf ? null : await firstApprover(employee, settings);
  const year = yearOf(v.from);
  const number = `LV-${String(await counterRepository.next('leave_request')).padStart(4, '0')}`;

  try {
    const created = await inTransaction(async (session) => {
      await leaveLedgerRepository.lockEmployee(employee._id, session);
      // A parallel double submit that lost the lock race lands here on retry:
      // it must get the winner back (replay), not an "overlaps" 409.
      const twin = await leaveRequestRepository.findByClientId(employee._id, v.clientRequestId, session);
      if (twin) return { row: twin, replay: true };
      const clash = await leaveRequestRepository.findOverlapping(employee._id, v.from, v.to, {}, session);
      if (clash.length) {
        throw fail(`These dates overlap ${clash[0].number} (${clash[0].from} – ${clash[0].to}). Cancel that one first.`, 409);
      }
      if (!type.allowNegative) {
        const [balance, pending] = await Promise.all([
          leaveLedgerRepository.balance(employee._id, type._id, year, session),
          leaveRequestRepository.pendingHalfDays(employee._id, type._id, year, session),
        ]);
        if (balance - pending < halfDays) {
          throw fail(`Not enough ${type.name}: ${(balance - pending) / 2} day(s) available, ${halfDays / 2} asked`, 422);
        }
      }
      const row = await leaveRequestRepository.create({
        number,
        employee: employee._id,
        leaveType: type._id,
        from: v.from,
        to: v.to,
        firstHalfOnly: v.firstHalfOnly,
        secondHalfOnly: v.secondHalfOnly,
        halfDays,
        year,
        days,
        paid: type.paid !== false,
        reason: v.reason,
        clientRequestId: v.clientRequestId,
        status: approver ? 'pending_head' : 'pending_hr',
        approver,
        requestedBy: actor._id,
      }, session);
      await recordHrAudit({
        action: onBehalf ? 'leave.applied_on_behalf' : 'leave.applied', entity: 'LeaveRequest', entityId: row._id, subject: employee._id, actor, req, session,
        changes: [{ field: 'request', from: null, to: `${type.code} ${v.from}–${v.to} (${halfDays / 2} d)` }],
      });
      return { row, replay: false };
    });
    return { request: shapeRequest(created.row, { types: new Map([[String(type._id), type]]) }), replay: created.replay };
  } catch (err) {
    if (!isDup(err)) throw err;
    // A concurrent double submit with the same clientRequestId: return the winner.
    const winner = await leaveRequestRepository.findByClientId(employee._id, v.clientRequestId);
    if (!winner) throw err;
    return { request: shapeRequest(winner), replay: true };
  }
}

/**
 * Tell attendance which days changed so it can recompute AttendanceDay rows.
 * The attendance session owns that read model (docs/ADR-hr-system.md §2); until
 * its `recomputeDays(employeeId, from, to)` exists this is a no-op and
 * attendance reads leaveDaysInRange() on its own recompute. Best effort AFTER
 * the commit: AttendanceDay is recomputable, a failure here never undoes leave.
 */
export async function notifyAttendance(employeeId, from, to) {
  try {
    const mod = await import('../attendance/index.js');
    if (typeof mod.recomputeDays === 'function') await mod.recomputeDays(employeeId, from, to);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') {
      console.error(`[hr-leave] attendance recompute failed for ${employeeId} ${from}..${to}: ${err?.message}`);
    }
  }
}

/** Which step may `actor` decide on this request? null = they may not (→ 404). */
async function deciderStep(actor, request, employee) {
  if (request.status === 'pending_head') {
    if (isHrOrAdmin(actor) && (!sameId(employee.user, actor._id) || isAdminUser(actor))) return 'hr';
    if (sameId(employee.user, actor._id)) return null;
    if (isActiveStaffUser(actor) && actor.staff.isHead === true && employee.team && actor.staff.team === employee.team) return 'head';
    return null;
  }
  if (request.status === 'pending_hr') {
    if (!isHrOrAdmin(actor)) return null;
    if (sameId(employee.user, actor._id) && !isAdminUser(actor)) return 'self';
    return 'hr';
  }
  return null;
}

const lastDecisionIs = (r, actor, decision) => {
  const d = (r.decisions || [])[r.decisions.length - 1];
  return d && sameId(d.by, actor._id) && d.decision === decision;
};

/** Approve or reject at the caller's step. CAS on `rev`. */
export async function decideLeave(actor, requestId, { decision, note = '', rev } = {}, { req = null } = {}) {
  if (!isId(requestId)) throw notFound();
  if (!['approved', 'rejected'].includes(decision)) throw fail("decision must be 'approved' or 'rejected'", 400);
  if (!Number.isInteger(rev)) throw fail('rev is required', 400);
  const cleanNote = String(note ?? '').trim().slice(0, 500);
  if (decision === 'rejected' && cleanNote.length < 3) throw fail('Say why the leave is rejected', 400);

  const request = await leaveRequestRepository.findById(requestId);
  if (!request) throw notFound();
  const employee = await employeeRepository.findById(request.employee);
  if (!employee || !canAccessEmployee(actor, employee, 'leave')) throw notFound();

  // Already decided by this same person the same way (double click, retried call): no-op.
  if (!PENDING_STATUSES.includes(request.status) || request.rev !== rev) {
    if (lastDecisionIs(request, actor, decision)) return { request: shapeRequest(request), replay: true };
    throw fail(PENDING_STATUSES.includes(request.status)
      ? 'This request changed since you opened it. Reload and try again.'
      : `This request is already ${request.status.replace('_', ' ')}`, 409);
  }

  const step = await deciderStep(actor, request, employee);
  if (step === 'self') throw fail('Someone else in HR (or an admin) must decide your own leave', 403);
  if (!step) throw notFound();

  const decisionRow = {
    step, decision, by: actor._id, byName: String(actor.name || actor.email || '').slice(0, 120), at: new Date(), note: cleanNote,
  };
  const finalApprove = decision === 'approved' && step === 'hr';
  const nextStatus = decision === 'rejected' ? 'rejected' : (step === 'head' ? 'pending_hr' : 'approved');

  let updated;
  try {
    updated = await inTransaction(async (session) => {
      if (finalApprove) {
        await leaveLedgerRepository.lockEmployee(employee._id, session);
        const type = await leaveTypeRepository.findById(request.leaveType, session);
        const clash = await leaveRequestRepository.findOverlapping(
          employee._id, request.from, request.to, { statuses: ['approved'], excludeId: request._id }, session,
        );
        if (clash.length) throw fail(`These dates overlap approved leave ${clash[0].number}`, 409);
        if (!type?.allowNegative) {
          const balance = await leaveLedgerRepository.balance(employee._id, request.leaveType, request.year, session);
          if (balance < request.halfDays) {
            throw fail(`Not enough ${type?.name || 'leave'}: ${balance / 2} day(s) left, ${request.halfDays / 2} asked. Adjust the balance or reject.`, 422);
          }
        }
      }
      const row = await leaveRequestRepository.transition(
        request._id, { rev, fromStatus: request.status }, { status: nextStatus, approver: null }, { decisions: decisionRow }, session,
      );
      if (!row) return null; // lost the CAS: someone else decided first
      if (finalApprove) {
        await leaveLedgerRepository.append({
          employee: employee._id, leaveType: request.leaveType, year: request.year, deltaHalfDays: -request.halfDays, reason: 'use', key: `use:${request._id}`, request: request._id, by: actor._id, note: request.number,
        }, session);
      }
      await recordHrAudit({
        action: `leave.${step}_${decision}`, entity: 'LeaveRequest', entityId: request._id, subject: employee._id, actor, reason: cleanNote, req, session,
        changes: [{ field: 'status', from: request.status, to: nextStatus }],
      });
      return row;
    });
  } catch (err) {
    if (!isDup(err)) throw err;
    updated = null; // the 'use' row already exists: another approval won
  }

  if (!updated) {
    const now = await leaveRequestRepository.findById(request._id);
    if (now && lastDecisionIs(now, actor, decision)) return { request: shapeRequest(now), replay: true };
    throw fail('Someone else decided this request first. Reload to see it.', 409);
  }
  if (finalApprove) await notifyAttendance(employee._id, request.from, request.to);
  return { request: shapeRequest(updated), replay: false };
}

/**
 * Cancel. The employee may cancel their own pending request, or an approved one
 * that has not started yet; HR/admin may cancel any live request. Cancelling an
 * approved request restores the days (ledger `restore:<request>`).
 */
export async function cancelLeave(actor, requestId, { asHr = false, reason = '', req = null, now = new Date() } = {}) {
  if (!isId(requestId)) throw notFound();
  const request = await leaveRequestRepository.findById(requestId);
  if (!request) throw notFound();
  const employee = await employeeRepository.findById(request.employee);
  if (!employee) throw notFound();
  if (asHr ? !isHrOrAdmin(actor) : !sameId(employee.user, actor._id)) throw notFound();

  if (request.status === 'cancelled') return { request: shapeRequest(request), replay: true };
  if (!LIVE_STATUSES.includes(request.status)) throw fail(`This request is already ${request.status}`, 409);
  if (request.status === 'approved' && !asHr && request.from <= istToday(now)) {
    throw fail('This leave has already started. Ask HR to cancel it.', 422);
  }

  const wasApproved = request.status === 'approved';
  const why = String(reason ?? '').trim().slice(0, 500);
  let updated;
  try {
    updated = await inTransaction(async (session) => {
      if (wasApproved) await leaveLedgerRepository.lockEmployee(employee._id, session);
      const row = await leaveRequestRepository.transition(
        request._id, { rev: request.rev, fromStatus: request.status }, { status: 'cancelled', approver: null, cancelledAt: new Date() }, null, session,
      );
      if (!row) return null;
      if (wasApproved) {
        await leaveLedgerRepository.append({
          employee: employee._id, leaveType: request.leaveType, year: request.year, deltaHalfDays: request.halfDays, reason: 'restore', key: `restore:${request._id}`, request: request._id, by: actor._id, note: `${request.number} cancelled`,
        }, session);
      }
      await recordHrAudit({
        action: 'leave.cancelled', entity: 'LeaveRequest', entityId: request._id, subject: employee._id, actor, reason: why, req, session,
        changes: [{ field: 'status', from: request.status, to: 'cancelled' }],
      });
      return row;
    });
  } catch (err) {
    if (!isDup(err)) throw err;
    updated = null;
  }
  if (!updated) {
    const latest = await leaveRequestRepository.findById(request._id);
    if (latest?.status === 'cancelled') return { request: shapeRequest(latest), replay: true };
    throw fail('This request changed while you were cancelling it. Reload and try again.', 409);
  }
  if (wasApproved) await notifyAttendance(employee._id, request.from, request.to);
  return { request: shapeRequest(updated), replay: false };
}

async function page(query, sort, sortName, { cursor, limit }) {
  const lim = pageSize(limit);
  const ac = afterClause(sort, cursor ? decodeCursor(sortName, sort, cursor) : null);
  const rows = await leaveRequestRepository.page(ac ? { $and: [query, ac] } : query, { sort: sortSpec(sort), limit: lim + 1, select: LIST_SELECT });
  const hasMore = rows.length > lim;
  const items = hasMore ? rows.slice(0, lim) : rows;
  const maps = await lookups(items);
  return { items: items.map((r) => shapeRequest(r, maps)), nextCursor: hasMore ? encodeCursor(sortName, sort, items[items.length - 1]) : null };
}

/** One employee's requests, newest first. */
export const listEmployeeLeave = (employeeId, opts = {}) => page({ employee: employeeId }, NEWEST, 'newest', opts);

/**
 * The caller's decision inbox, oldest first. HR/admin: everything waiting for
 * HR. A team head: requests waiting for them. Anyone else: 403.
 */
export async function leaveInbox(actor, opts = {}) {
  if (isHrOrAdmin(actor)) return page({ status: 'pending_hr' }, OLDEST, 'oldest', opts);
  if (isActiveStaffUser(actor) && actor.staff.isHead === true) {
    return page({ approver: actor._id, status: 'pending_head' }, OLDEST, 'oldest', opts);
  }
  throw fail('Only team heads and HR have a leave inbox', 403);
}

/** One request, if the caller may see that employee's leave (else 404). */
export async function getLeaveRequest(actor, requestId) {
  if (!isId(requestId)) throw notFound();
  const request = await leaveRequestRepository.findById(requestId);
  if (!request) throw notFound();
  const employee = await employeeRepository.findById(request.employee);
  if (!employee || !canAccessEmployee(actor, employee, 'leave')) throw notFound();
  const maps = await lookups([request]);
  return { ...shapeRequest(request, maps), days: (request.days || []).map((d) => ({ date: d.date, halves: d.halves })) };
}

/**
 * Approved leave per date for payroll/attendance (docs/ADR-hr-system.md §4):
 * [{ date, halves (1|2), paid, leaveType, requestId }], sorted by date, from
 * the day snapshot taken at apply time.
 */
export async function leaveDaysInRange(employeeId, from, to) {
  if (!isValidDate(from) || !isValidDate(to) || to < from) throw fail('from/to must be YYYY-MM-DD with from ≤ to', 400);
  const rows = await leaveRequestRepository.findApprovedInRange([employeeId], from, to);
  const out = [];
  for (const r of rows) {
    for (const d of r.days || []) {
      if (d.date >= from && d.date <= to) {
        out.push({
          date: d.date, halves: d.halves, paid: r.paid !== false, leaveType: String(r.leaveType), requestId: String(r._id),
        });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Exported for tests that pin the head-chain rule.
export const _internal = { firstApprover, weeklyOffFor };
