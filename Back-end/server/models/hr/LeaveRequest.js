import mongoose from 'mongoose';
import { LEAVE_STATUSES, DATE_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * A leave request: apply → team head → HR → approved (or rejected/cancelled).
 * `halfDays` is SERVER-computed from the dates, half-day flags, weekly offs,
 * holidays and the type's sandwich rule; the client's count is never used.
 * Approval writes the ledger 'use' row and the affected AttendanceDay rows in one
 * transaction. `rev` guards concurrent decisions (CAS).
 */
const DecisionSchema = new mongoose.Schema({
  step: { type: String, enum: ['head', 'hr'], required: true },
  decision: { type: String, enum: ['approved', 'rejected'], required: true },
  by: { type: ObjectId, ref: 'User', required: true },
  byName: { type: String, default: '', maxlength: 120 },
  at: { type: Date, required: true },
  note: { type: String, default: '', maxlength: 500 },
}, { _id: false });

const LeaveRequestSchema = new mongoose.Schema({
  // LV-0001 … from the 'leave_request' counter.
  number: { type: String, required: true },
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  leaveType: { type: ObjectId, ref: 'LeaveType', required: true },
  from: { type: String, required: true, match: DATE_RE },
  to: { type: String, required: true, match: DATE_RE },
  firstHalfOnly: { type: Boolean, default: false }, // `from` is a half day
  secondHalfOnly: { type: Boolean, default: false }, // `to` is a half day
  halfDays: { type: Number, required: true, min: 1 },
  // Calendar year the request is charged to (from/to never cross a year).
  year: { type: Number, required: true, min: 2020, max: 2100 },
  // SNAPSHOT of the charged days at apply time (≤ 62 rows): a holiday or shift
  // edited later never changes what an approved request cost. Payroll and
  // attendance read these through services/hr/leave leaveDaysInRange().
  days: {
    type: [new mongoose.Schema({
      date: { type: String, required: true, match: DATE_RE },
      halves: { type: Number, required: true, enum: [1, 2] },
    }, { _id: false })],
    default: [],
  },
  paid: { type: Boolean, required: true }, // snapshot of LeaveType.paid
  reason: { type: String, default: '', maxlength: 1000 },
  documentKey: { type: String, default: '', maxlength: 400 }, // private bucket
  clientRequestId: { type: String, required: true, maxlength: 64 },
  status: { type: String, enum: LEAVE_STATUSES, required: true },
  // Who must act next (team head, or null when it sits with HR).
  approver: { type: ObjectId, ref: 'User', default: null },
  decisions: { type: [DecisionSchema], default: [] }, // ≤ 2 entries
  requestedBy: { type: ObjectId, ref: 'User', required: true }, // HR may apply on someone's behalf
  cancelledAt: { type: Date, default: null },
  rev: { type: Number, default: 0 },
}, { timestamps: true });

LeaveRequestSchema.index({ number: 1 }, { name: 'hr_leave_number_unique', unique: true });
LeaveRequestSchema.index({ employee: 1, clientRequestId: 1 }, { name: 'hr_leave_idempotency', unique: true });
LeaveRequestSchema.index({ employee: 1, createdAt: -1, _id: -1 }, { name: 'hr_leave_employee_created' });
LeaveRequestSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'hr_leave_status_created' });
LeaveRequestSchema.index({ approver: 1, status: 1, createdAt: -1 }, { name: 'hr_leave_approver_status' });
// Overlap check: same employee, live requests whose range touches the new one.
LeaveRequestSchema.index({ employee: 1, from: 1, to: 1 }, { name: 'hr_leave_employee_range' });

export default mongoose.models.LeaveRequest || mongoose.model('LeaveRequest', LeaveRequestSchema);
