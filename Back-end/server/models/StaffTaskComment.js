import mongoose from 'mongoose';
import { FileSchema } from './StaffTask.js';

/**
 * One comment on a staff task (models/StaffTask.js). Its own collection rather
 * than an array on the task, so a long conversation never grows the task
 * document every list reads, and comments page with a keyset cursor.
 *
 * Who may read and write them is the task's own visibility
 * (services/staffTaskService.js). Never removed: the author may edit or delete
 * their own for 30 minutes, and both are SOFT — earlier words stay in `edits`
 * and a deleted comment keeps its text, like team chat. Only what people see
 * changes ("edited", "This comment was deleted.").
 */
const ReactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    users: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

const StaffTaskCommentSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTask', required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
    /** Empty only when the comment is files alone. */
    text: { type: String, default: '', maxlength: 12000 }, // words ≤ COMMENT_MAX; formatted HTML may be longer
    /** The browser's id for this comment, so a double-send posts once. */
    clientId: { type: String, default: undefined, maxlength: 64 },
    /** People addressed with @Name — each could see the task when it was written. */
    mentions: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
    attachments: { type: [FileSchema], default: undefined },
    reactions: { type: [ReactionSchema], default: undefined },
    editedAt: { type: Date, default: null },
    /** Earlier words, oldest first (kept for the record; never sent to a browser). */
    edits: { type: [{ _id: false, text: String, at: Date }], default: undefined },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Someone asked to act on this comment; it stays on their list until resolved. */
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
    assignedAt: { type: Date, default: undefined },
    resolvedAt: { type: Date, default: undefined },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Also built at startup by config/db.js ensureCriticalIndexes, same names.
StaffTaskCommentSchema.index({ task: 1, _id: -1 }, { name: 'staff_task_comment_task' });
StaffTaskCommentSchema.index(
  { by: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } }, name: 'staff_task_comment_client_id' },
);

// "Assigned comments": one person's open or resolved ones, newest first.
StaffTaskCommentSchema.index({ assignedTo: 1, resolvedAt: 1, _id: -1 }, { name: 'staff_task_comment_assigned' });

export default mongoose.models.StaffTaskComment || mongoose.model('StaffTaskComment', StaffTaskCommentSchema);
