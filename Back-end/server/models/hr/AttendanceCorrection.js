import mongoose from 'mongoose';
import { CORRECTION_STATUSES, PUNCH_TYPES, DATE_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * "I forgot to clock out on 3 Dec, I left at 19:10." Raised by the employee
 * (or HR), decided by HR. Approval writes a `source: 'correction'` punch and
 * recomputes the day; the decision is audit-logged.
 */
const AttendanceCorrectionSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  date: { type: String, required: true, match: DATE_RE },
  punchType: { type: String, enum: PUNCH_TYPES, required: true },
  at: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  // Idempotency for the app's "Send" button.
  clientRequestId: { type: String, required: true, maxlength: 64 },
  status: { type: String, enum: CORRECTION_STATUSES, default: 'pending', required: true },
  requestedBy: { type: ObjectId, ref: 'User', required: true },
  decidedBy: { type: ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: '', maxlength: 500 },
  punch: { type: ObjectId, ref: 'AttendancePunch', default: null }, // written on approval
  rev: { type: Number, default: 0 },
}, { timestamps: true });

AttendanceCorrectionSchema.index({ employee: 1, clientRequestId: 1 }, { name: 'hr_correction_idempotency', unique: true });
AttendanceCorrectionSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'hr_correction_status_created' });
AttendanceCorrectionSchema.index({ employee: 1, createdAt: -1, _id: -1 }, { name: 'hr_correction_employee_created' });

export default mongoose.models.AttendanceCorrection || mongoose.model('AttendanceCorrection', AttendanceCorrectionSchema);
