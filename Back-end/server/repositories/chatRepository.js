import ChatChannel from '../models/ChatChannel.js';
import ChatMessage from '../models/ChatMessage.js';
import ChatReadState from '../models/ChatReadState.js';

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

  // ── read positions ──
  findReadStates: (user, channelIds) =>
    ChatReadState.find({ user, channel: { $in: channelIds } }).select('channel lastReadSeq lastReadUpdatesSeq').lean(),
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
