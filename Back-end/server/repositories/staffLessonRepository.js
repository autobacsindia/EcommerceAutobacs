import StaffLesson from '../models/StaffLesson.js';
import StaffLessonProgress from '../models/StaffLessonProgress.js';

/** Data access for the Lesson Library. Rules live in services/staffLessonService.js. */
const LIVE = { archivedAt: null };

const staffLessonRepository = {
  create: async (doc) => (await StaffLesson.create(doc)).toObject(),
  findLive: (id) => StaffLesson.findOne({ _id: id, ...LIVE }).lean(),

  /** One page, newest first: `limit` rows after the `before` id. */
  page: (filter, { before, limit }) => StaffLesson.find({
    ...filter, ...LIVE, ...(before ? { _id: { $lt: before } } : {}),
  })
    .select('-body')
    .sort({ _id: -1 })
    .limit(limit)
    .lean(),

  /** Compare-and-set: null when someone else changed it first. */
  updateIfRev: (id, rev, set) => StaffLesson.findOneAndUpdate(
    { _id: id, rev, ...LIVE },
    { $set: set, $inc: { rev: 1 } },
    { new: true, runValidators: true },
  ).lean(),
  setChecked: (id, at, byName) => StaffLesson.findOneAndUpdate(
    { _id: id, ...LIVE },
    { $set: { lastCheckedAt: at, lastCheckedByName: byName } },
    { new: true },
  ).lean(),
  archive: (id, at) => StaffLesson.findOneAndUpdate(
    { _id: id, ...LIVE },
    { $set: { archivedAt: at }, $inc: { rev: 1 } },
    { new: true },
  ).lean(),

  /** Adds the file unless it is already there or the lesson is full: null when it did not add. */
  pushFile: (id, file, max) => StaffLesson.findOneAndUpdate(
    { _id: id, ...LIVE, 'files.publicId': { $ne: file.publicId }, [`files.${max - 1}`]: { $exists: false } },
    { $push: { files: file } },
    { new: true },
  ).lean(),
  pullFile: (id, publicId) => StaffLesson.findOneAndUpdate(
    { _id: id, ...LIVE, 'files.publicId': publicId },
    { $pull: { files: { publicId } } },
    { new: true },
  ).lean(),

  /** Idempotent: finishing twice keeps the first time. */
  markDone: async (lesson, user, at) => {
    try {
      await StaffLessonProgress.updateOne({ lesson, user }, { $setOnInsert: { completedAt: at } }, { upsert: true });
    } catch (err) {
      // Two presses at once: the unique index let one in, which is the result we want.
      if (err?.code !== 11000) throw err;
    }
  },
  unmarkDone: (lesson, user) => StaffLessonProgress.deleteOne({ lesson, user }),
  progressFor: (lesson, users) => StaffLessonProgress.find({ lesson, user: { $in: users } }).select('user completedAt').lean(),
  doneByUser: (user, lessons) => StaffLessonProgress.find({ user, lesson: { $in: lessons } }).select('lesson completedAt').lean(),
};

export default staffLessonRepository;
