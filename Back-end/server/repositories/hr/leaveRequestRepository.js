/** Leave requests (models/hr/LeaveRequest.js). Data access only; rules in services/hr/leave/requests.js. */
import LeaveRequest from '../../models/hr/LeaveRequest.js';

export const LIVE_STATUSES = Object.freeze(['pending_head', 'pending_hr', 'approved']);
export const PENDING_STATUSES = Object.freeze(['pending_head', 'pending_hr']);

const leaveRequestRepository = {
  findById: (id, session = null) => LeaveRequest.findById(id).session(session).lean(),
  findByClientId: (employeeId, clientRequestId, session = null) => LeaveRequest
    .findOne({ employee: employeeId, clientRequestId }).session(session).lean(),
  create: async (doc, session = null) => {
    const [row] = await LeaveRequest.create([doc], session ? { session } : {});
    return row.toObject();
  },
  /** Live requests of one employee whose range touches [from, to]. Rides hr_leave_employee_to_from. */
  findOverlapping: (employeeId, from, to, { statuses = LIVE_STATUSES, excludeId = null } = {}, session = null) => LeaveRequest
    .find({
      employee: employeeId, from: { $lte: to }, to: { $gte: from }, status: { $in: statuses },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
    .select('number from to status').limit(5).session(session).lean(),
  /** Σ halfDays of pending requests for one employee/type/year (to reserve balance at apply). */
  pendingHalfDays: async (employeeId, leaveTypeId, year, session = null) => {
    const rows = await LeaveRequest.find({
      employee: employeeId, leaveType: leaveTypeId, year, status: { $in: PENDING_STATUSES },
    }).select('halfDays').limit(200).session(session).lean();
    return rows.reduce((s, r) => s + r.halfDays, 0);
  },
  /** Pending requests of one employee/year (balance page). Rides hr_leave_employee_year_status; no sort needed. */
  pendingForYear: (employeeId, year) => LeaveRequest.find({ employee: employeeId, year, status: { $in: PENDING_STATUSES } })
    .select('leaveType halfDays').limit(200).lean(),
  /** Approved requests of employees touching [from, to] (with the day snapshot). */
  findApprovedInRange: (employeeIds, from, to) => LeaveRequest.find({
    employee: { $in: employeeIds }, status: 'approved', from: { $lte: to }, to: { $gte: from },
  }).select('employee leaveType paid days number').limit(1000).lean(),
  /** One keyset page (caller builds the query + sort). */
  page: (query, { sort, limit, select }) => LeaveRequest.find(query).select(select).sort(sort).limit(limit).lean(),
  /**
   * CAS transition: matches only the expected rev AND status, so a double click,
   * a second approver or a cancel racing a decision changes the row at most once.
   */
  transition: (id, { rev, fromStatus }, set, push = null, session = null) => LeaveRequest.findOneAndUpdate(
    { _id: id, rev, status: fromStatus },
    { $set: set, $inc: { rev: 1 }, ...(push ? { $push: push } : {}) },
    { new: true, runValidators: true, session },
  ).lean(),
};

export default leaveRequestRepository;
