/**
 * Attendance corrections ("I forgot to clock out on 3 Dec, I left at 19:10").
 * The employee asks (idempotent on clientRequestId); HR decides with CAS on
 * `rev`. Approval writes a `source: 'correction'` punch, recomputes the day and
 * audit-logs it — all in one transaction.
 */
import mongoose from 'mongoose';
import attendanceCorrectionRepository from '../../../repositories/hr/attendanceCorrectionRepository.js';
import attendancePunchRepository from '../../../repositories/hr/attendancePunchRepository.js';
import attendanceDayRepository from '../../../repositories/hr/attendanceDayRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { PUNCH_TYPES, DATE_RE, CORRECTION_STATUSES } from '../../../config/hr.js';
import {
  encodeCursor, decodeCursor, afterClause, sortSpec,
} from '../../../utils/listQuery.js';
import { recordHrAudit } from '../audit.js';
import { fail } from './errors.js';
import { withTx, isDuplicateKey } from './tx.js';
import { isValidSequence } from './dayRules.js';
import { recomputeDay, shapeDay } from './dayService.js';
import {
  istDate, istInstant, addDays, DAY_MS, monthOf,
} from './time.js';

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_AGE_DAYS = 62;
const PAGE_MAX = 50;
const LIST_SORT = Object.freeze({ field: 'createdAt', dir: -1, type: 'date' });

export const shapeCorrection = (c) => ({
  id: String(c._id),
  employee: String(c.employee),
  date: c.date,
  punchType: c.punchType,
  at: c.at,
  reason: c.reason,
  status: c.status,
  decidedBy: c.decidedBy ? String(c.decidedBy) : null,
  decidedAt: c.decidedAt || null,
  decisionNote: c.decisionNote || '',
  punch: c.punch ? String(c.punch) : null,
  rev: c.rev || 0,
  createdAt: c.createdAt,
});

export async function createCorrection(employee, actor, body = {}, req = null) {
  const clientRequestId = String(body.clientRequestId ?? '');
  if (!CLIENT_ID_RE.test(clientRequestId)) throw fail('clientRequestId must be 8–64 letters, digits, - or _', 400);
  const existing = await attendanceCorrectionRepository.findByClientId(employee._id, clientRequestId);
  if (existing) return { correction: shapeCorrection(existing), replay: true };

  const { date, punchType } = body;
  if (!DATE_RE.test(String(date))) throw fail('date must look like 2026-12-03', 400);
  if (!PUNCH_TYPES.includes(punchType)) throw fail('punchType must be in, out, break_start or break_end', 400);
  const at = new Date(body.at);
  if (!body.at || Number.isNaN(at.getTime())) throw fail('at (the time) is required', 400);
  const today = istDate(new Date());
  if (date > today) throw fail("You can't correct a day that hasn't happened yet", 400);
  if (date < addDays(today, -MAX_AGE_DAYS)) throw fail(`Corrections are possible for the last ${MAX_AGE_DAYS} days only`, 400);
  // The time must fall on that workday (or the early hours after it, for an overnight shift).
  const dayStart = istInstant(date, '00:00');
  if (at < dayStart || at >= new Date(dayStart.getTime() + 2 * DAY_MS) || at > new Date()) {
    throw fail('That time is not on the day you picked', 400);
  }
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 3) throw fail('Please say what happened (a reason)', 400);

  try {
    const row = await attendanceCorrectionRepository.create({
      employee: employee._id, date, punchType, at, reason: reason.slice(0, 500), clientRequestId, requestedBy: actor._id,
    });
    await recordHrAudit({
      action: 'correction.requested', entity: 'AttendanceCorrection', entityId: row._id, subject: employee._id, actor, req,
      changes: [{ field: punchType, from: null, to: at.toISOString() }],
    });
    return { correction: shapeCorrection(row), replay: false };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const again = await attendanceCorrectionRepository.findByClientId(employee._id, clientRequestId);
    return { correction: shapeCorrection(again), replay: true };
  }
}

