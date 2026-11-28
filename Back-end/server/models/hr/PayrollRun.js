import mongoose from 'mongoose';
import { PAYROLL_RUN_STATUSES, PAYROLL_HISTORY_ACTIONS, MONTH_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One payroll month. draft (HR prepares / recomputes) → locked (HR) → approved
 * (admin only) → payouts created (one PaymentRequest per employee, through the
 * existing approve-and-pay flow). Mirrors IncentiveMonth's lock/approve shape.
 *
 * Once approved the run and its payslips are FROZEN financial records, like
 * orders. Changing anything needs an admin "re-open" with a reason (history row
 * + HrAuditLog). Attendance that changes after lock is NOT pushed into the run;
 * payroll adds it as arrears next month.
 *
 * `inputsFingerprint` is a hash of every input (attendance days, leave, salary
 * rows, adjustments) taken at lock; approve re-checks it and refuses with
 * "changed since locked — recompute" if it differs.
 */
const HistorySchema = new mongoose.Schema({
  action: { type: String, enum: PAYROLL_HISTORY_ACTIONS, required: true },
  at: { type: Date, required: true },
  by: { type: ObjectId, ref: 'User', default: null },
  byName: { type: String, default: 'system', maxlength: 120 },
  reason: { type: String, default: '', maxlength: 1000 },
}, { _id: false });

const PayrollRunSchema = new mongoose.Schema({
  month: { type: String, required: true, match: MONTH_RE },
  status: { type: String, enum: PAYROLL_RUN_STATUSES, default: 'draft', required: true },
  employeeCount: { type: Number, default: 0 },
  totals: {
    type: new mongoose.Schema({
      grossPaise: { type: Number, default: 0 },
      deductionsPaise: { type: Number, default: 0 },
      netPaise: { type: Number, default: 0 },
      employerPfPaise: { type: Number, default: 0 },
      employerEsiPaise: { type: Number, default: 0 },
    }, { _id: false }),
    default: () => ({}),
  },
  // Settings + rules snapshot used for this month (rates can change later).
  settingsSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  inputsFingerprint: { type: String, default: '' },
  // People left out of the run and why ("no salary set") — bounded by headcount.
  skipped: {
    type: [new mongoose.Schema({
      employee: { type: ObjectId, ref: 'EmployeeProfile' },
      name: String,
      reason: String,
    }, { _id: false })],
    default: [],
  },
  // Payslips with a blocking warning: lock refuses while this is above 0.
  blockedCount: { type: Number, default: 0 },
  computedAt: { type: Date, default: null },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: ObjectId, ref: 'User', default: null },
  payoutsCreatedAt: { type: Date, default: null },
  payoutsCount: { type: Number, default: 0 },
  history: { type: [HistorySchema], default: [] }, // a handful per month
  rev: { type: Number, default: 0 },
}, { timestamps: true });

PayrollRunSchema.index({ month: 1 }, { name: 'hr_payroll_month_unique', unique: true });
PayrollRunSchema.index({ status: 1, month: -1 }, { name: 'hr_payroll_status_month' });

export default mongoose.models.PayrollRun || mongoose.model('PayrollRun', PayrollRunSchema);
