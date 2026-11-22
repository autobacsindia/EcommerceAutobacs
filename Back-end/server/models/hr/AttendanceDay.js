import mongoose from 'mongoose';
import { DAY_STATUSES, DATE_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One employee's day, DERIVED from accepted punches + leave + holidays + shift.
 * Recomputable at any time (services/hr/attendance recomputes it after every
 * punch, correction, leave decision or holiday change), so it is a read model,
 * never the source of truth. Payroll reads these rows and snapshots what it used.
 *
 * `payrollLocked` is set when the month's payroll locks; a later change still
 * recomputes the row but flags `changedAfterLock`, which payroll turns into
 * arrears next month instead of silently editing an approved month.
 */
const AttendanceDaySchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  date: { type: String, required: true, match: DATE_RE },
  month: { type: String, required: true }, // 'YYYY-MM', for payroll range reads
  shift: { type: ObjectId, ref: 'HrShift', default: null },
  status: { type: String, enum: DAY_STATUSES, required: true },
  firstIn: { type: Date, default: null },
  lastOut: { type: Date, default: null },
  workedMinutes: { type: Number, default: 0, min: 0 },
  breakMinutes: { type: Number, default: 0, min: 0 },
  lateMinutes: { type: Number, default: 0, min: 0 },
  isLate: { type: Boolean, default: false },
  overtimeMinutes: { type: Number, default: 0, min: 0 }, // computed
  overtimeApprovedMinutes: { type: Number, default: 0, min: 0 }, // what payroll pays
  overtimeApprovedBy: { type: ObjectId, ref: 'User', default: null },
  autoClosed: { type: Boolean, default: false }, // auto-closed hours never count as overtime
  needsReview: { type: Boolean, default: false },
  leaveRequest: { type: ObjectId, ref: 'LeaveRequest', default: null },
  payrollLocked: { type: Boolean, default: false },
  changedAfterLock: { type: Boolean, default: false },
  computedAt: { type: Date, default: Date.now },
}, { timestamps: true });

AttendanceDaySchema.index({ employee: 1, date: 1 }, { name: 'hr_day_employee_date', unique: true });
AttendanceDaySchema.index({ month: 1, employee: 1 }, { name: 'hr_day_month_employee' });
AttendanceDaySchema.index({ date: 1, status: 1 }, { name: 'hr_day_date_status' });
AttendanceDaySchema.index(
  { changedAfterLock: 1, month: 1 },
  { name: 'hr_day_changed_after_lock', partialFilterExpression: { changedAfterLock: true } },
);

export default mongoose.models.AttendanceDay || mongoose.model('AttendanceDay', AttendanceDaySchema);