async function page(filter, { cursor, limit }) {
  const lim = Math.min(Math.max(Number(limit) || 25, 1), PAGE_MAX);
  const after = cursor ? decodeCursor('created', LIST_SORT, cursor) : null;
  const ac = afterClause(LIST_SORT, after);
  const rows = await attendanceCorrectionRepository.list(ac ? { $and: [filter, ac] } : filter, { sort: sortSpec(LIST_SORT), limit: lim + 1 });
  const hasMore = rows.length > lim;
  const items = hasMore ? rows.slice(0, lim) : rows;
  return { items: items.map(shapeCorrection), nextCursor: hasMore ? encodeCursor('created', LIST_SORT, items[items.length - 1]) : null };
}

export function listCorrections({ status = 'pending', cursor, limit } = {}) {
  if (!CORRECTION_STATUSES.includes(status)) throw fail('Unknown status', 400);
  return page({ status }, { cursor, limit });
}

export const listMyCorrections = (employee, { cursor, limit } = {}) => page({ employee: employee._id }, { cursor, limit });

export async function cancelMyCorrection(employee, actor, id, req = null) {
  if (!mongoose.isValidObjectId(id)) throw fail('Correction not found', 404);
  const c = await attendanceCorrectionRepository.findById(id);
  if (!c || String(c.employee) !== String(employee._id)) throw fail('Correction not found', 404);
  if (c.status === 'cancelled') return shapeCorrection(c);
  if (c.status !== 'pending') throw fail('This correction was already decided', 409);
  const row = await attendanceCorrectionRepository.decideIfRev(id, c.rev, { status: 'cancelled', decidedAt: new Date() });
  if (!row) throw fail('This correction changed meanwhile. Reload and try again.', 409);
  await recordHrAudit({
    action: 'correction.cancelled', entity: 'AttendanceCorrection', entityId: row._id, subject: employee._id, actor, req,
    changes: [{ field: 'status', from: 'pending', to: 'cancelled' }],
  });
  return shapeCorrection(row);
}

/** HR decides: { decision: 'approve'|'reject', note, rev }. */
export async function decideCorrection(actor, id, { decision, note = '', rev } = {}, req = null) {
  if (!mongoose.isValidObjectId(id)) throw fail('Correction not found', 404);
  if (!['approve', 'reject'].includes(decision)) throw fail('decision must be approve or reject', 400);
  if (rev === undefined || rev === null || !Number.isInteger(Number(rev))) throw fail('rev is required', 400);
  const c = await attendanceCorrectionRepository.findById(id);
  if (!c) throw fail('Correction not found', 404);
  if (c.status !== 'pending') throw fail('This correction was already decided', 409);
  const employee = await employeeRepository.findById(c.employee);
  if (!employee) throw fail('Correction not found', 404);
  const decisionNote = String(note || '').slice(0, 500);
  const now = new Date();

  const result = await withTx(async (session) => {
    let punchId = null;
    let day = null;
    if (decision === 'approve') {
      await attendanceDayRepository.touch(employee._id, c.date, monthOf(c.date), session);
      const dayPunches = await attendancePunchRepository.listForDay(employee._id, c.date, session);
      const next = [...dayPunches, { type: c.punchType, at: c.at }].sort((a, b) => new Date(a.at) - new Date(b.at));
      if (!isValidSequence(next)) {
        throw fail("This correction doesn't fit the day's other punches. Reject it, or fix the day first.", 409);
      }
      const p = await attendancePunchRepository.create({
        employee: employee._id,
        user: employee.user || null,
        clientPunchId: `corr-${c._id}`,
        type: c.punchType,
        at: c.at,
        receivedAt: now,
        date: c.date,
        source: 'correction',
        status: 'accepted',
        reviewNote: decisionNote,
        createdBy: actor._id,
      }, session);
      punchId = p._id;
    }
    const row = await attendanceCorrectionRepository.decideIfRev(id, Number(rev), {
      status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: actor._id, decidedAt: now, decisionNote, punch: punchId,
    }, session);
    if (!row) throw fail('This correction was changed by someone else. Reload and try again.', 409);
    if (decision === 'approve') day = await recomputeDay(employee, c.date, { session, now });
    await recordHrAudit({
      action: `correction.${decision === 'approve' ? 'approved' : 'rejected'}`, entity: 'AttendanceCorrection', entityId: row._id,
      subject: employee._id, actor, req, session, reason: decisionNote,
      changes: [{ field: 'status', from: 'pending', to: row.status }],
    });
    return { correction: shapeCorrection(row), day: shapeDay(day) };
  });
  return result;
}
