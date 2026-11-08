import mongoose from 'mongoose';

/**
 * A link between two staff tasks.
 *
 *   kind 'blocks'   `from` must be finished before `to`: `to` is "waiting on" `from`.
 *   kind 'related'  the two belong together; `from` and `to` mean nothing here.
 *
 * Its own collection, so adding or removing a link is one write and the two tasks
 * can never disagree. `pair` is the two ids in a fixed order: unique, so two
 * tasks have at most one link, and "A blocks B" and "B blocks A" cannot both land
 * however close together they arrive. Links never decide who may see a task.
 */
const StaffTaskLinkSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTask', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTask', required: true },
    kind: { type: String, enum: ['blocks', 'related'], required: true },
    pair: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Also built at startup by config/db.js ensureCriticalIndexes, under the same names.
StaffTaskLinkSchema.index({ pair: 1 }, { unique: true, name: 'staff_task_link_pair' });
StaffTaskLinkSchema.index({ from: 1, kind: 1 }, { name: 'staff_task_link_from' });
StaffTaskLinkSchema.index({ to: 1, kind: 1 }, { name: 'staff_task_link_to' });

export default mongoose.models.StaffTaskLink || mongoose.model('StaffTaskLink', StaffTaskLinkSchema);
