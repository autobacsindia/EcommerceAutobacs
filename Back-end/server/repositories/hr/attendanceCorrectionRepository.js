/** AttendanceCorrection — data access only (services/hr/attendance/correctionService.js). */
import AttendanceCorrection from '../../models/hr/AttendanceCorrection.js';

const attendanceCorrectionRepository = {
  create: async (doc) => (await AttendanceCorrection.create(doc)).toObject(),
  findByClientId: (employeeId, clientRequestId) => AttendanceCorrection
    .findOne({ employee: employeeId, clientRequestId }).lean(),
  findById: (id, session = null) => AttendanceCorrection.findById(id).session(session).lean(),
  list: (query, { sort, limit }) => AttendanceCorrection.find(query).sort(sort).limit(limit).lean(),
  /** CAS on { rev, status: pending }; returns the new row or null. */
  decideIfRev: (id, rev, set, session = null) => AttendanceCorrection.findOneAndUpdate(
    { _id: id, rev, status: 'pending' },
    { $set: set, $inc: { rev: 1 } },
    { new: true, session },
  ).lean(),
};

export default attendanceCorrectionRepository;
