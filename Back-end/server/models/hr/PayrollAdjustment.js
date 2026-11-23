import mongoose from 'mongoose';
import { PAYROLL_ADJUSTMENT_KINDS, MONTH_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * A one-off line for one employee in one month: bonus, arrears, advance recovery,
 * leave encashment… Amounts in PAISE, always positive; `kind` says earning or
 * deduction. A reason is required. Cancelled (not deleted) while the month is
 * draft; frozen after it locks. Arrears from attendance changed after lock are
 * created here by the payroll service with `system: true`.
 */
const PayrollAdjustmentSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  month: { type: String, required: true, match: MONTH_RE },
  kind: { type: String, enum: PAYROLL_ADJUSTMENT_KINDS, required: true },
  amountPaise: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  system: { type: Boolean, default: false },
  // Idempotency for system-created rows (e.g. 'arrears:<employee>:<fromMonth>').
  key: { type: String, default: undefined, maxlength: 160 },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: ObjectId, ref: 'User', default: null },
  createdBy: { type: ObjectId, ref: 'User', default: null },
}, { timestamps: true });

PayrollAdjustmentSchema.index({ month: 1, employee: 1 }, { name: 'hr_adjustment_month_employee' });
PayrollAdjustmentSchema.index(
  { key: 1 },
  { name: 'hr_adjustment_key_unique', unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);

export default mongoose.models.PayrollAdjustment || mongoose.model('PayrollAdjustment', PayrollAdjustmentSchema);
