import ChatCall from '../models/ChatCall.js';

/**
 * Team-chat call records (models/ChatCall.js). Decisions — who may do what, and
 * which state may move to which — live in services/chatCallService.js; every
 * write here is a conditional update so the service's races settle in the database.
 */
const chatCallRepository = {
  create: async (doc) => (await ChatCall.create(doc)).toObject(),
  findById: (id) => ChatCall.findById(id).lean(),
  findLiveInChannel: (channelId) => ChatCall.findOne({ channel: channelId, live: true }).lean(),
  findLiveFor: (userId) => ChatCall.findOne({ live: true, $or: [{ caller: userId }, { callee: userId }] }).lean(),
  /** Is this person ringing or on any call right now? */
  isOnCall: (userId) => ChatCall.exists({ live: true, $or: [{ caller: userId }, { callee: userId }] }),
  /** Update a call only if it still matches `filter` (its current state); null if it no longer does. */
  updateIf: (filter, update) => ChatCall.findOneAndUpdate(filter, update, { new: true, lean: true }),
  /** Live calls the sweep should end: ring ran out, or a side went silent. Bounded. */
  findDue: (filter, now, stale, limit = 200) => ChatCall.find({
    live: true,
    ...filter,
    $or: [
      { status: 'ringing', ringUntil: { $lte: now } },
      { status: 'active', $or: [{ callerSeenAt: { $lt: stale } }, { calleeSeenAt: { $lt: stale } }] },
    ],
  }).select('_id status').limit(limit).lean(),
};

export default chatCallRepository;
