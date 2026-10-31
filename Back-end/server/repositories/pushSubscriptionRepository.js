import PushSubscription from '../models/PushSubscription.js';

/** Push subscriptions (models/PushSubscription.js). Data access only. */
const pushSubscriptionRepository = {
  /** Save a device for `userId` — the same device moves to whoever subscribes last. */
  upsert: (userId, { endpoint, keys, userAgent }) => PushSubscription.findOneAndUpdate(
    { endpoint },
    { $set: { user: userId, keys, userAgent } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean(),
  removeForUser: (userId, endpoint) => PushSubscription.deleteOne({ user: userId, endpoint }),
  removeByEndpoint: (endpoint) => PushSubscription.deleteOne({ endpoint }),
  findForUsers: (userIds) => PushSubscription.find({ user: { $in: userIds } }).select('user endpoint keys').lean(),
  countForUser: (userId) => PushSubscription.countDocuments({ user: userId }),
  findOneForUser: (userId, endpoint) => PushSubscription.findOne({ user: userId, endpoint }).select('user endpoint keys').lean(),
  /** A pop-up got through: the device is healthy again. */
  touch: (ids) => PushSubscription.updateMany({ _id: { $in: ids } }, { $set: { lastSentAt: new Date(), failures: 0, lastError: '' } }),
  /** One more refusal in a row; returns the new count (0 when the row is already gone). */
  recordFailure: async (id, reason) => {
    const row = await PushSubscription.findOneAndUpdate(
      { _id: id },
      { $inc: { failures: 1 }, $set: { lastError: String(reason).slice(0, 120), lastFailedAt: new Date() } },
      { new: true, projection: { failures: 1 }, timestamps: false },
    ).lean();
    return row?.failures ?? 0;
  },
  removeById: (id) => PushSubscription.deleteOne({ _id: id }),
  /** Devices not seen (re-saved by an open panel) since `before`. */
  removeNotSeenSince: (before) => PushSubscription.deleteMany({ updatedAt: { $lt: before } }),
  /** Every device, for the admin's "who has pop-ups" list. Small: one row per staff browser. */
  listAll: (limit) => PushSubscription.find({})
    .select('user userAgent createdAt updatedAt lastSentAt failures lastError lastFailedAt')
    .sort({ user: 1, updatedAt: -1 })
    .limit(limit)
    .lean(),
};

export default pushSubscriptionRepository;
