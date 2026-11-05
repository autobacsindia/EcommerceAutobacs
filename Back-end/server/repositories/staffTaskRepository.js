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
  number: 1, title: 1, description: 1, status: 1, priority: 1, dueOn: 1, dueTime: 1, startOn: 1, tags: 1,
  assignee: 1, assigneeName: 1, team: 1, assignees: 1, teams: 1, followers: 1, createdBy: 1, createdByName: 1,
  order: 1, group: 1, groupSize: 1, list: 1, parent: 1, subtasks: 1, bucket: 1, rank: 1, rev: 1,
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
    .select('number assignee assigneeName team assignees teams followers createdBy status bucket').lean(),

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
   * Take every task out of `listIds` (lists just deleted) into "Other tasks",
   * bumping each one's rev — an edit made against the old list is then refused,
   * not silently applied on top.
   */
  unfile: (listIds, entry) => StaffTask.updateMany(
    { list: { $in: listIds } },
    { $set: { list: null }, $inc: { rev: 1 }, $push: { history: { $each: [entry], $slice: -HISTORY_CAP } } },
  ),
  /** Open tasks per list in one team's space (null = "Other tasks"), from staff_task_teams. */
  openCountsByList: (team) => StaffTask.aggregate([
    { $match: { teams: team, bucket: 'open' } },
    { $group: { _id: '$list', n: { $sum: 1 } } },
  ]),

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
  countDueIn: (userId, range) => StaffTask.countDocuments({ 'assignees.user': userId, bucket: 'open', rank: range }),
  /** Open tasks given to `userId` that are due on or before `day` (the bell). */
  /** Open tasks of `userId` due before `bound` (a rank: the next day counts everything due up to the end of today). */
  countDueBefore: (userId, bound) => StaffTask.countDocuments({ 'assignees.user': userId, bucket: 'open', rank: { $lt: bound } }),

  // ── Sub-tasks ──
  /*
    Every read restates the partial filter of staff_task_parent (`$type`), so the
    planner uses it instead of reading the whole collection.
  */
  childFilter: (parentId, extra = {}) => ({ 'parent.task': { $type: 'objectId', $eq: parentId }, ...extra }),
  /** The sub-tasks of one task that are not archived, in list order (at most `limit`). */
  findSubtasks: (parentId, limit) => StaffTask.find(staffTaskRepository.childFilter(parentId, { bucket: { $in: ['open', 'done'] } }), LIST_PROJECTION)
    .sort({ rank: 1, _id: 1 })
    .limit(limit)
    .lean(),
  /** `{ total, done }` over the sub-tasks that are not archived — counted, never kept by adding. */
  countSubtasks: async (parentId) => {
    const [total, done] = await Promise.all([
      StaffTask.countDocuments(staffTaskRepository.childFilter(parentId, { bucket: { $in: ['open', 'done'] } })),
      StaffTask.countDocuments(staffTaskRepository.childFilter(parentId, { bucket: 'done' })),
    ]);
    return { total, done };
  },
  /** Store the counts on the parent. Does not bump `rev`: a sub-task moving never blocks an edit of the parent. */
  setSubtaskCounts: (parentId, counts) => StaffTask.updateOne({ _id: parentId }, { $set: { subtasks: counts } }),
  readSubtaskCounts: async (parentId) => (await StaffTask.findById(parentId).select('subtasks').lean())?.subtasks ?? null,
  /** Keep the parent's title on its sub-tasks up to date (at most SUBTASKS_MAX rows). */
  renameParent: (parentId, title) => StaffTask.updateMany(staffTaskRepository.childFilter(parentId), { $set: { 'parent.title': title } }),
  /**
   * Sub-tasks to archive with their parent (those not archived yet), or to bring
   * back with it (only those archived because it was).
   */
  findChildrenToArchive: (parentId) => StaffTask.find(staffTaskRepository.childFilter(parentId, { bucket: { $in: ['open', 'done'] } })).lean(),
  findChildrenToRestore: (parentId) => StaffTask.find(staffTaskRepository.childFilter(parentId, { bucket: 'archived', archivedWithParent: true })).lean(),
  /**
   * Archive or restore one sub-task along with its parent, whatever its `rev`
   * (the parent's editor decided), bumping `rev` so an open edit of it goes
   * stale. `from` is the bucket it must still be in, so a retry changes nothing.
   */
  moveWithParent: (id, from, set, entry) => StaffTask.findOneAndUpdate(
    { _id: id, bucket: from },
    { $set: set, $inc: { rev: 1 }, $push: { history: { $each: [entry], $slice: -HISTORY_CAP } } },
    { new: true },
  ).lean(),
  /** One line in a task's history, without bumping `rev`. */
  noteHistory: (id, entry) => StaffTask.updateOne({ _id: id }, { $push: { history: { $each: [entry], $slice: -HISTORY_CAP } } }),

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

  // ── Followers (never bump `rev`: following must not block someone's edit) ──
  /**
   * Take `removeIds` off and put `addPeople` ({ user, name }) on, in ONE write
   * the database works out from what the task holds at that moment — so two
   * people following at once both land, someone already following is not added
   * twice, and the cap holds. Null when the result would pass `max`, or the task
   * is gone.
   */
  changeFollowers: (id, { addPeople = [], removeIds = [] }, entries, max) => {
    const current = { $ifNull: ['$followers', []] };
    const kept = { $filter: { input: current, cond: { $not: [{ $in: ['$$this.user', removeIds] }] } } };
    const fresh = { $filter: { input: { $literal: addPeople }, cond: { $not: [{ $in: ['$$this.user', { $ifNull: ['$followers.user', []] }] }] } } };
    const next = { $concatArrays: [kept, fresh] };
    return StaffTask.findOneAndUpdate(
      { _id: id, $expr: { $lte: [{ $size: next }, max] } },
      [{
        $set: {
          followers: next,
          history: { $slice: [{ $concatArrays: [{ $ifNull: ['$history', []] }, { $literal: entries }] }, -HISTORY_CAP] },
        },
      }],
      { new: true },
    ).lean();
  },

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
  /** The file (its name) on a live comment of the task, or null when no live comment carries it. */
  liveCommentFile: async (taskId, publicId) => {
    const c = await StaffTaskComment.findOne(
      { task: taskId, deletedAt: null, 'attachments.publicId': publicId },
      { 'attachments.$': 1 },
    ).lean();
    return c?.attachments?.[0] || null;
  },

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
