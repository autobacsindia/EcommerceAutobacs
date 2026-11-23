import mongoose from 'mongoose';
import { LEAVE_ACCRUALS } from '../../config/hr.js';

/**
 * A kind of leave: Casual 8/yr, Sick 6/yr, Earned 12/yr (carry forward ≤ 30)…
 * Quotas are in HALF-DAYS (16 = 8 days). `paid: false` (LOP) costs a day of pay.
 * Deactivated, never deleted: requests and ledger rows reference it.
 */
const LeaveTypeSchema = new mongoose.Schema({
  code: { type: String, required: true, uppercase: true, trim: true, maxlength: 10 },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  paid: { type: Boolean, default: true },
  annualQuotaHalfDays: { type: Number, default: 0, min: 0, max: 730 },
  accrual: { type: String, enum: LEAVE_ACCRUALS, default: 'yearly_upfront' },
  carryForwardMaxHalfDays: { type: Number, default: 0, min: 0, max: 730 },
  encashable: { type: Boolean, default: false },
  allowHalfDay: { type: Boolean, default: true },
  minNoticeDays: { type: Number, default: 0, min: 0, max: 90 },
  // A weekend/holiday between two leave days counts as leave too.
  sandwich: { type: Boolean, default: false },
  // Ask for a document (e.g. medical note) above this many days (0 = never).
  documentAfterDays: { type: Number, default: 0, min: 0, max: 60 },
  // Can go below zero (unpaid leave can; paid types normally can't).
  allowNegative: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rev: { type: Number, default: 0 },
}, { timestamps: true });

LeaveTypeSchema.index({ code: 1 }, { name: 'hr_leave_type_code_unique', unique: true });
LeaveTypeSchema.index({ active: 1, name: 1 }, { name: 'hr_leave_type_active_name' });

export default mongoose.models.LeaveType || mongoose.model('LeaveType', LeaveTypeSchema);
