import mongoose from 'mongoose';

/**
 * One tiny row per employee that leave transactions touch first (`$inc seq`).
 *
 * MongoDB has no predicate locks, so "no overlapping live request" and "balance
 * stays ≥ 0" are check-then-write races between two DIFFERENT requests of the
 * same person (each has its own idempotency key). Writing this row inside the
 * transaction makes two such transactions conflict on it; withTransaction
 * retries the loser, which then re-reads and sees the winner's request/ledger
 * row. Per-employee scope, so there is no global contention.
 */
const LeaveEmployeeLockSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployeeProfile', required: true },
  seq: { type: Number, default: 0 },
}, { timestamps: { createdAt: false, updatedAt: true } });

LeaveEmployeeLockSchema.index({ employee: 1 }, { name: 'hr_leave_lock_employee_unique', unique: true });

export default mongoose.models.LeaveEmployeeLock || mongoose.model('LeaveEmployeeLock', LeaveEmployeeLockSchema);
