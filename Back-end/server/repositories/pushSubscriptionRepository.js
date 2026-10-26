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
  touch: (ids) => PushSubscription.updateMany({ _id: { $in: ids } }, { $set: { lastSentAt: new Date() } }),
};

export default pushSubscriptionRepository;
