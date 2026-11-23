import mongoose from 'mongoose';
import { LEAVE_LEDGER_REASONS } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Append-only leave balance ledger. Balance = sum of `deltaHalfDays` for
 * (employee, leaveType, year). There is no stored balance counter to drift.
 *
 *   grant +16 (yearly), use −4 (approved request), restore +4 (cancelled after
 *   approval), adjust ±n (HR, reason required), carry_forward, lapse, encash.
 *
 * `key` makes automatic rows idempotent: the yearly grant for one person/type/year,
 * the 'use' row for one request, etc. A retried job or a double-clicked Approve
 * hits the unique index instead of double-counting.
 */
const LeaveLedgerEntrySchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  leaveType: { type: ObjectId, ref: 'LeaveType', required: true },
  year: { type: Number, required: true, min: 2020, max: 2100 },
  deltaHalfDays: { type: Number, required: true },
  reason: { type: String, enum: LEAVE_LEDGER_REASONS, required: true },
  key: { type: String, required: true, maxlength: 160 },
  request: { type: ObjectId, ref: 'LeaveRequest', default: null },
  note: { type: String, default: '', maxlength: 500 },
  by: { type: ObjectId, ref: 'User', default: null }, // null = system
}, { timestamps: { createdAt: true, updatedAt: false } });

LeaveLedgerEntrySchema.index({ key: 1 }, { name: 'hr_leave_ledger_key_unique', unique: true });
LeaveLedgerEntrySchema.index({ employee: 1, year: 1, leaveType: 1 }, { name: 'hr_leave_ledger_employee_year_type' });

const appendOnly = function appendOnly(next) { next(new Error('LeaveLedgerEntry is append-only')); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  LeaveLedgerEntrySchema.pre(op, appendOnly);
}

export default mongoose.models.LeaveLedgerEntry || mongoose.model('LeaveLedgerEntry', LeaveLedgerEntrySchema);
