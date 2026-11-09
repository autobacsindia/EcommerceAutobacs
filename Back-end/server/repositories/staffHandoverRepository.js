import StaffDeparture from '../models/StaffDeparture.js';
import StaffHandoverMove from '../models/StaffHandoverMove.js';
import StaffTask from '../models/StaffTask.js';
import StaffLesson from '../models/StaffLesson.js';
import SalesQuotation from '../models/SalesQuotation.js';
import Lead from '../models/Lead.js';
import Order from '../models/Order.js';

const FINISHED_ORDERS = ['delivered', 'returned', 'cancelled'];

/** Data access for handovers. Rules live in services/staffHandoverService.js. */
const staffHandoverRepository = {
  // Open and not personal. `assignee` covers a task the backfill missed (see peopleOf).
  openTasks: (user, limit) => StaffTask.find({ bucket: 'open', personal: { $ne: true }, $or: [{ 'assignees.user': user }, { assignee: user }] })
    .select('number title rev assignee assigneeName assignees').sort({ _id: 1 }).limit(limit).lean(),
  openLeads: (repId, statuses, limit) => Lead.find({ assignedRep: repId, status: { $in: statuses } }).select('name email phone').sort({ _id: 1 }).limit(limit).lean(),
  openQuotations: (user, limit) => SalesQuotation.find({ salesUser: user, status: 'open' }).select('number customer.name').sort({ _id: 1 }).limit(limit).lean(),
  ownedLessons: (user, limit) => StaffLesson.find({ owner: user, archivedAt: null }).select('title').sort({ _id: 1 }).limit(limit).lean(),
  unfinishedOrders: (user, limit) => Order.find({ salesUser: user, status: { $nin: FINISHED_ORDERS } }).select('status createdAt').sort({ _id: -1 }).limit(limit).lean(),

  /** Only while still open and still theirs: an accepted quotation never moves. */
  moveQuotation: (id, from, to, salesRep) => SalesQuotation.findOneAndUpdate({ _id: id, salesUser: from, status: 'open' }, { $set: { salesUser: to, salesRep } }, { new: true, projection: { _id: 1 } }).lean(),
  moveLesson: (id, from, to, ownerName) => StaffLesson.findOneAndUpdate({ _id: id, owner: from, archivedAt: null }, { $set: { owner: to, ownerName } }, { new: true, projection: { _id: 1 } }).lean(),

  /** One run at a time. A crashed run's lock expires by itself. */
  lock: (id, now, until) => StaffDeparture.findOneAndUpdate(
    { _id: id, $or: [{ handoverLockedUntil: null }, { handoverLockedUntil: { $lte: now } }] },
    { $set: { handoverLockedUntil: until } }, { new: true, projection: { _id: 1 } },
  ).lean(),
  unlock: (id) => StaffDeparture.updateOne({ _id: id }, { $set: { handoverLockedUntil: null } }),

  markPending: (key, doc) => StaffHandoverMove.findOneAndUpdate(key, { $set: { ...doc, state: 'pending', error: '' } }, { upsert: true, new: true }).lean(),
  settle: (key, state, error = '') => StaffHandoverMove.updateOne(key, { $set: { state, error } }),
  movesOf: (departure, limit) => StaffHandoverMove.find({ departure }).sort({ at: -1, _id: -1 }).limit(limit).lean(),
};

export default staffHandoverRepository;
