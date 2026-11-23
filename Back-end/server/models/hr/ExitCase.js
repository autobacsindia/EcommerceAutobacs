import mongoose from 'mongoose';
import { EXIT_STATUSES, EXIT_TYPES, DATE_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Someone is leaving: resignation (or termination…) → accepted with a last day →
 * settled (final settlement payslip paid). On acceptance the service also
 * records the existing StaffDeparture (handover) for staff with a login, so the
 * team panel's handover flow keeps working unchanged. On the last day: face
 * template erased, devices revoked, staff access removed by the existing
 * staffService path.
 */
const ExitCaseSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  type: { type: String, enum: EXIT_TYPES, default: 'resignation' },
  status: { type: String, enum: EXIT_STATUSES, default: 'requested', required: true },
  resignedOn: { type: String, required: true, match: DATE_RE },
  noticeDays: { type: Number, default: 30, min: 0, max: 180 },
  lastDay: { type: String, default: null, match: DATE_RE },
  reason: { type: String, default: '', maxlength: 1000 }, // private: HR/admin only
  assets: {
    type: [new mongoose.Schema({
      label: { type: String, required: true, maxlength: 80 },
      returned: { type: Boolean, default: false },
    }, { _id: false })],
    default: [],
  },
  departure: { type: ObjectId, ref: 'StaffDeparture', default: null },
  settlementPayslip: { type: ObjectId, ref: 'Payslip', default: null },
  // Only one open case per employee (unset when closed so a rehire can leave again).
  open: { type: Boolean, default: true },
  createdBy: { type: ObjectId, ref: 'User', required: true },
  rev: { type: Number, default: 0 },
}, { timestamps: true });

ExitCaseSchema.index(
  { employee: 1 },
  { name: 'hr_exit_one_open', unique: true, partialFilterExpression: { open: true } },
);
ExitCaseSchema.index({ status: 1, lastDay: 1 }, { name: 'hr_exit_status_lastday' });

export default mongoose.models.ExitCase || mongoose.model('ExitCase', ExitCaseSchema);
