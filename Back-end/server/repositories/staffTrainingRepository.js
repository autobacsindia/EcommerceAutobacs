import { StaffTrainingPath as Path, StaffTrainingAssignment as Assignment, StaffTrainingAttempt as Attempt, TRAINING_WAITING } from '../models/StaffTraining.js';
import StaffLesson from '../models/StaffLesson.js';
import StaffLessonProgress from '../models/StaffLessonProgress.js';

/** Data access for training. Rules live in services/staffTrainingService.js. */
const page = (model, filter, { before, limit, select }) => {
  const q = model.find({ ...filter, ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(limit);
  return (select ? q.select(select) : q).lean();
};

const staffTrainingRepository = {
  createPath: async (doc) => (await Path.create(doc)).toObject(),
  findPath: (id) => Path.findById(id).lean(),
  findLivePath: (id) => Path.findOne({ _id: id, archivedAt: null }).lean(),
  pagePaths: (filter, opts) => page(Path, { ...filter, archivedAt: null }, { ...opts, select: 'title team items.stage questions.type rev createdByName createdAt' }),
  updatePathIfRev: (id, rev, set) => Path.findOneAndUpdate({ _id: id, rev, archivedAt: null }, { $set: set, $inc: { rev: 1 } }, { new: true, runValidators: true }).lean(),
  archivePath: (id, at) => Path.findOneAndUpdate({ _id: id, archivedAt: null }, { $set: { archivedAt: at }, $inc: { rev: 1 } }, { new: true }).lean(),

  createAssignment: async (doc) => (await Assignment.create(doc)).toObject(),
  findAssignment: (id) => Assignment.findById(id).lean(),
  pageAssignments: (filter, opts) => page(Assignment, filter, opts),
  /** Moves status only from one of `from`: a stale write can never undo a sign-off. */
  moveAssignment: (id, from, set) => Assignment.findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: set }, { new: true }).lean(),
  allowAnotherAttempt: (id, status) => Assignment.findOneAndUpdate({ _id: id, status: 'needs_help' }, { $inc: { attemptsAllowed: 1 }, $set: { status } }, { new: true }).lean(),
  countWaiting: (team) => Assignment.countDocuments({ ...(team ? { team } : {}), active: true, status: { $in: TRAINING_WAITING } }),

  createAttempt: async (doc) => (await Attempt.create(doc)).toObject(),
  findAttempt: (id) => Attempt.findById(id).lean(),
  attemptsOf: (assignment) => Attempt.find({ assignment }).sort({ number: 1 }).lean(),
  finishAttempt: (id, fromStatus, set) => Attempt.findOneAndUpdate({ _id: id, status: fromStatus }, { $set: set }, { new: true }).lean(),

  /** Lessons still in the library: { _id, title, audience }. */
  liveLessons: (ids) => StaffLesson.find({ _id: { $in: ids }, archivedAt: null }).select('title audience').lean(),
  lessonOptions: (team, limit) => StaffLesson.find({ archivedAt: null, audience: { $in: ['company', team] } }).select('title audience').sort({ _id: -1 }).limit(limit).lean(),
  finished: (users, lessons) => StaffLessonProgress.find({ user: { $in: users }, lesson: { $in: lessons } }).select('user lesson').lean(),
};

export default staffTrainingRepository;
