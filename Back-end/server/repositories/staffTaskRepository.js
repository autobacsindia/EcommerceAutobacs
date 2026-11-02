import StaffTask from '../models/StaffTask.js';
import StaffTaskComment from '../models/StaffTaskComment.js';
import { reactionStage } from '../utils/reactions.js';

/** History entries kept on a task; older ones fall off so the document stays small. */
const HISTORY_CAP = 100;

/*
  What a list row needs — and the checklist COUNTS instead of the checklist.
  Cards show "2/5", never the steps, yet reading the steps cost a page of 50 tasks
  71 KB instead of 35 KB with five short steps each, and 503 KB with full
  checklists (measured, BSON). The database counts them instead.
  Every field services/staffTaskService.js `shape()` reads for a list row must be
  here; tests/staffTasks.test.js compares a list row with the task page to catch
  one being forgotten.
*/
export const LIST_PROJECTION = Object.freeze({
  number: 1, title: 1, description: 1, status: 1, priority: 1, dueOn: 1, startOn: 1, tags: 1,
  assignee: 1, assigneeName: 1, team: 1, createdBy: 1, createdByName: 1,
  order: 1, group: 1, groupSize: 1, bucket: 1, rank: 1, rev: 1,
  completedAt: 1, archivedAt: 1, commentCount: 1, lastCommentAt: 1, createdAt: 1, updatedAt: 1,
  checklistTotal: { $size: { $ifNull: ['$checklist', []] } },
  checklistDone: { $size: { $filter: { input: { $ifNull: ['$checklist', []] }, cond: '$$this.done' } } },
});

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
  /** The copies of a create already made (a retry of a several-people create). */
  findByClientIds: (createdBy, clientIds) => StaffTask.find({ createdBy, clientId: { $type: 'string', $in: clientIds } }).lean(),
  /**
   * Every copy of a task given to several people (at most MAX_ASSIGNEES rows).
   * `$type` restates the partial filter of staff_task_group so the planner uses it:
   * a bare `{ group }` read every task in the collection (4,003 docs for 3, measured).
   */
  findGroup: (group) => StaffTask.find({ group: { $type: 'objectId', $eq: group } })
    .select('number assignee assigneeName team createdBy status bucket').lean(),

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
    return StaffTask.find(keyset ? { $and: [filter, keyset] } : filter, LIST_PROJECTION)
      .sort({ rank: 1, _id: 1 })
      .limit(limit)
      .lean();
  },

  /** Keyset page in another order (newest / oldest / recently changed): `query` already carries the "after the cursor" clause. */
  pageSorted: (query, { sort, limit }) => StaffTask.find(query, LIST_PROJECTION).sort(sort).limit(limit).lean(),

  /** How many tasks match, counted over at most `cap` of them. */
  countUpTo: async (query, cap) => {
    const count = await StaffTask.countDocuments(query, { limit: cap + 1 });
    return count > cap ? { count: cap, capped: true } : { count, capped: false };
  },

  /** Open tasks given to `userId` whose due day is in `range` (the page header). */
  countDueIn: (userId, range) => StaffTask.countDocuments({ assignee: userId, bucket: 'open', rank: range }),
  /** Open tasks given to `userId` that are due on or before `day` (the bell). */
  countDueBy: (userId, day) => StaffTask.countDocuments({ assignee: userId, bucket: 'open', rank: { $lte: day } }),

  // ── Checklist (never bumps `rev`: ticking a step must not block someone's edit) ──
  /**
   * Add a step, atomically: refused (null) when the task is archived, already has
   * `max` steps, or already has a step added with this `key` (a double-click).
   */
  pushChecklistItem: (id, item, entry, max) => StaffTask.findOneAndUpdate(
    {
      _id: id,
      bucket: { $in: ['open', 'done'] },
      [`checklist.${max - 1}`]: { $exists: false },
      ...(item.key ? { 'checklist.key': { $ne: item.key } } : {}),
    },
    { $push: { checklist: item, history: { $each: [entry], $slice: -HISTORY_CAP } } },
    { new: true },
  ).lean(),
  /** Change one step in place. Null when the task is archived or the step is gone. */
  setChecklistItem: (id, itemId, set, entry) => StaffTask.findOneAndUpdate(
    { _id: id, bucket: { $in: ['open', 'done'] }, 'checklist._id': itemId },
    {
      $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`checklist.$.${k}`, v])),
      $push: { history: { $each: [entry], $slice: -HISTORY_CAP } },
    },
    { new: true },
  ).lean(),
  /** Remove one step. Null when the task is archived or the step is already gone. */
  pullChecklistItem: (id, itemId, entry) => StaffTask.findOneAndUpdate(
    { _id: id, bucket: { $in: ['open', 'done'] }, 'checklist._id': itemId },
    { $pull: { checklist: { _id: itemId } }, $push: { history: { $each: [entry], $slice: -HISTORY_CAP } } },
    { new: true },
  ).lean(),

  // ── Comments ──
  createComment: async (doc) => (await StaffTaskComment.create(doc)).toObject(),
  findCommentByClientId: (by, clientId) => StaffTaskComment.findOne(staffTaskRepository.commentClientIdFilter(by, clientId)).lean(),
  /** Count a new comment on the task. Does not bump `rev`: talking never blocks an edit. */
  noteComment: (taskId, at) => StaffTask.updateOne({ _id: taskId }, { $inc: { commentCount: 1 }, $set: { lastCommentAt: at } }),
  /** Newest first, keyset on _id. Earlier words (`edits`) never leave the database. */
  pageComments: (taskId, { before = null, limit }) => StaffTaskComment.find(
    before ? { task: taskId, _id: { $lt: before } } : { task: taskId },
  )
    .sort({ _id: -1 })
    .limit(limit)
    .select('-clientId -edits')
    .lean(),
  findComment: (taskId, id) => StaffTaskComment.findOne({ _id: id, task: taskId }).select('-edits').lean(),

  /*
    Author edits and deletes: ONE conditional write whose filter carries every
    rule — the author, not deleted, written after `notBefore` (the edit window) —
    so the database is the clock, not a check made a moment before the write.
  */
  /**
   * Replace the text, keeping the old one in `edits`. `fromText` is a
   * compare-and-set: two edits racing from one version cannot both land.
   * Null when no rule allowed it.
   */
  editComment: (id, by, { fromText, toText, notBefore, at = new Date(), keep = 20 }) => StaffTaskComment.findOneAndUpdate(
    { _id: id, by, deletedAt: null, createdAt: { $gte: notBefore }, text: fromText },
    { $set: { text: toText, editedAt: at }, $push: { edits: { $each: [{ text: fromText, at }], $slice: -keep } } },
    { new: true, projection: { clientId: 0, edits: 0 } },
  ).lean(),
  deleteComment: (id, by, { notBefore, at = new Date() }) => StaffTaskComment.findOneAndUpdate(
    { _id: id, by, deletedAt: null, createdAt: { $gte: notBefore } },
    { $set: { deletedAt: at, deletedBy: by } },
    { new: true, projection: { clientId: 0, edits: 0 } },
  ).lean(),
  /** Put `userId`'s emoji on (`on`) or take it off, atomically (utils/reactions.js). Null when deleted. */
  setCommentReaction: (id, userId, emoji, on, max) => StaffTaskComment.findOneAndUpdate(
    { _id: id, deletedAt: null },
    [reactionStage(userId, emoji, on, max)],
    { new: true, projection: { clientId: 0, edits: 0 } },
  ).lean(),
  /** Is `publicId` a file on a comment of this task that has not been deleted? Rides { task, _id }. */
  hasLiveCommentFile: async (taskId, publicId) => !!(await StaffTaskComment.exists({ task: taskId, deletedAt: null, 'attachments.publicId': publicId })),

  // ── Files on the task (never bump `rev`: adding a file must not block someone's edit) ──
  /**
   * Add files, atomically: null when the task is archived or would pass `max` files.
   */
  pushFiles: (id, files, entries, max) => StaffTask.findOneAndUpdate(
    { _id: id, bucket: { $in: ['open', 'done'] }, [`files.${max - files.length}`]: { $exists: false } },
    { $push: { files: { $each: files }, history: { $each: entries, $slice: -HISTORY_CAP } } },
    { new: true },
  ).lean(),
  /** Remove one file. Null when it is already gone. */
  pullFile: (id, publicId, entry) => StaffTask.findOneAndUpdate(
    { _id: id, 'files.publicId': publicId },
    { $pull: { files: { publicId } }, $push: { history: { $each: [entry], $slice: -HISTORY_CAP } } },
    { new: true },
  ).lean(),
};

export default staffTaskRepository;
