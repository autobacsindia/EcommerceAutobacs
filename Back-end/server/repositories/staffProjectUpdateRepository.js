import mongoose from 'mongoose';
import StaffProjectUpdate from '../models/StaffProjectUpdate.js';

const LIST_FIELDS = { text: 1, attachments: 1, by: 1, byName: 1, createdAt: 1, deletedAt: 1 };

/**
 * Updates on staff projects (models/StaffProjectUpdate.js). Data access only —
 * who may read, post and delete lives in services/staffProjectUpdateService.js.
 */
const staffProjectUpdateRepository = {
  model: StaffProjectUpdate,

  /** Newest first, ids below `before` (a keyset page), at most `limit`. */
  page: (projectId, { before = null, limit }) => StaffProjectUpdate.find({
    project: projectId,
    ...(before ? { _id: { $lt: new mongoose.Types.ObjectId(before) } } : {}),
  }, LIST_FIELDS).sort({ _id: -1 }).limit(limit).lean(),

  /** The stored ref of a file on a LIVE update of this project, or null. */
  liveFile: async (projectId, publicId) => {
    const u = await StaffProjectUpdate.findOne(
      { project: projectId, deletedAt: null, 'attachments.publicId': publicId },
      { 'attachments.$': 1 },
    ).lean();
    return u?.attachments?.[0] || null;
  },

  findByClientId: (by, clientId) => StaffProjectUpdate.findOne({ by, clientId }).lean(),
  findInProject: (projectId, id) => StaffProjectUpdate.findOne({ _id: id, project: projectId }).lean(),
  create: async (doc) => (await StaffProjectUpdate.create(doc)).toObject(),

  /** Mark deleted and drop its file refs — only if still live, so two deletes act once. */
  softDelete: (id, by) => StaffProjectUpdate.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date(), deletedBy: by }, $unset: { attachments: 1 } },
    { new: true, lean: true },
  ),
};

export default staffProjectUpdateRepository;
