/**
 * FaceProfile + FaceReviewPhoto — data access only (services/hr/face/*).
 * `templateEnc` is read ONLY by `findTemplate`; every other read leaves it out.
 */
import FaceProfile from '../../models/hr/FaceProfile.js';
import FaceReviewPhoto from '../../models/hr/FaceReviewPhoto.js';

const faceRepository = {
  findProfile: (employeeId, session = null) => FaceProfile.findOne({ employee: employeeId }).session(session).lean(),
  /** The encrypted template — the one read that selects it (enrolled, or enrolled and allowed to re-enrol). */
  findTemplate: (employeeId) => FaceProfile.findOne({ employee: employeeId, status: { $in: ['enrolled', 'reenrol_allowed'] } })
    .select('+templateEnc status modelVersion rev').lean(),
  upsertProfile: (employeeId, set, session = null) => FaceProfile.findOneAndUpdate(
    { employee: employeeId },
    { $set: set, $inc: { rev: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true, session },
  ).lean(),
  /** CAS on rev (+ optional status list); null when someone else changed it first. */
  updateIfRev: (employeeId, rev, set, { statuses = null, unset = null, session = null } = {}) => FaceProfile.findOneAndUpdate(
    { employee: employeeId, rev, ...(statuses ? { status: { $in: statuses } } : {}) },
    { $set: set, ...(unset ? { $unset: unset } : {}), $inc: { rev: 1 } },
    { new: true, runValidators: true, session },
  ).lean(),

  // ── Review photos ────────────────────────────────────────────────────────
  createPhoto: async (doc, session = null) => {
    const [row] = await FaceReviewPhoto.create([doc], session ? { session } : {});
    return row.toObject();
  },
  findPhotoByPunch: (punchId) => FaceReviewPhoto.findOne({ punch: punchId }).lean(),
  listPhotosForEmployee: (employeeId, session = null) => FaceReviewPhoto.find({ employee: employeeId })
    .select('storageKey').limit(500).session(session).lean(),
  listExpiredPhotos: (now, limit) => FaceReviewPhoto.find({ expiresAt: { $lte: now } })
    .select('storageKey').sort({ expiresAt: 1 }).limit(limit).lean(),
  deletePhoto: (id) => FaceReviewPhoto.deleteOne({ _id: id }),
};

export default faceRepository;
