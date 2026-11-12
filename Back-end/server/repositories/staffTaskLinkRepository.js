import StaffTask from '../models/StaffTask.js';
import StaffTaskLink from '../models/StaffTaskLink.js';

/** What the link screens show of a task, and what canSee needs to decide on it. */
const LINK_FIELDS = 'number title status priority dueOn dueTime bucket assignee assigneeName team assignees teams followers createdBy personal project';

/**
 * Links between staff tasks (models/StaffTaskLink.js). Data access only — who may
 * link what lives in services/staffTaskLinkService.js.
 */
const staffTaskLinkRepository = {
  model: StaffTaskLink,

  /** Every link touching `taskId`, at most `limit`, oldest first. */
  forTask: (taskId, limit) => StaffTaskLink.find({ $or: [{ from: taskId }, { to: taskId }] }).sort({ _id: 1 }).limit(limit).lean(),

  countForTask: (taskId) => StaffTaskLink.countDocuments({ $or: [{ from: taskId }, { to: taskId }] }),

  findById: (id) => StaffTaskLink.findById(id).lean(),
  findPair: (pair) => StaffTaskLink.findOne({ pair }).lean(),

  /** Throws E11000 when these two tasks are already linked. */
  insert: async (row) => (await StaffTaskLink.create(row)).toObject(),

  /** Only the call that still finds it gets it back: a second Remove gets null. */
  remove: (id) => StaffTaskLink.findOneAndDelete({ _id: id }).lean(),

  tasksByIds: (ids) => StaffTask.find({ _id: { $in: ids } }).select(LINK_FIELDS).lean(),

  /** The tasks that `ids` block directly (one step of the "would this go round in a circle?" walk). */
  blockedBy: async (ids) => (await StaffTaskLink.find({ from: { $in: ids }, kind: 'blocks' }).select('to').lean()).map((l) => l.to),

  /**
   * For a page of tasks: how many unfinished tasks each is waiting on. An archived
   * blocker no longer holds anything up. Two indexed reads, bounded by the page.
   * @returns {Promise<Map<string, number>>}
   */
  openBlockerCounts: async (taskIds) => {
    if (!taskIds.length) return new Map();
    const links = await StaffTaskLink.find({ to: { $in: taskIds }, kind: 'blocks' }).select('from to').lean();
    if (!links.length) return new Map();
    const open = await StaffTask.find({ _id: { $in: [...new Set(links.map((l) => String(l.from)))] }, bucket: 'open' }).select('_id').lean();
    const live = new Set(open.map((t) => String(t._id)));
    const counts = new Map();
    for (const l of links) if (live.has(String(l.from))) counts.set(String(l.to), (counts.get(String(l.to)) ?? 0) + 1);
    return counts;
  },

  /** Tasks matching a T-number or words in the title, within `visible`; newest first, at most `limit`. */
  search: (visible, { number, title, not, limit }) => StaffTask.find({
    ...visible,
    bucket: { $in: ['open', 'done'] },
    _id: { $nin: not },
    ...(number != null ? { number } : title ? { title } : {}),
  }).select(LINK_FIELDS).sort({ _id: -1 }).limit(limit).lean(),
};

export default staffTaskLinkRepository;
