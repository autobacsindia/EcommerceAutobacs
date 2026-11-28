/**
 * AttendanceDay (the derived read model) and AttendanceMonthLock.
 * Data access only — services/hr/attendance/dayService.js computes the rows.
 */
import AttendanceDay from '../../models/hr/AttendanceDay.js';
import AttendanceMonthLock from '../../models/hr/AttendanceMonthLock.js';

const DAY_FIELDS = '-__v';

const attendanceDayRepository = {
  find: (employeeId, date, session = null) => AttendanceDay
    .findOne({ employee: employeeId, date }).session(session).lean(),
  /**
   * Write the day row first thing in a punch transaction: a second concurrent
   * punch of the same employee/day then hits a write conflict and retries, so
   * punches of one person are serialised. A new row gets a placeholder status
   * the recompute in the same transaction overwrites. Returns the row as it was
   * BEFORE (null when this call created it), which the recompute reuses.
   */
  touch: (employeeId, date, month, session = null) => AttendanceDay.findOneAndUpdate(
    { employee: employeeId, date },
    { $set: { computedAt: new Date() }, $setOnInsert: { month, status: 'absent' } },
    { upsert: true, new: false, session }, // returns the row as it was (null = just created)
  ).select('payrollLocked changedAfterLock overtimeApprovedMinutes overtimeStatus overtimeDecidedOn status workedMinutes isLate lateMark earlyMark').lean(),
  /** Insert or replace the computed fields of one day (unique {employee, date}). */
  upsert: (employeeId, date, set, session = null) => AttendanceDay.findOneAndUpdate(
    { employee: employeeId, date },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true, session },
  ).select(DAY_FIELDS).lean(),
  listMonth: (employeeId, month) => AttendanceDay.find({ employee: employeeId, month })
    .select(DAY_FIELDS).sort({ date: 1 }).lean(),
  listForEmployeesOn: (employeeIds, date) => AttendanceDay.find({ employee: { $in: employeeIds }, date })
    .select(DAY_FIELDS).lean(),
  /** CAS on the overtime figure HR saw: approves exactly what was on screen. */
  setOvertimeApproved: (employeeId, date, expectedOvertime, set, session = null) => AttendanceDay.findOneAndUpdate(
    { employee: employeeId, date, overtimeMinutes: expectedOvertime },
    { $set: set },
    { new: true, session },
  ).select(DAY_FIELDS).lean(),

  // ── Overtime approval queue ──────────────────────────────────────────────
  findById: (id, session = null) => AttendanceDay.findById(id).session(session).select(DAY_FIELDS).lean(),
  /** Pending overtime rows (index hr_day_ot_pending), `filter` already holds the cursor clause. */
  listOvertime: (filter, { sort, limit }) => AttendanceDay.find(filter)
    .select('employee date status workedMinutes overtimeMinutes overtimeApprovedMinutes overtimeStatus autoClosed payrollLocked firstIn lastOut')
    .sort(sort).limit(limit).lean(),
  /**
   * CAS: decide overtime only if the row is still exactly what the decider saw
   * (same overtime minutes, same decision state) and payroll has not locked it.
   * null = someone/something changed it first.
   */
  decideOvertime: (id, seen, set, session = null) => AttendanceDay.findOneAndUpdate(
    {
      _id: id,
      overtimeMinutes: seen.overtimeMinutes,
      overtimeStatus: seen.overtimeStatus ?? null,
      overtimeApprovedMinutes: seen.overtimeApprovedMinutes || 0,
      payrollLocked: { $ne: true },
    },
    { $set: set },
    { new: true, runValidators: true, session },
  ).select(DAY_FIELDS).lean(),

  // ── Month locks (payroll) ────────────────────────────────────────────────
  isMonthLocked: async (month, session = null) => !!(await AttendanceMonthLock
    .exists({ month, locked: true }).session(session)),
  setMonthLock: (month, locked, at, session = null) => AttendanceMonthLock.findOneAndUpdate(
    { month },
    { $set: locked ? { locked: true, lockedAt: at } : { locked: false, unlockedAt: at } },
    { upsert: true, new: true, session },
  ).lean(),
  flagMonth: (month, set, session = null) => AttendanceDay.updateMany({ month }, { $set: set }, { session }),
  listChangedAfterLock: (month, limit) => AttendanceDay.find({ month, changedAfterLock: true })
    .select('employee date status workedMinutes overtimeApprovedMinutes')
    .sort({ changedAfterLock: 1, month: 1 }).limit(limit).lean(),
};

export default attendanceDayRepository;
