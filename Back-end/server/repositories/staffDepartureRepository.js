import StaffDeparture from '../models/StaffDeparture.js';
import User from '../models/User.js';

/** Data access for departures. Rules live in services/staffDepartureService.js. */
const staffDepartureRepository = {
  create: async (doc) => (await StaffDeparture.create(doc)).toObject(),
  findById: (id) => StaffDeparture.findById(id).lean(),
  page: (filter, { before, limit }) => StaffDeparture.find({ ...filter, ...(before ? { _id: { $lt: before } } : {}) })
    .select('-note').sort({ _id: -1 }).limit(limit).lean(),
  openFor: (userId, limit) => StaffDeparture.find({ active: true, $or: [{ user: userId }, { successor: userId }] })
    .select('-note -reason').sort({ _id: -1 }).limit(limit).lean(),
  updateIfRev: (id, rev, set) => StaffDeparture.findOneAndUpdate({ _id: id, rev, status: 'open' }, { $set: set, $inc: { rev: 1 } }, { new: true, runValidators: true }).lean(),
  cancel: (id) => StaffDeparture.findOneAndUpdate({ _id: id, status: 'open' }, { $set: { status: 'cancelled' }, $unset: { active: 1 }, $inc: { rev: 1 } }, { new: true }).lean(),
  dueBy: (filter, lastDay, limit) => StaffDeparture.find({ ...filter, active: true, lastDay: { $lte: lastDay } }).select('user').limit(limit).lean(),
  markLeft: (ids) => StaffDeparture.updateMany({ _id: { $in: ids }, status: 'open' }, { $set: { status: 'left' }, $unset: { active: 1 }, $inc: { rev: 1 } }),
  /** Of these people, the ones who still have staff access. */
  stillStaff: (ids) => User.find({ _id: { $in: ids }, role: 'staff', 'staff.active': true }).select('_id').lean(),
};

export default staffDepartureRepository;
