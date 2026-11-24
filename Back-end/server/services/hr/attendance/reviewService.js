/**
 * HR's review inbox (punches stored as pending_review: failed face with a
 * photo, offline punch too late, impossible location jump) and overtime
 * approval. Every decision is CAS + transaction + audit.
 */
import mongoose from 'mongoose';
import attendancePunchRepository from '../../../repositories/hr/attendancePunchRepository.js';
import attendanceDayRepository from '../../../repositories/hr/attendanceDayRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import {
  encodeCursor, decodeCursor, afterClause, sortSpec,
} from '../../../utils/listQuery.js';
import { DATE_RE } from '../../../config/hr.js';
import { recordHrAudit } from '../audit.js';
import { photoUrlForPunch } from '../face/reviewPhotos.js';
import { fail } from './errors.js';
import { withTx } from './tx.js';
import { recomputeDay, shapeDay } from './dayService.js';
import { shapePunch } from './punchService.js';

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
 * HR approves overtime for one day: 0 ≤ approvedMinutes ≤ the computed overtime.
 * `overtimeMinutes` (what HR saw) is optional CAS: if the hours changed since,
 * the approval is refused (409) rather than approving a different figure.
 */
export async function approveOvertime(actor, employeeId, date, { approvedMinutes, overtimeMinutes } = {}, req = null) {
  if (!DATE_RE.test(String(date))) throw fail('date must look like 2026-12-03', 400);
  const minutes = Number(approvedMinutes);
  if (!Number.isInteger(minutes) || minutes < 0) throw fail('approvedMinutes must be a whole number of minutes', 400);
  const day = await attendanceDayRepository.find(employeeId, date);
  if (!day) throw fail('No attendance on that day', 404);
  if (overtimeMinutes !== undefined && Number(overtimeMinutes) !== day.overtimeMinutes) {
    throw fail('The hours for this day changed. Reload and try again.', 409);
  }
  if (day.autoClosed) throw fail('This day was closed automatically; auto-closed hours are never overtime.', 409);
  if (minutes > day.overtimeMinutes) throw fail(`At most ${day.overtimeMinutes} minutes of overtime were worked that day`, 400);
  return withTx(async (session) => {
    const set = { overtimeApprovedMinutes: minutes, overtimeApprovedBy: actor._id };
    if (day.payrollLocked && minutes !== day.overtimeApprovedMinutes) set.changedAfterLock = true;
    const row = await attendanceDayRepository.setOvertimeApproved(employeeId, date, day.overtimeMinutes, set, session);
    if (!row) throw fail('The hours for this day changed. Reload and try again.', 409);
    await recordHrAudit({
      action: 'overtime.approved', entity: 'AttendanceDay', entityId: row._id, subject: employeeId, actor, req, session,
      changes: [{ field: `overtimeApprovedMinutes.${date}`, from: day.overtimeApprovedMinutes || 0, to: minutes }],
    });
    return shapeDay(row);
  });
}
