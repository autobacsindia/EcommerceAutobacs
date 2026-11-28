/**
 * HR's review inbox (punches stored as pending_review: failed face with a
 * photo, offline punch too late, impossible location jump) and the per-day
 * HR overtime route. Every decision is CAS + transaction + audit.
 */
import mongoose from 'mongoose';
import attendancePunchRepository from '../../../repositories/hr/attendancePunchRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import {
  encodeCursor, decodeCursor, afterClause, sortSpec,
} from '../../../utils/listQuery.js';
import { recordHrAudit } from '../audit.js';
import { photoUrlForPunch } from '../face/reviewPhotos.js';
import { fail } from './errors.js';
import { withTx } from './tx.js';
import { recomputeDay, shapeDay } from './dayService.js';
import { shapePunch } from './punchService.js';
import { approveOvertimeForDate } from './overtimeService.js';

const PAGE_MAX = 50;
const SORT = Object.freeze({ field: 'receivedAt', dir: -1, type: 'date' });

export async function listReviewPunches({ cursor, limit } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 25, 1), PAGE_MAX);
  const filter = { status: 'pending_review' };
  const ac = afterClause(SORT, cursor ? decodeCursor('received', SORT, cursor) : null);
  const rows = await attendancePunchRepository.listByStatus(ac ? { $and: [filter, ac] } : filter, { sort: sortSpec(SORT), limit: lim + 1 });
  const hasMore = rows.length > lim;
  const items = hasMore ? rows.slice(0, lim) : rows;
  return {
    items: items.map((p) => ({ ...shapePunch(p, { withLocation: true }), deviceId: p.deviceId || '', reasons: (p.reviewNote || '').split(',').filter(Boolean) })),
    nextCursor: hasMore ? encodeCursor('received', SORT, items[items.length - 1]) : null,
  };
}

export async function reviewPhotoUrl(punchId) {
  if (!mongoose.isValidObjectId(punchId)) throw fail('No photo for this punch', 404);
  const out = await photoUrlForPunch(punchId);
  if (!out) throw fail('No photo for this punch', 404);
  return out;
}

/** { decision: 'accept'|'reject', note } on a pending_review punch. */
export async function decidePunch(actor, punchId, { decision, note = '' } = {}, req = null) {
  if (!mongoose.isValidObjectId(punchId)) throw fail('Punch not found', 404);
  if (!['accept', 'reject'].includes(decision)) throw fail('decision must be accept or reject', 400);
  const p = await attendancePunchRepository.findById(punchId);
  if (!p) throw fail('Punch not found', 404);
  if (p.status !== 'pending_review') throw fail('This punch was already decided', 409);
  const employee = await employeeRepository.findById(p.employee);
  if (!employee) throw fail('Punch not found', 404);
  const status = decision === 'accept' ? 'accepted' : 'rejected';
  const now = new Date();
  return withTx(async (session) => {
    const row = await attendancePunchRepository.decide(punchId, 'pending_review', {
      status, reviewedBy: actor._id, reviewedAt: now, reviewNote: [p.reviewNote, String(note || '').slice(0, 300)].filter(Boolean).join(' | ').slice(0, 500),
    }, session);
    if (!row) throw fail('This punch was already decided', 409);
    const day = await recomputeDay(employee, p.date, { session, now });
    await recordHrAudit({
      action: `punch.${status}`, entity: 'AttendancePunch', entityId: row._id, subject: employee._id, actor, req, session,
      reason: String(note || ''), changes: [{ field: 'status', from: 'pending_review', to: status }],
    });
    return { punch: shapePunch(row), day: shapeDay(day) };
  });
}

/**
 * HR approves overtime for one day: 0 ≤ approvedMinutes ≤ the computed overtime
 * (0 = reject). `overtimeMinutes` (what HR saw) is optional CAS. Same rules and
 * the same routine as the approval queue (overtimeService.js).
 */
export async function approveOvertime(actor, employeeId, date, body = {}, req = null) {
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw fail('Employee not found', 404);
  return approveOvertimeForDate(actor, employee, date, body, req);
}
