import StaffTask from '../models/StaffTask.js';
import StaffTaskComment from '../models/StaffTaskComment.js';

/** History entries kept on a task; older ones fall off so the document stays small. */
const HISTORY_CAP = 100;

/**
 * Staff tasks and their comments (models/StaffTask.js, StaffTaskComment.js).
 * Data access only — who may do what lives in services/staffTaskService.js.
 */
const staffTaskRepository = {
  model: StaffTask,
  commentModel: StaffTaskComment,

  create: async (doc) => (await StaffTask.create(doc)).toObject(),
  findById: (id) => StaffTask.findById(id).lean(),

  /*
    The duplicate checks run on every create and comment. Their unique indexes are
    partial on `clientId: { $type: 'string' }`, and the planner only uses a partial
    index when the query restates that filter — a bare `{ createdBy, clientId }`
    walked every task the person ever created (66 keys for 1 row, measured), and
    the comment form scanned the whole collection. Pinned by
    tests/staffTaskIndexUsage.test.js.
  */
  clientIdFilter: (createdBy, clientId) => ({ createdBy, clientId: { $type: 'string', $eq: clientId } }),
  commentClientIdFilter: (by, clientId) => ({ by, clientId: { $type: 'string', $eq: clientId } }),
  findByClientId: (createdBy, clientId) => StaffTask.findOne(staffTaskRepository.clientIdFilter(createdBy, clientId)).lean(),

  /**
   * Apply a change only if nobody changed the task since `rev` was read
   * (compare-and-set). Returns the new task, or null when it moved on.
   */
  updateIfRev: (id, rev, set, entries) => StaffTask.findOneAndUpdate(
    { _id: id, rev },
    { $set: set, $inc: { rev: 1 }, $push: { history: { $each: entries, $slice: -HISTORY_CAP } } },
    { new: true },
  ).lean(),

  /**
   * Keyset page over one bucket, ordered by (rank, _id). `range` narrows rank
   * (overdue / due today) and stays inside the same index range.
   */
  page: (query, { after = null, limit, range = null }) => {
    const rank = { ...(range || {}) };
    // Seek straight to the cursor: without this lower bound the index scan starts
    // at the person's first task and filters every earlier page out again, so page
    // N read N pages of keys (41 keys for 21 rows on page 2, measured; 23 with it).
    if (after && !(rank.$gte && rank.$gte > after.rank)) rank.$gte = after.rank;
    const filter = { ...query, ...(Object.keys(rank).length ? { rank } : {}) };
    const keyset = after
      ? { $or: [{ rank: { $gt: after.rank } }, { rank: after.rank, _id: { $gt: after.id } }] }
      : null;
    return StaffTask.find(keyset ? { $and: [filter, keyset] } : filter)
      .sort({ rank: 1, _id: 1 })
      .limit(limit)
      .select('-history -clientId')
      .lean();
  },

  /** Open tasks given to `userId` that are due on or before `day` (the bell). */
  countDueBy: (userId, day) => StaffTask.countDocuments({ assignee: userId, bucket: 'open', rank: { $lte: day } }),

  // ── Comments ──
  createComment: async (doc) => (await StaffTaskComment.create(doc)).toObject(),
  findCommentByClientId: (by, clientId) => StaffTaskComment.findOne(staffTaskRepository.commentClientIdFilter(by, clientId)).lean(),
  /** Count a new comment on the task. Does not bump `rev`: talking never blocks an edit. */
  noteComment: (taskId, at) => StaffTask.updateOne({ _id: taskId }, { $inc: { commentCount: 1 }, $set: { lastCommentAt: at } }),
  /** Newest first, keyset on _id. */
  pageComments: (taskId, { before = null, limit }) => StaffTaskComment.find(
    before ? { task: taskId, _id: { $lt: before } } : { task: taskId },
  )
    .sort({ _id: -1 })
    .limit(limit)
    .select('-clientId')
    .lean(),
};

export default staffTaskRepository;
