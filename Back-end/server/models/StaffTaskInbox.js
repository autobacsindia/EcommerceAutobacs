import mongoose from 'mongoose';

/**
 * One line in a staff member's task Inbox: "Ravi gave you T-42", "Asha mentioned
 * you on T-15", "Priya moved T-30 to Done". Written by
 * services/staffTaskInboxService.js at the same moments the pop-ups are sent, so
 * a pop-up missed on a closed tab is still there to read.
 *
 * One row per person per event. `key` names the event ("t:<task>:r<rev>:status",
 * "c:<comment>"), and { user, key } is unique — a retried request, or a retry that
 * finishes what a failed first attempt left, never makes a second row.
 *
 * The task's number and title are copied in when the row is written, so the line
 * still reads right for someone who is later taken off the task. Rows expire 90
 * days after they were written: this is a feed of what happened, not the record
 * of it (that is the task's own history), so nothing of value is lost.
 */
export const INBOX_KINDS = Object.freeze(['assigned', 'status', 'comment', 'mention', 'subtask']);
export const INBOX_STATES = Object.freeze(['unread', 'read', 'cleared']);
export const INBOX_TTL_SECONDS = 90 * 24 * 60 * 60;

const StaffTaskInboxSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true, maxlength: 120 },
    kind: { type: String, enum: INBOX_KINDS, required: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTask', required: true },
    number: { type: Number, required: true },
    title: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    /** The status it moved to, a comment's first words, the sub-task's name. */
    text: { type: String, default: '', maxlength: 200 },
    state: { type: String, enum: INBOX_STATES, default: 'unread' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'stafftaskinbox' },
);

// Also built at startup by config/db.js ensureCriticalIndexes, same names.
StaffTaskInboxSchema.index({ user: 1, key: 1 }, { unique: true, name: 'staff_task_inbox_key' });
// The list (newest first, unread only or not cleared) and the unread count.
StaffTaskInboxSchema.index({ user: 1, state: 1, _id: -1 }, { name: 'staff_task_inbox_list' });
StaffTaskInboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: INBOX_TTL_SECONDS, name: 'staff_task_inbox_ttl' });

export default mongoose.models.StaffTaskInbox || mongoose.model('StaffTaskInbox', StaffTaskInboxSchema);
