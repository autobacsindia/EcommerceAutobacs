/**
 * Overtime approval (owner decision 2026-11-26): overtime is worked minutes
 * beyond the shift's `overtimeAfterMinutes`, and it is PAID only once HR or the
 * employee's team head approves it. Auto-closed days never have overtime.
 *
 *   GET  /hr/overtime/pending                       → the queue (oldest first, keyset)
 *   POST /hr/attendance/:dayId/overtime/decide      → { decision: approve|reject, minutes?, note?, overtimeMinutes? }
 *
 * Who decides: HR or an admin for anyone; an active team head for employees of
 * their own team. Nobody but an admin decides their OWN overtime. Everyone else
 * gets 404, the same as for a day that doesn't exist.
 *
 * Rules:
 *   - approve: 1 ≤ minutes ≤ the computed overtime (default: all of it)
 *   - reject:  approved minutes become 0
 *   - the same decision twice → the same row, one audit entry (`replay: true`)
 *   - a payroll-locked day → 409 (the lock is what payroll paid; change it in
 *     payroll's arrears, not here)
 *   - CAS on what the decider saw, inside a transaction with the audit row
 */
import mongoose from 'mongoose';
import attendanceDayRepository from '../../../repositories/hr/attendanceDayRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { isAdminUser, isHrOrAdmin, isActiveStaffUser } from '../../../middleware/hrAuth.js';
import { DATE_RE } from '../../../config/hr.js';
import {
  encodeCursor, decodeCursor, afterClause, sortSpec,
} from '../../../utils/listQuery.js';
import { recordHrAudit } from '../audit.js';
import { fail } from './errors.js';
import { withTx } from './tx.js';
import { shapeDay } from './dayService.js';

const PAGE_MAX = 50;
const TEAM_MAX = 2000; // employees of one team, for a head's filter
const SORT = Object.freeze({ field: 'date', dir: 1, type: 'string' });
const CURSOR = 'ot-pending';
const NOTE_MAX = 300;

/**
 * Phone push "overtime decided" lives in services/hr/notify (built by the app
 * session in parallel). Until that is merged the import fails with
 * ERR_MODULE_NOT_FOUND and no push is sent; the decision itself never depends
 * on it. notifyOvertimeDecided never throws and is idempotent on its key.
 */
let notifyPromise = null;
async function notifyModule() {
  if (!notifyPromise) {
    notifyPromise = import('../notify/index.js').catch((err) => {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') return null;
      notifyPromise = null;
      throw err;
    });
  }
  return notifyPromise;
}

async function notifyDecided(row) {
  try {
    const mod = await notifyModule();
    if (typeof mod?.notifyOvertimeDecided !== 'function') return;
    await mod.notifyOvertimeDecided({
      employeeId: String(row.employee),
      dayId: String(row._id),
      decisionId: String(new Date(row.overtimeDecidedAt).getTime()), // one per decision
      date: row.date,
      decision: row.overtimeStatus,
      approvedMinutes: row.overtimeApprovedMinutes || 0,
    });
  } catch (err) {
    // A push is a courtesy; the decision is already committed.
    console.warn('[hr-overtime] push notify failed', err?.message || err);
  }
}

