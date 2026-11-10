import StaffPastMemberNote from '../models/StaffPastMemberNote.js';

/** Data access for notes on past members. Rules live in services/staffPastMemberNoteService.js. */
const staffPastMemberNoteRepository = {
  create: async (doc) => (await StaffPastMemberNote.create(doc)).toObject(),
  page: (memberId, before, limit) => StaffPastMemberNote.find({ member: memberId, ...(before ? { _id: { $lt: before } } : {}) })
    .sort({ _id: -1 }).limit(limit).lean(),
  findOne: (memberId, id) => StaffPastMemberNote.findOne({ _id: id, member: memberId }).lean(),
  updateIfRev: (id, rev, set) => StaffPastMemberNote.findOneAndUpdate({ _id: id, rev }, { $set: set, $inc: { rev: 1 } }, { new: true }).lean(),
  remove: (id) => StaffPastMemberNote.deleteOne({ _id: id }),
};

export default staffPastMemberNoteRepository;
