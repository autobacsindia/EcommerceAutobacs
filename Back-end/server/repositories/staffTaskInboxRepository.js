import StaffTaskInbox, { INBOX_STATES } from '../models/StaffTaskInbox.js';
import StaffTask from '../models/StaffTask.js';

/** The unread count stops here; the badge shows "99+". */
export const INBOX_UNREAD_CAP = 100;

/** What canSee() reads on a task — enough to say whether an Inbox line still opens. */
const SEE_PROJECTION = Object.freeze({
  number: 1, title: 1, assignee: 1, assignees: 1, team: 1, teams: 1, followers: 1, createdBy: 1, project: 1,
});

/**
 * Staff task Inbox rows (models/StaffTaskInbox.js). Data access only — who gets
 * a row and when lives in services/staffTaskInboxService.js. Every read and
 * write here is scoped to one `user`, and each is a range on staff_task_inbox_list.
 */
const staffTaskInboxRepository = {
  model: StaffTaskInbox,
  states: INBOX_STATES,

  /**
   * Write rows; one whose { user, key } is already there is skipped, the rest
   * still land (unordered). Returns how many were new.
   */
  insertMany: async (rows) => {
    if (!rows.length) return 0;
    try {
      const done = await StaffTaskInbox.insertMany(rows, { ordered: false });
      return done.length;
    } catch (err) {
      // Only duplicates: an earlier attempt already wrote those. Anything else is real.
      const errors = err?.writeErrors ?? (err?.code != null ? [err] : null);
      if (errors && errors.every((e) => (e.code ?? e.err?.code) === 11000)) {
        return err.insertedDocs?.length ?? rows.length - errors.length;
      }
      throw err;
    }
  },

  /** Newest first, `limit` rows, below `before` (an _id) when given. */
  page: (user, { states, before, limit }) => StaffTaskInbox.find({
    user,
    state: states.length === 1 ? states[0] : { $in: states },
    ...(before ? { _id: { $lt: before } } : {}),
  }).sort({ _id: -1 }).limit(limit).lean(),

  /** Unread rows, counted up to `cap` — the badge says "99+" past that. */
  countUnread: (user, cap) => StaffTaskInbox.countDocuments({ user, state: 'unread' }, { limit: cap }),

  /** Change one of `user`'s rows; null when it is not theirs (or gone). */
  setState: (user, id, state) => StaffTaskInbox.findOneAndUpdate(
    { _id: id, user },
    { $set: { state } },
    { new: true, lean: true },
  ),

  /** Every unread row of `user` up to and including `upTo` becomes read. */
  readUpTo: async (user, upTo) => (await StaffTaskInbox.updateMany(
    { user, state: 'unread', _id: { $lte: upTo } },
    { $set: { state: 'read' } },
  )).modifiedCount,

  /** The tasks behind a page of rows, for the "can you still open it" check. */
  tasksFor: (ids) => (ids.length ? StaffTask.find({ _id: { $in: ids } }, SEE_PROJECTION).lean() : []),
};

export default staffTaskInboxRepository;
