import ChatChannel from '../models/ChatChannel.js';
import ChatMessage from '../models/ChatMessage.js';
import ChatReadState from '../models/ChatReadState.js';
import ChatStar from '../models/ChatStar.js';
import ChatStatus from '../models/ChatStatus.js';

/**
 * Team-chat data access (channels, messages, read positions). Access decisions
 * live in services/chatService.js — this layer only reads and writes.
 */
const SENDER_FIELDS = 'name role staff';

const chatRepository = {
  // ── channels ──
  countByKeys: (keys) => ChatChannel.countDocuments({ key: { $in: keys } }),
  upsertByKey: (key, doc) =>
    ChatChannel.updateOne({ key }, { $setOnInsert: doc }, { upsert: true }),
  findChannels: (filter, select) => ChatChannel.find(filter).select(select).lean(),
  findChannelById: (id) => ChatChannel.findById(id).lean(),
  findChannelByKey: (key) => ChatChannel.findOne({ key }).lean(),
  spaceNameTaken: (name) => ChatChannel.exists({ kind: 'space', archived: false, name }),
  createChannel: async (doc) => (await ChatChannel.create(doc)).toObject(),
  /** Add / remove members of a custom space; returns the updated channel (null if not one). */
  addMembers: (id, userIds) => ChatChannel.findOneAndUpdate(
    { _id: id, kind: 'space', audience: 'members', archived: false },
    { $addToSet: { members: { $each: userIds } } },
    { new: true },
  ).lean(),
  /** Delete (archive) a custom group: hidden from everyone, its messages kept as a record. */
  archiveGroup: (id, by) => ChatChannel.findOneAndUpdate(
    { _id: id, kind: 'space', audience: 'members', archived: false, system: { $ne: true } },
    { $set: { archived: true, archivedAt: new Date(), archivedBy: by } },
    { new: true },
  ).lean(),
  removeMember: (id, userId) => ChatChannel.findOneAndUpdate(
    { _id: id, kind: 'space', audience: 'members', archived: false },
    { $pull: { members: userId } },
    { new: true },
  ).lean(),
  /** Atomically take the next message number in a channel. */
  nextSeq: async (channelId, at) => {
    const updated = await ChatChannel.findOneAndUpdate(
      { _id: channelId },
      { $inc: { lastMessageSeq: 1 }, $set: { lastMessageAt: at } },
      { new: true, projection: { lastMessageSeq: 1 } }
    ).lean();
    return updated?.lastMessageSeq ?? null;
  },

  // ── messages ──
  findMessageById: (id) => ChatMessage.findById(id).lean(),
  findMessageWithSender: (id) => ChatMessage.findById(id).populate('sender', SENDER_FIELDS).lean(),
  findByClientId: (channel, sender, clientId) =>
    ChatMessage.findOne({ channel, sender, clientId }).populate('sender', SENDER_FIELDS).lean(),
  findMessagesAfter: (channel, after, limit) =>
    ChatMessage.find({ channel, seq: { $gt: after } }).sort({ seq: 1 }).limit(limit)
      .populate('sender', SENDER_FIELDS).lean(),
  /** The channel timeline: top-level messages, newest activity first (index chat_timeline). */
  findTimelineBefore: (channel, before, limit) =>
    ChatMessage.find({ channel, threadRoot: null, ...(before != null ? { activitySeq: { $lt: before } } : {}) })
      .sort({ activitySeq: -1 }).limit(limit).populate('sender', SENDER_FIELDS).lean(),
  /**
   * A thread's replies, oldest first (index chat_thread_replies).
   * The `$type` is not redundant: the index is partial on it, and the planner
   * only uses a partial index when the query states the filter itself —
   * `{ threadRoot: id }` alone was measured as a full collection scan.
   */
  findThreadReplies: (threadRoot, after, limit) =>
    ChatMessage.find({
      threadRoot: { $eq: threadRoot, $type: 'objectId' },
      ...(after != null ? { seq: { $gt: after } } : {}),
    })
      .sort({ seq: 1 }).limit(limit).populate('sender', SENDER_FIELDS).lean(),
  findOrderThreadRoot: (channel, threadOrder) =>
    ChatMessage.findOne({ channel, threadOrder }).populate('sender', SENDER_FIELDS).lean(),
  /**
   * Record a reply on its root. The summary and activitySeq move only forward:
   * when two replies race, the newer one's summary wins whichever lands last.
   * Returns the root as it now stands.
   */
  bumpThread: async (rootId, { seq, at, preview, by, mentions }) => {
    const bumped = await ChatMessage.findOneAndUpdate(
      { _id: rootId, activitySeq: { $lt: seq } },
      {
        $set: {
          activitySeq: seq, lastReplyAt: at, lastReplyPreview: preview, lastReplyBy: by, lastReplyMentions: mentions,
        },
        $inc: { replyCount: 1 },
      },
      { new: true },
    ).populate('sender', SENDER_FIELDS).lean();
    if (bumped) return bumped;
    return ChatMessage.findOneAndUpdate({ _id: rootId }, { $inc: { replyCount: 1 } }, { new: true })
      .populate('sender', SENDER_FIELDS).lean();
  },
  createMessage: async (doc) => (await ChatMessage.create(doc)).toObject(),
  /**
   * Search message text across a set of channels, newest first.
   *
   * `channels` is resolved by the service from the caller's access rules and
   * passed in already narrowed — this layer never decides who may see what.
   * Deleted messages are excluded here rather than filtered afterwards: their
   * text is withheld by the API, so a hit the reader cannot be shown is a hit
   * that should never have been counted toward the page.
   */
  searchMessages: (channels, q, { before, limit }) =>
    ChatMessage.find({
      channel: { $in: channels },
      deletedAt: null,
      $text: { $search: q },
      ...(before ? { createdAt: { $lt: before } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', SENDER_FIELDS)
      .lean(),
  /**
   * Newest messages carrying at least one attachment — the channel's Files tab.
   * `includeDeleted` is for admins, who see every message: a file its author
   * deleted is still a file the company received.
   */
  findMessagesWithFiles: (channel, before, limit, { includeDeleted = false } = {}) =>
    ChatMessage.find({
      channel,
      ...(includeDeleted ? {} : { deletedAt: null }),
      'attachments.0': { $exists: true },
      ...(before ? { createdAt: { $lt: new Date(before) } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', SENDER_FIELDS)
      .lean(),
  softDeleteMessage: (id, by, at = new Date()) =>
    ChatMessage.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: at, deletedBy: by } }),

  /*
    ── Author edits and deletes ───────────────────────────────────────────────
    Each is ONE conditional write whose filter carries every rule: the author,
    a person's message (not a system post), not already deleted, and sent after
    `notBefore` (the edit window). Checking those in the service and then
    writing would let a request read "inside the window" at 14:59 and land at
    15:01; in the filter, the database is the clock that decides.
  */
  /**
   * Replace the text, keeping the old one in `editHistory`. `fromText` is a
   * compare-and-set: two edits racing from the same version cannot both
   * succeed, so neither silently drops the other from the history.
   * Returns the updated message, or null when no rule allowed the write.
   */
  editOwnMessage: (id, sender, { fromText, toText, notBefore, at = new Date(), keep = 20 }) =>
    ChatMessage.findOneAndUpdate(
      { _id: id, sender, kind: 'user', deletedAt: null, createdAt: { $gte: notBefore }, text: fromText },
      {
        $set: { text: toText, editedAt: at },
        $push: { editHistory: { $each: [{ text: fromText, editedAt: at }], $slice: -keep } },
      },
      { new: true },
    ).populate('sender', SENDER_FIELDS).lean(),
  /**
   * Put `userId`'s `emoji` on a message (`on`) or take it off — one atomic
   * pipeline write, so it is safe to retry (adding twice is one reaction,
   * removing twice is a no-op) and two people reacting at the same moment
   * cannot overwrite each other the way a read-modify-write would.
   *
   * A new emoji is only added while the message has fewer than `max` different
   * ones; the caller tells "capped" from "added" by looking at the result.
   * Deleted messages are left alone. Returns { channel, threadRoot, reactions },
   * or null when the message is gone or deleted.
   */
  setReaction: (id, userId, emoji, on, max) => {
    const e = { $literal: emoji }; // never read as a field path
    const current = { $ifNull: ['$reactions', []] };
    const add = {
      $let: {
        vars: { r: current },
        in: {
          $cond: [
            { $in: [e, '$$r.emoji'] },
            {
              $map: {
                input: '$$r',
                as: 'x',
                in: {
                  $cond: [
                    { $and: [{ $eq: ['$$x.emoji', e] }, { $not: [{ $in: [userId, '$$x.users'] }] }] },
                    { emoji: '$$x.emoji', users: { $concatArrays: ['$$x.users', [userId]] } },
                    '$$x',
                  ],
                },
              },
            },
            { $cond: [{ $lt: [{ $size: '$$r' }, max] }, { $concatArrays: ['$$r', [{ emoji: e, users: [userId] }]] }, '$$r'] },
          ],
        },
      },
    };
    const remove = {
      $filter: {
        input: {
          $map: {
            input: current,
            as: 'x',
            in: { emoji: '$$x.emoji', users: { $filter: { input: '$$x.users', as: 'u', cond: { $ne: ['$$u', userId] } } } },
          },
        },
        as: 'y',
        cond: { $gt: [{ $size: '$$y.users' }, 0] },
      },
    };
    return ChatMessage.findOneAndUpdate(
      { _id: id, deletedAt: null },
      [{ $set: { reactions: on ? add : remove } }],
      { new: true, projection: { channel: 1, threadRoot: 1, reactions: 1 } },
    ).lean();
  },
  /** Soft-delete. Returns the message as it now stands, or null. */
  deleteOwnMessage: (id, sender, { notBefore, at = new Date() }) =>
    ChatMessage.findOneAndUpdate(
      { _id: id, sender, kind: 'user', deletedAt: null, createdAt: { $gte: notBefore } },
      { $set: { deletedAt: at, deletedBy: sender } },
      { new: true },
    ).lean(),

  /*
    Quotes are snapshots, so the quoted words live on in every reply that
    quoted them. Scoped by channel — a quote is always from the same channel
    (chatService enforces it), and the channel prefix keeps this on the
    { channel, seq } index instead of scanning every message in chat.
  */
  /** The quoted message was deleted: flag every quote of it. */
  markQuotesDeleted: (channel, messageId) =>
    ChatMessage.updateMany({ channel, 'quote.message': messageId }, { $set: { 'quote.deleted': true } }),
  /** The quoted message was edited: quotes show the corrected words. */
  refreshQuotePreviews: (channel, messageId, preview) =>
    ChatMessage.updateMany({ channel, 'quote.message': messageId }, { $set: { 'quote.preview': preview } }),

  /** A thread's newest reply that is still visible to everyone, or null. */
  findLatestLiveReply: (threadRoot) =>
    ChatMessage.findOne({ threadRoot, deletedAt: null })
      .sort({ seq: -1 })
      .populate('sender', SENDER_FIELDS)
      .lean(),
  /**
   * Rewrite a thread's "last reply" summary in place. Position (activitySeq)
   * and replyCount are left alone: a deleted reply still sits in the thread as
   * "This message was deleted", and the thread should not jump in the timeline
   * because someone corrected a typo.
   */
  setThreadSummary: (rootId, { preview, by, mentions }) =>
    ChatMessage.findOneAndUpdate(
      { _id: rootId },
      { $set: { lastReplyPreview: preview, lastReplyBy: by, lastReplyMentions: mentions } },
      { new: true },
    ).populate('sender', SENDER_FIELDS).lean(),

  /**
   * Store a link preview — only if the message still says what it said when
   * the preview was fetched (an edit in between would make it the wrong card).
   */
  setPreview: (id, text, preview) =>
    ChatMessage.findOneAndUpdate(
      { _id: id, text, deletedAt: null },
      preview ? { $set: { preview } } : { $unset: { preview: 1 } },
      { new: true, projection: { channel: 1, threadRoot: 1, preview: 1 } },
    ).lean(),

  // ── pins (shared per conversation) ──
  /** Live pinned messages in a channel, newest pin first (index chat_pins). */
  findPins: (channel, limit) =>
    ChatMessage.find({ channel, pinnedAt: { $type: 'date' }, deletedAt: null })
      .sort({ pinnedAt: -1 }).limit(limit).populate('sender', SENDER_FIELDS).lean(),
  countPins: (channel) => ChatMessage.countDocuments({ channel, pinnedAt: { $type: 'date' }, deletedAt: null }),
  /** Pin (only if not already pinned — the first pin's time and author stand). */
  pin: (id, { by, byName, at = new Date() }) =>
    ChatMessage.findOneAndUpdate(
      { _id: id, deletedAt: null, pinnedAt: { $exists: false } },
      { $set: { pinnedAt: at, pinnedBy: by, pinnedByName: byName } },
      { new: true },
    ).lean(),
  unpin: (id) =>
    ChatMessage.findOneAndUpdate(
      { _id: id, pinnedAt: { $exists: true } },
      { $unset: { pinnedAt: 1, pinnedBy: 1, pinnedByName: 1 } },
      { new: true },
    ).lean(),

  // ── status (one row per person; a small collection, one per member of staff) ──
  /** Statuses still in force at `now`. */
  findLiveStatuses: (now = new Date()) =>
    ChatStatus.find({ $or: [{ until: null }, { until: { $gt: now } }] }).select('user text until').lean(),
  setStatus: (user, { text, until }) =>
    ChatStatus.findOneAndUpdate({ user }, { $set: { text, until } }, { upsert: true, new: true }).lean(),
  clearStatus: (user) => ChatStatus.deleteOne({ user }),

  // ── stars (private per person) ──
  /** Star a message. Upsert on the unique { user, message }, so a retry is one star. */
  addStar: (user, message, channel) =>
    ChatStar.updateOne({ user, message }, { $setOnInsert: { channel } }, { upsert: true }),
  removeStar: (user, message) => ChatStar.deleteOne({ user, message }),
  /** Which of `messageIds` has `user` starred? One indexed lookup for a whole page. */
  findStarredAmong: (user, messageIds) =>
    messageIds.length
      ? ChatStar.find({ user, message: { $in: messageIds } }).select('message').lean()
      : Promise.resolve([]),
  /** The Starred list, newest first, keyset on _id. */
  findStars: (user, before, limit) =>
    ChatStar.find({ user, ...(before ? { _id: { $lt: before } } : {}) })
      .sort({ _id: -1 }).limit(limit).select('message channel').lean(),
  findMessagesByIds: (ids) =>
    ChatMessage.find({ _id: { $in: ids } }).populate('sender', SENDER_FIELDS).lean(),

  // ── read positions ──
  findReadStates: (user, channelIds) =>
    ChatReadState.find({ user, channel: { $in: channelIds } }).select('channel lastReadSeq lastReadUpdatesSeq notify').lean(),
  /** Set one person's notification setting for a channel. Leaves read positions alone. */
  setNotify: (user, channel, notify) =>
    ChatReadState.updateOne({ user, channel }, { $set: { notify } }, { upsert: true }),
  /**
   * Who among `users` has quietened `channel` ('mentions' or 'off'). Point
   * lookups on the { user, channel } index — one per person, and the people
   * who can read a channel are a few dozen at most.
   * @returns {Promise<{ user: ObjectId, notify: string }[]>}
   */
  findQuietened: (channel, users) =>
    ChatReadState.find({ user: { $in: users }, channel, notify: { $in: ['mentions', 'off'] } })
      .select('user notify').lean(),
  /**
   * Move a read position forward only (never backwards). `part`: 'chat',
   * 'updates', or 'all' (both — what a client from before the split sends).
   *
   * An update pipeline, because the Order-updates position of an old row is
   * implicit (= lastReadSeq): it is written down from the OLD lastReadSeq first,
   * so moving Chat forward can never silently mark order updates read.
   */
  advanceRead: (user, channel, seq, part = 'all') => {
    const chat = { $ifNull: ['$lastReadSeq', 0] };
    const updates = { $ifNull: ['$lastReadUpdatesSeq', chat] };
    return ChatReadState.updateOne({ user, channel }, [
      {
        $set: {
          lastReadUpdatesSeq: part === 'chat' ? updates : { $max: [updates, seq] },
          lastReadSeq: part === 'updates' ? chat : { $max: [chat, seq] },
        },
      },
    ], { upsert: true });
  },

  /**
   * "Mark as unread": move ONE tab's read position back to `seq` (never
   * forward — a message that is already unread stays where it is). The other
   * tab's position is written down as it stands, exactly as advanceRead does,
   * so an older row with only lastReadSeq does not drag Order updates along.
   */
  moveReadBack: (user, channel, seq, part) => {
    const chat = { $ifNull: ['$lastReadSeq', 0] };
    const updates = { $ifNull: ['$lastReadUpdatesSeq', chat] };
    return ChatReadState.findOneAndUpdate({ user, channel }, [
      {
        $set: {
          lastReadUpdatesSeq: part === 'updates' ? { $min: [updates, seq] } : updates,
          lastReadSeq: part === 'chat' ? { $min: [chat, seq] } : chat,
        },
      },
    ], { upsert: true, new: true }).select('lastReadSeq lastReadUpdatesSeq').lean();
  },

  /**
   * Unread messages that address `user` — by name, their `team`, or @all — per
   * channel. Only asked for channels set to "@mentions only" that have unread,
   * so it walks the same few unread rows as countUnreadByLane.
   * @param {{ channel: ObjectId, chatFrom: number, updatesFrom: number }[]} positions
   * @returns {Promise<{ _id: ObjectId, n: number }[]>}
   */
  countUnreadMentions: (positions, user, team) => {
    if (!positions.length) return Promise.resolve([]);
    const isUpdates = { $or: [{ kind: 'system' }, { lane: 'updates' }] };
    const addressed = [{ mentions: user }, { mentionAll: true }, ...(team ? [{ mentionTeams: team }] : [])];
    // Every branch keeps its own { channel, seq } prefix, so each one is an
    // index range over that channel's unread rows; who is addressed is a filter
    // on those rows (an $and around two $ors would hide the prefix from the planner).
    return ChatMessage.aggregate([
      {
        $match: {
          $or: positions.flatMap((p) => [
            { channel: p.channel, seq: { $gt: p.chatFrom }, kind: { $ne: 'system' }, lane: { $ne: 'updates' }, $or: addressed },
            { channel: p.channel, seq: { $gt: p.updatesFrom }, $and: [isUpdates, { $or: addressed }] },
          ]),
        },
      },
      { $group: { _id: '$channel', n: { $sum: 1 } } },
    ]);
  },

  /**
   * Unread per tab, for the channels that have any: one aggregate over the
   * { channel, seq } index, touching only messages past each read position.
   * @param {{ channel: ObjectId, chatFrom: number, updatesFrom: number }[]} positions
   * @returns {Promise<{ _id: { channel: ObjectId, updates: boolean }, n: number }[]>}
   */
  countUnreadByLane: (positions) => {
    if (!positions.length) return Promise.resolve([]);
    const isUpdates = { $or: [{ kind: 'system' }, { lane: 'updates' }] };
    return ChatMessage.aggregate([
      {
        $match: {
          $or: positions.flatMap((p) => [
            { channel: p.channel, seq: { $gt: p.chatFrom }, kind: { $ne: 'system' }, lane: { $ne: 'updates' } },
            { channel: p.channel, seq: { $gt: p.updatesFrom }, ...isUpdates },
          ]),
        },
      },
      {
        $group: {
          _id: { channel: '$channel', updates: { $or: [{ $eq: ['$kind', 'system'] }, { $eq: ['$lane', 'updates'] }] } },
          n: { $sum: 1 },
        },
      },
    ]);
  },
};

export default chatRepository;
