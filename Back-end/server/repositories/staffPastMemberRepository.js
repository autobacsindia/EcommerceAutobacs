import User from '../models/User.js';
import Order from '../models/Order.js';
import Lead from '../models/Lead.js';
import SalesQuotation from '../models/SalesQuotation.js';
import StaffTask from '../models/StaffTask.js';
import StaffLesson from '../models/StaffLesson.js';
import StaffDeparture from '../models/StaffDeparture.js';
import StaffHandoverMove from '../models/StaffHandoverMove.js';
import { StaffTrainingAssignment } from '../models/StaffTraining.js';
import salesRepRepository from './salesRepRepository.js';
import { STAFF_TEAM_VALUES } from '../config/staff.js';

/**
 * Data access for past team members (people whose staff access was removed).
 * Rules live in services/staffPastMemberService.js. Every read is bounded and
 * projected: no customer contact details, no resignation reason.
 */

/** Former staff: access removed. Admins and current staff are never "past". */
const PAST = { 'staff.active': false, role: { $in: ['customer', 'staff'] } };
/**
 * One seller's orders. The `$type` is what lets MongoDB use the salesUser indexes:
 * they are partial on `$type: 'objectId'`, and a bare equality does not prove the
 * row is inside that filter (same form as salesOrderService.ownId).
 */
const seller = (id) => ({ $eq: id, $type: 'objectId' });
const MEMBER_SELECT = 'name role staff.team staff.isHead staff.subRole staff.active staff.addedAt staff.deactivatedAt';

/** Keyset filter for a (deactivatedAt desc, _id desc) list. Missing dates sort last. */
function after(cursor) {
  if (!cursor) return {};
  const { at, id } = cursor;
  if (at === null) return { 'staff.deactivatedAt': null, _id: { $lt: id } };
  return {
    $or: [
      { 'staff.deactivatedAt': { $lt: at } },
      { 'staff.deactivatedAt': at, _id: { $lt: id } },
      { 'staff.deactivatedAt': null },
    ],
  };
}

const staffPastMemberRepository = {
  // Every team is an $in over the team key, so the staff_past_members index still
  // returns rows in order (merged per team) instead of sorting in memory.
  page: (team, cursor, limit) => User.find({ ...PAST, 'staff.team': team || { $in: STAFF_TEAM_VALUES }, ...after(cursor) })
    .select(MEMBER_SELECT).sort({ 'staff.deactivatedAt': -1, _id: -1 }).limit(limit).lean(),

  findMember: (id) => User.findOne({ _id: id, ...PAST }).select(MEMBER_SELECT).lean(),

  /** Their latest resignation that was not cancelled. */
  // `team` keeps the read to one team's records (staff_departure_team).
  lastDeparture: (userId, team) => StaffDeparture.findOne({ team, user: userId, status: { $in: ['open', 'left'] } })
    .select('status lastDay successor successorName note noteByName noteAt').sort({ _id: -1 }).lean(),
  markDepartureLeft: (id) => StaffDeparture.updateOne({ _id: id, status: 'open' }, { $set: { status: 'left' }, $unset: { active: 1 }, $inc: { rev: 1 } }),
  moves: (departureId, limit) => StaffHandoverMove.find({ departure: departureId, state: 'moved' })
    .select('kind label toName at').sort({ _id: 1 }).limit(limit).lean(),

  /** Finished, non-personal tasks they were doing; `teams` narrows to tasks a team can see. */
  doneTaskFilter: (userId, team) => ({
    'assignees.user': userId, bucket: 'done', personal: { $ne: true }, ...(team ? { teams: team } : {}),
  }),
  countTasks: (filter) => StaffTask.countDocuments(filter),
  taskPage: (filter, cursor, limit) => StaffTask.find({
    ...filter,
    ...(cursor ? { $or: [{ rank: { $gt: cursor.rank } }, { rank: cursor.rank, _id: { $gt: cursor.id } }] } : {}),
  })
    .select('number title completedAt rank').sort({ rank: 1, _id: 1 }).limit(limit).lean(),

  trainings: (userId, limit) => StaffTrainingAssignment.find({ user: userId, status: { $ne: 'cancelled' } })
    .select('pathTitle status signedOffAt signedOffByName createdAt').sort({ _id: -1 }).limit(limit).lean(),

  lessons: (userId, audiences, limit) => StaffLesson.find({
    createdBy: userId, archivedAt: null, ...(audiences ? { audience: { $in: audiences } } : {}),
  }).select('title audience createdAt').sort({ _id: -1 }).limit(limit).lean(),

  orderTotals: (userId) => Order.aggregate([
    { $match: { salesUser: seller(userId) } },
    { $group: { _id: { status: '$status', paymentStatus: '$paymentStatus' }, count: { $sum: 1 }, value: { $sum: '$totalAmount' } } },
  ]),
  orderPage: (userId, cursor, limit) => Order.find({
    salesUser: seller(userId),
    ...(cursor ? { $or: [{ createdAt: { $lt: cursor.at } }, { createdAt: cursor.at, _id: { $lt: cursor.id } }] } : {}),
  }).select('wpId createdAt totalAmount status paymentStatus').sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),

  quotationTotals: (userId) => SalesQuotation.aggregate([
    { $match: { salesUser: userId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]),
  async leadTotals(userId) {
    const rep = await salesRepRepository.findByUser(userId);
    if (!rep) return [];
    return Lead.aggregate([{ $match: { assignedRep: rep._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  },
};

export default staffPastMemberRepository;
