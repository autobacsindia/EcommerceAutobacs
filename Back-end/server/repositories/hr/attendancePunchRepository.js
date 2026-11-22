/**
 * Punches (models/hr/AttendancePunch.js). Data access only — the rules are in
 * services/hr/attendance/punchService.js. Every write accepts an optional
 * transaction `session`.
 */
import AttendancePunch from '../../models/hr/AttendancePunch.js';

const opts = (session) => (session ? { session } : {});

const attendancePunchRepository = {
  findByClientId: (employeeId, clientPunchId, session = null) => AttendancePunch
    .findOne({ employee: employeeId, clientPunchId }).session(session).lean(),
  findById: (id, session = null) => AttendancePunch.findById(id).session(session).lean(),
  create: async (doc, session = null) => {
    const [row] = await AttendancePunch.create([doc], opts(session));
    return row.toObject();
  },
  /** Accepted + pending punches of one day, oldest first (the sequence and the day's figures). */
  listForDay: (employeeId, date, session = null) => AttendancePunch
    .find({ employee: employeeId, date, status: { $in: ['accepted', 'pending_review'] } })
    .select('employee clientPunchId date type at receivedAt offline status source site geo.verdict geo.distanceM face.verdict')
    .sort({ at: 1, _id: 1 })
    .session(session)
    .lean(),
  /** Accepted + pending punches for several days (one query for a day and its neighbour). */
  listForDays: (employeeId, dates, session = null) => AttendancePunch
    .find({ employee: employeeId, date: { $in: dates }, status: { $in: ['accepted', 'pending_review'] } })
    .select('date type at status source site geo.verdict')
    .sort({ at: 1, _id: 1 })
    .session(session)
    .lean(),
  /** The latest punch with a GPS fix before `before` (the "impossible jump" check). */
  findLastWithGeo: (employeeId, before) => AttendancePunch
    .findOne({
      employee: employeeId, status: { $in: ['accepted', 'pending_review'] }, at: { $lt: before }, 'geo.lat': { $type: 'number' },
    })
    .select('at geo.lat geo.lng')
    .sort({ employee: 1, at: -1 })
    .lean(),
  /** CAS on status: decide a pending punch exactly once. */
  decide: (id, fromStatus, set, session = null) => AttendancePunch.findOneAndUpdate(
    { _id: id, status: fromStatus },
    { $set: set },
    { new: true, session },
  ).lean(),
  listByStatus: (query, { sort, limit }) => AttendancePunch.find(query)
    .select('employee clientPunchId type at receivedAt date offline site geo face status deviceId source reviewNote')
    .sort(sort).limit(limit).lean(),
  /** Employees with an open session on `date` (last punch not 'out'): the auto-close input. */
  openSessionsOn: (date) => AttendancePunch.aggregate([
    { $match: { date, status: 'accepted' } },
    { $sort: { employee: 1, at: 1, _id: 1 } },
    { $group: { _id: '$employee', last: { $last: '$type' }, lastAt: { $last: '$at' } } },
    { $match: { last: { $ne: 'out' } } },
  ]),
};

export default attendancePunchRepository;
