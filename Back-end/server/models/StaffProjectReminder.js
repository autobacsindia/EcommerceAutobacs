import mongoose from 'mongoose';

/**
 * One row per project owner per IST day: the morning "your projects" reminder
 * (services/projectReminderService.js).
 *
 * The unique (user, day) index is what makes it once a day: the panel pop-up
 * and the 10:00 cron both upsert the same row, and the phone notification is
 * sent only by whoever moves `push` from 'pending' to 'sending' — a retried or
 * doubled cron run finds it already claimed and sends nothing.
 */
export const REMINDER_PUSH_STATES = Object.freeze(['pending', 'sending', 'sent', 'skipped', 'failed']);

const StaffProjectReminderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** IST calendar day, 'YYYY-MM-DD'. */
    day: { type: String, required: true },
    /** First time the panel showed the pop-up today. */
    shownAt: { type: Date, default: null },
    /** "Got it" — the pop-up does not come back today. */
    dismissedAt: { type: Date, default: null },
    push: { type: String, enum: REMINDER_PUSH_STATES, default: 'pending' },
    pushedAt: { type: Date, default: null },
    /** Kept ~45 days, then removed (TTL below). */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'staffprojectreminders' },
);

// Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off in production).
StaffProjectReminderSchema.index({ user: 1, day: 1 }, { unique: true, name: 'staff_project_reminder_user_day' });
// The whole row is the thing that expires; scoped by $type so only rows with the date are touched.
StaffProjectReminderSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } }, name: 'staff_project_reminder_ttl' },
);

export default mongoose.models.StaffProjectReminder || mongoose.model('StaffProjectReminder', StaffProjectReminderSchema);
