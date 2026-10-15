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
  /** Newest messages carrying at least one attachment — the channel's Files tab. */
  findMessagesWithFiles: (channel, before, limit) =>
    ChatMessage.find({
      channel,
      deletedAt: null,
      'attachments.0': { $exists: true },
      ...(before ? { createdAt: { $lt: new Date(before) } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', SENDER_FIELDS)
      .lean(),
  softDeleteMessage: (id, by, at = new Date()) =>
    ChatMessage.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: at, deletedBy: by } }),

  // ── read positions ──
  findReadStates: (user, channelIds) =>
    ChatReadState.find({ user, channel: { $in: channelIds } }).select('channel lastReadSeq').lean(),
  /** Move a read position forward only (never backwards). */
  advanceRead: (user, channel, seq) =>
    ChatReadState.updateOne({ user, channel }, { $max: { lastReadSeq: seq } }, { upsert: true }),
};

export default chatRepository;
