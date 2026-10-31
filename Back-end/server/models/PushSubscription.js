import mongoose from 'mongoose';

/**
 * A browser / phone that agreed to receive push notifications (services/pushService.js).
 * One row per device endpoint. A device that logs in as someone else is moved
 * to them (the endpoint is unique), so a shared computer never gets the
 * previous person's notifications; logging out removes it.
 *
 * `updatedAt` is "last seen": the panel re-saves the device every time it opens
 * on it (lib/push.ts resyncPush) and a pop-up that gets through touches it, so a
 * row untouched for STALE_DAYS belongs to a browser that is gone, and the daily
 * clean-up (pushService.removeStaleDevices) removes it.
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
    /** The last time the push service took a pop-up for this device. */
    lastSentAt: { type: Date, default: null },
    /**
     * Refusals in a row (a 4xx other than 404/410/429, e.g. 403 after the push
     * keys changed). Reset by the next pop-up that gets through; at
     * MAX_FAILURES the device is removed and re-adds itself the next time the
     * panel opens on it. Push-service outages (5xx, timeouts) do not count.
     */
    failures: { type: Number, default: 0 },
    lastError: { type: String, default: '', maxlength: 120 },
    lastFailedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true, name: 'push_endpoint' });
PushSubscriptionSchema.index({ user: 1 }, { name: 'push_user' });

export default mongoose.models.PushSubscription || mongoose.model('PushSubscription', PushSubscriptionSchema);
