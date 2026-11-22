/** Leave types (models/hr/LeaveType.js). Data access only; rules in services/hr/leave/types.js. */
import LeaveType from '../../models/hr/LeaveType.js';

const leaveTypeRepository = {
  findById: (id, session = null) => LeaveType.findById(id).session(session).lean(),
  findByIds: (ids) => LeaveType.find({ _id: { $in: ids } }).lean(),
  /** Every type (a company has a handful; capped defensively). */
  list: ({ activeOnly = false } = {}) => LeaveType.find(activeOnly ? { active: true } : {})
    .sort({ active: -1, name: 1 }).limit(100).lean(),
  findByCodes: (codes) => LeaveType.find({ code: { $in: codes } }).select('code').lean(),
  create: async (doc, session = null) => {
    const [row] = await LeaveType.create([doc], session ? { session } : {});
    return row.toObject();
  },
  /** CAS on rev; returns the new doc or null when someone else changed it first. */
  updateIfRev: (id, rev, set, session = null) => LeaveType.findOneAndUpdate(
    { _id: id, rev },
    { $set: set, $inc: { rev: 1 } },
    { new: true, runValidators: true, session },
  ).lean(),
};

export default leaveTypeRepository;
