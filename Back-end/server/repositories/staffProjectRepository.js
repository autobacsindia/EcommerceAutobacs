import StaffProject, { PROJECT_STATUSES, PROJECT_COLOURS } from '../models/StaffProject.js';
import StaffTask from '../models/StaffTask.js';

export { PROJECT_STATUSES, PROJECT_COLOURS };

/**
 * Projects of the staff Tasks module (models/StaffProject.js).
 * Data access only — who may see or change one lives in services/staffProjectService.js.
 */
const staffProjectRepository = {
  model: StaffProject,

  create: async (doc) => (await StaffProject.create(doc)).toObject(),
  findById: (id) => StaffProject.findById(id).lean(),
  findByClientId: (createdBy, clientId) => StaffProject.findOne({ createdBy, clientId: { $type: 'string', $eq: clientId } }).lean(),

  /** The ids of the live projects matching `query` — at most `cap` (one index range per $or branch). */
  findIds: async (query, cap) => (await StaffProject.find({ ...query, archivedAt: null }).select('_id').limit(cap).lean()).map((p) => p._id),

  /** Keyset page ordered by (rank, _id): `query` carries the visibility rule and the bucket. */
  page: (query, { after = null, limit }) => {
    const keyset = after
      ? { $or: [{ rank: { $gt: after.rank } }, { rank: after.rank, _id: { $gt: after.id } }] }
      : null;
    return StaffProject.find(keyset ? { $and: [query, keyset] } : query)
      .sort({ rank: 1, _id: 1 })
      .limit(limit)
      .lean();
  },

  /** Compare-and-set: null when someone changed it first. */
  updateIfRev: (id, rev, set) => StaffProject.findOneAndUpdate(
    { _id: id, rev },
    { $set: set, $inc: { rev: 1 } },
    { new: true },
  ).lean(),

  /**
   * Task counts for each project, in ONE aggregate over the page's ids
   * (staff_task_project): total and done exclude archived and personal tasks;
   * a project whose tasks are all archived comes back with total 0;
   * overdue is open with a due day before `today`.
   */
  taskCounts: (ids, today) => (ids.length ? StaffTask.aggregate([
    /*
      The project is the ONLY indexed filter here: with a `bucket` filter beside
      it the planner picked staff_task_all and read every task in the
      collection (tests/staffProjectIndexUsage.test.js). Archived tasks are
      read through the index and skipped in the $group instead.
    */
    { $match: { project: { $in: ids }, personal: { $ne: true } } },
    {
      $group: {
        _id: '$project',
        total: { $sum: { $cond: [{ $in: ['$bucket', ['open', 'done']] }, 1, 0] } },
        done: { $sum: { $cond: [{ $eq: ['$bucket', 'done'] }, 1, 0] } },
        overdue: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$bucket', 'open'] }, { $lt: ['$rank', today] }] }, 1, 0],
          },
        },
      },
    },
  ]) : Promise.resolve([])),
};

export default staffProjectRepository;
