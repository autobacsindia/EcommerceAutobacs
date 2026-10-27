import mongoose from 'mongoose';

/**
 * One comment on a staff task (models/StaffTask.js). Its own collection rather
 * than an array on the task, so a long conversation never grows the task
 * document every list reads, and comments page with a keyset cursor.
 *
 * Who may read and write them is the task's own visibility
 * (services/staffTaskService.js). Never deleted.
 */
const StaffTaskCommentSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTask', required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
    text: { type: String, required: true, maxlength: 2000 },
    /** The browser's id for this comment, so a double-send posts once. */
    clientId: { type: String, default: undefined, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Also built at startup by config/db.js ensureCriticalIndexes, same names.
StaffTaskCommentSchema.index({ task: 1, _id: -1 }, { name: 'staff_task_comment_task' });
StaffTaskCommentSchema.index(
  { by: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } }, name: 'staff_task_comment_client_id' },
);

export default mongoose.models.StaffTaskComment || mongoose.model('StaffTaskComment', StaffTaskCommentSchema);
