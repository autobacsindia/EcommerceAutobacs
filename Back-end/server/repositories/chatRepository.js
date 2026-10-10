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
  findByClientId: (channel, sender, clientId) =>
    ChatMessage.findOne({ channel, sender, clientId }).populate('sender', SENDER_FIELDS).lean(),
  findMessagesAfter: (channel, after, limit) =>
    ChatMessage.find({ channel, seq: { $gt: after } }).sort({ seq: 1 }).limit(limit)
      .populate('sender', SENDER_FIELDS).lean(),
  findMessagesBefore: (channel, before, limit) =>
    ChatMessage.find(before != null ? { channel, seq: { $lt: before } } : { channel })
      .sort({ seq: -1 }).limit(limit).populate('sender', SENDER_FIELDS).lean(),
  createMessage: async (doc) => (await ChatMessage.create(doc)).toObject(),
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