/** The app sends decision 'approved'|'rejected' and approvedMinutes; accept both spellings. */
const DECISION_ALIASES = Object.freeze({ approved: 'approve', rejected: 'reject' });
function normaliseInput(input = {}) {
  return {
    ...input,
    decision: DECISION_ALIASES[input.decision] || input.decision,
    minutes: input.minutes ?? input.approvedMinutes,
  };
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const isActiveHead = (actor) => isActiveStaffUser(actor) && actor.staff.isHead === true && !!actor.staff.team;
const notFound = () => fail('Attendance day not found', 404);

/** May `actor` decide overtime for `employee` (lean EmployeeProfile)? Pure. */
export function canDecideOvertime(actor, employee) {
  if (!actor || !employee) return false;
  if (isAdminUser(actor)) return true;
  if (sameId(employee.user, actor._id)) return false; // never your own overtime
  if (isHrOrAdmin(actor)) return true;
  return isActiveHead(actor) && !!employee.team && employee.team === actor.staff.team;
}

/** The pending overtime queue. HR/admin: everyone (optional `team`); a head: own team only. */
export async function listPendingOvertime(actor, { cursor, limit, team } = {}) {
  const hr = isHrOrAdmin(actor);
  if (!hr && !isActiveHead(actor)) throw fail('Not found', 404);
  const lim = Math.min(Math.max(Number(limit) || 25, 1), PAGE_MAX);

  const filter = { overtimeStatus: 'pending' };
  const teamFilter = hr ? (team ? String(team) : null) : actor.staff.team;
  if (teamFilter) {
    const members = await employeeRepository.list({ team: teamFilter }, {
      select: '_id user', sort: { _id: 1 }, limit: TEAM_MAX,
    });
    const ids = members.filter((m) => isAdminUser(actor) || !sameId(m.user, actor._id)).map((m) => m._id);
    if (!ids.length) return { items: [], nextCursor: null };
    filter.employee = { $in: ids };
  } else if (!isAdminUser(actor)) {
    const self = await employeeRepository.findByUser(actor._id);
    if (self) filter.employee = { $ne: self._id };
  }

  const after = cursor ? decodeCursor(CURSOR, SORT, cursor) : null;
  if (cursor && !after) throw fail('Bad cursor', 400);
  const ac = afterClause(SORT, after);
  const rows = await attendanceDayRepository.listOvertime(ac ? { $and: [filter, ac] } : filter, { sort: sortSpec(SORT), limit: lim + 1 });
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;

  const empIds = [...new Set(page.map((r) => String(r.employee)))];
  const emps = empIds.length ? await employeeRepository.list({ _id: { $in: empIds } }, {
    select: 'name employeeCode team designation', sort: { _id: 1 }, limit: empIds.length,
  }) : [];
  const byId = new Map(emps.map((e) => [String(e._id), e]));
  return {
    items: page.map((r) => {
      const e = byId.get(String(r.employee));
      return {
        id: String(r._id),
        employee: e ? {
          id: String(e._id), name: e.name, employeeCode: e.employeeCode || '', team: e.team || '', designation: e.designation || '',
        } : { id: String(r.employee) },
        day: shapeDay(r),
      };
    }),
    nextCursor: hasMore ? encodeCursor(CURSOR, SORT, page[page.length - 1]) : null,
  };
}

/** The approval state a decision asks for, validated against the day. */
function targetOf(day, { decision, minutes }) {
  if (!['approve', 'reject'].includes(decision)) throw fail('decision must be approve or reject', 400);
  if (day.autoClosed || !(day.overtimeMinutes > 0)) {
    throw fail('There is no overtime to decide on this day (auto-closed hours are never overtime).', 409);
  }
  if (decision === 'reject') return { overtimeStatus: 'rejected', overtimeApprovedMinutes: 0 };
  const m = minutes === undefined || minutes === null || minutes === '' ? day.overtimeMinutes : Number(minutes);
  if (!Number.isInteger(m) || m < 1) throw fail('minutes must be a whole number of minutes, at least 1 (reject instead)', 400);
  if (m > day.overtimeMinutes) throw fail(`At most ${day.overtimeMinutes} minutes of overtime were worked that day`, 400);
  return { overtimeStatus: 'approved', overtimeApprovedMinutes: m };
}

const alreadyThere = (day, target) => day.overtimeStatus === target.overtimeStatus
  && (day.overtimeApprovedMinutes || 0) === target.overtimeApprovedMinutes
  && (day.overtimeDecidedOn || 0) === day.overtimeMinutes;

class LostRace extends Error {}

/**
 * The one routine that decides overtime on a day row (both the queue route and
 * the older per-employee HR route call it). `day` is the lean row as read.
 */
async function applyDecision(actor, day, employee, input, req) {
  if (!canDecideOvertime(actor, employee)) throw notFound();
  if (day.payrollLocked) throw fail('Payroll for this month is locked. Overtime on this day can no longer change here.', 409);
  if (input.overtimeMinutes !== undefined && Number(input.overtimeMinutes) !== day.overtimeMinutes) {
    throw fail('The hours for this day changed. Reload and try again.', 409);
  }
  const target = targetOf(day, input);
  if (alreadyThere(day, target)) return { day: shapeDay(day), replay: true };

  const note = String(input.note || '').slice(0, NOTE_MAX);
  const now = new Date();
  let out;
  try {
    out = await withTx(async (session) => {
      const row = await attendanceDayRepository.decideOvertime(day._id, day, {
        ...target,
        overtimeApprovedBy: target.overtimeStatus === 'approved' ? actor._id : null,
        overtimeDecidedOn: day.overtimeMinutes,
        overtimeDecidedBy: actor._id,
        overtimeDecidedAt: now,
        overtimeNote: note,
      }, session);
      if (!row) throw new LostRace();
      await recordHrAudit({
        action: `overtime.${target.overtimeStatus}`,
        entity: 'AttendanceDay',
        entityId: row._id,
        subject: employee._id,
        actor,
        req,
        session,
        reason: note,
        changes: [
          { field: `overtimeStatus.${day.date}`, from: day.overtimeStatus || 'none', to: target.overtimeStatus },
          { field: `overtimeApprovedMinutes.${day.date}`, from: day.overtimeApprovedMinutes || 0, to: target.overtimeApprovedMinutes },
        ],
      });
      return { row, replay: false };
    });
  } catch (err) {
    if (!(err instanceof LostRace)) throw err;
    // Someone got there first. If they decided the same thing (a double tap,
    // two heads at once), that IS our answer; anything else is a real conflict.
    const now2 = await attendanceDayRepository.findById(day._id);
    if (now2 && alreadyThere(now2, target)) return { day: shapeDay(now2), replay: true };
    if (now2?.payrollLocked) throw fail('Payroll for this month is locked. Overtime on this day can no longer change here.', 409);
    throw fail('This day changed while you were deciding. Reload and try again.', 409);
  }
  await notifyDecided(out.row); // after commit; a replay never re-sends
  return { day: shapeDay(out.row), replay: false };
}

/** POST /hr/attendance/:dayId/overtime/decide */
export async function decideOvertime(actor, dayId, input = {}, req = null) {
  if (!mongoose.isValidObjectId(dayId)) throw notFound();
  const day = await attendanceDayRepository.findById(dayId);
  if (!day) throw notFound();
  const employee = await employeeRepository.findById(day.employee);
  if (!employee) throw notFound();
  return applyDecision(actor, day, employee, normaliseInput(input), req);
}

/**
 * The older HR route (POST /employees/:id/attendance/:date/overtime
 * { approvedMinutes, overtimeMinutes? }) — same rules, same routine.
 * approvedMinutes 0 = reject.
 */
export async function approveOvertimeForDate(actor, employee, date, { approvedMinutes, overtimeMinutes } = {}, req = null) {
  if (!DATE_RE.test(String(date))) throw fail('date must look like 2026-12-03', 400);
  const minutes = Number(approvedMinutes);
  if (!Number.isInteger(minutes) || minutes < 0) throw fail('approvedMinutes must be a whole number of minutes', 400);
  const day = await attendanceDayRepository.find(employee._id, date);
  if (!day) throw fail('No attendance on that day', 404);
  const out = await applyDecision(actor, day, employee, {
    decision: minutes > 0 ? 'approve' : 'reject', minutes, overtimeMinutes,
  }, req);
  return out.day;
}
