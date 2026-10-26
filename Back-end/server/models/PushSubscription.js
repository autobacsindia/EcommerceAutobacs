import mongoose from 'mongoose';

/**
 * A browser / phone that agreed to receive push notifications (services/pushService.js).
 * One row per device endpoint. A device that logs in as someone else is moved
 * to them (the endpoint is unique), so a shared computer never gets the
 * previous person's notifications; logging out removes it.
 */
const PushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    endpoint: { type: String, required: true, maxlength: 1000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
    userAgent: { type: String, default: '', maxlength: 300 },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true, name: 'push_endpoint' });
PushSubscriptionSchema.index({ user: 1 }, { name: 'push_user' });

export default mongoose.models.PushSubscription || mongoose.model('PushSubscription', PushSubscriptionSchema);
