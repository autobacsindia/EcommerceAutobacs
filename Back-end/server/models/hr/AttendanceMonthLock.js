import mongoose from 'mongoose';
import { MONTH_RE } from '../../config/hr.js';

/**
 * "Payroll for this month is locked" as the attendance engine sees it.
 *
 * Payroll calls services/hr/attendance `markMonthLocked(month)` when it locks a
 * run (and `markMonthUnlocked` when it unlocks). Locking flags every existing
 * AttendanceDay of the month; this row is what lets a LATER recompute of a day
 * that had no row yet (a correction for a day nobody punched) still know the
 * month is locked and set `changedAfterLock`. One row per month, tiny.
 */
const AttendanceMonthLockSchema = new mongoose.Schema({
  month: { type: String, required: true, match: MONTH_RE },
  locked: { type: Boolean, default: true },
  lockedAt: { type: Date, default: null },
  unlockedAt: { type: Date, default: null },
}, { timestamps: true });

AttendanceMonthLockSchema.index({ month: 1 }, { name: 'hr_att_month_lock_unique', unique: true });

export default mongoose.models.AttendanceMonthLock || mongoose.model('AttendanceMonthLock', AttendanceMonthLockSchema);
