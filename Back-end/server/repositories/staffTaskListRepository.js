import StaffTaskList, { TASK_LIST_KINDS, TASK_LIST_COLOURS } from '../models/StaffTaskList.js';

export { TASK_LIST_KINDS, TASK_LIST_COLOURS };

/**
 * The folders and lists of task spaces (models/StaffTaskList.js).
 * Data access only — who may change them lives in services/staffTaskListService.js.
 */
const staffTaskListRepository = {
  model: StaffTaskList,

  create: async (doc) => (await StaffTaskList.create(doc)).toObject(),
  findById: (id) => StaffTaskList.findById(id).lean(),
  /** A space's live folders and lists, in order (staff_task_list_team). */
  findLive: (team) => StaffTaskList.find({ team, archivedAt: null }).sort({ order: 1, _id: 1 }).lean(),
  countLive: (team) => StaffTaskList.countDocuments({ team, archivedAt: null }),
  /** The live lists of one folder. */
  findInFolder: (folder) => StaffTaskList.find({ folder, kind: 'list', archivedAt: null }).lean(),
  /** The next `order` in a space: after everything already there. */
  lastOrder: async (team) => (await StaffTaskList.findOne({ team, archivedAt: null }).sort({ order: -1 }).select('order').lean())?.order ?? 0,

  /** Compare-and-set, like staffTaskRepository.updateIfRev: null when it moved on. */
  updateIfRev: (id, rev, set) => StaffTaskList.findOneAndUpdate(
    { _id: id, rev, archivedAt: null },
    { $set: set, $inc: { rev: 1 } },
    { new: true },
  ).lean(),
  /** Archive rows and free their names (`#<id>` on the name key). */
  archive: (ids, at) => StaffTaskList.updateMany(
    { _id: { $in: ids }, archivedAt: null },
    [{ $set: { archivedAt: at, nameKey: { $concat: ['$nameKey', '#', { $toString: '$_id' }] }, rev: { $add: ['$rev', 1] } } }],
  ),
};

export default staffTaskListRepository;
