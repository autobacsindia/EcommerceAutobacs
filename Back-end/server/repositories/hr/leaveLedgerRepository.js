/**
 * Leave ledger (models/hr/LeaveLedgerEntry.js, append-only) and the per-employee
 * transaction lock (models/hr/LeaveEmployeeLock.js). Balance = Σ deltaHalfDays.
 */
import mongoose from 'mongoose';
import LeaveLedgerEntry from '../../models/hr/LeaveLedgerEntry.js';
import LeaveEmployeeLock from '../../models/hr/LeaveEmployeeLock.js';

const oid = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));

const leaveLedgerRepository = {
  /** Insert one row inside `session`. A duplicate `key` throws E11000 (the caller decides). */
  append: async (doc, session = null) => {
    const [row] = await LeaveLedgerEntry.create([doc], session ? { session } : {});
    return row.toObject();
  },
  /**
   * Insert many system rows, skipping any whose `key` already exists.
   * Returns how many were actually inserted.
   */
  appendManyIdempotent: async (docs) => {
    if (!docs.length) return 0;
    try {
      const res = await LeaveLedgerEntry.insertMany(docs, { ordered: false, rawResult: true });
      return res.insertedCount ?? docs.length;
    } catch (err) {
      const dupOnly = (err.writeErrors || []).every((e) => (e.code ?? e.err?.code) === 11000);
      if (err.code !== 11000 && !(err.writeErrors && dupOnly)) throw err;
      return err.result?.insertedCount ?? err.insertedDocs?.length ?? 0;
    }
  },
  findByKey: (key, session = null) => LeaveLedgerEntry.findOne({ key }).session(session).lean(),

  /** Σ per (leaveType, reason) for one employee and year. Rides hr_leave_ledger_employee_year_type. */
  sumsForEmployeeYear: (employeeId, year, session = null) => LeaveLedgerEntry.aggregate([
    { $match: { employee: oid(employeeId), year } },
    { $group: { _id: { leaveType: '$leaveType', reason: '$reason' }, total: { $sum: '$deltaHalfDays' } } },
  ]).session(session),

  /** Balance of one employee/type/year. */
  balance: async (employeeId, leaveTypeId, year, session = null) => {
    const [row] = await LeaveLedgerEntry.aggregate([
      { $match: { employee: oid(employeeId), year, leaveType: oid(leaveTypeId) } },
      { $group: { _id: null, total: { $sum: '$deltaHalfDays' } } },
    ]).session(session);
    return row?.total || 0;
  },

  /** Balances of `leaveTypeIds` for a batch of employees in `year`: [{ employee, leaveType, total }]. */
  balancesForEmployees: (employeeIds, leaveTypeIds, year) => LeaveLedgerEntry.aggregate([
    { $match: { employee: { $in: employeeIds.map(oid) }, year, leaveType: { $in: leaveTypeIds.map(oid) } } },
    { $group: { _id: { employee: '$employee', leaveType: '$leaveType' }, total: { $sum: '$deltaHalfDays' } } },
    { $project: { _id: 0, employee: '$_id.employee', leaveType: '$_id.leaveType', total: 1 } },
  ]),

  /** Recent rows for one employee/year, newest first (bounded). */
  listForEmployeeYear: (employeeId, year, limit = 200) => LeaveLedgerEntry.find({ employee: employeeId, year })
    .select('leaveType deltaHalfDays reason note request createdAt by').sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),

  /**
   * Touch the employee's lock row inside the transaction so two leave
   * transactions for the same person conflict and one is retried.
   */
  lockEmployee: (employeeId, session) => LeaveEmployeeLock.findOneAndUpdate(
    { employee: employeeId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  ).lean(),
};

export default leaveLedgerRepository;
