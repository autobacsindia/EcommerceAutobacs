import mongoose from 'mongoose';

/**
 * A piece of work given to one person in the staff panel ("T-1042").
 *
 * Who may give a task to whom, and who sees it, lives in
 * services/staffTaskService.js. In short: the admin gives tasks to anyone, a team
 * head to people in their own team, a member only to themselves.
 *
 *   status    to do → in progress → waiting → done   (any order; done can be reopened)
 *   bucket    'open' | 'done' | 'archived' — which list the task is in. Derived
 *             from status + archive on every write, and the leading key of every
 *             list index, so a list never scans another bucket's rows.
 *   rank      the sort key inside a bucket (see rankFor in the service): the due
 *             day for open tasks (no due day sorts last), and newest-finished-first
 *             for done ones. One key means one index per list serves both buckets.
 *   rev       bumped on every change; an edit names the rev it was made against, so
 *             two people editing at once cannot silently overwrite each other.
 *
 * Never deleted: "delete" archives it, and the history stays — like team chat,
 * tasks are part of the company record.
 */

const OrderRefSchema = new mongoose.Schema(
  {
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    // Snapshotted (invoiceService.orderNumber), so the task reads the same as the invoice.
    code: { type: String, required: true, maxlength: 40 },
  },
  { _id: false },
);

const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    action: { type: String, required: true }, // created, status, assignee, due, priority, edited, archived, restored
    from: { type: String, default: '' },
    to: { type: String, default: '' },
  },
  { _id: false },
);

export const TASK_STATUSES = Object.freeze(['todo', 'in_progress', 'waiting', 'done']);
export const TASK_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);
export const TASK_BUCKETS = Object.freeze(['open', 'done', 'archived']);

const StaffTaskSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 4000 },
    status: { type: String, enum: TASK_STATUSES, default: 'todo', required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal', required: true },
    /** IST calendar day, 'YYYY-MM-DD' — a day, not an instant, so "due today" means the same thing to everyone. */
    dueOn: { type: String, default: null },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assigneeName: { type: String, default: '' },
    /** The assignee's team when it was given (null for the admin's own tasks) — whose head sees it. */
    team: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    order: { type: OrderRefSchema, default: null },
    /**
     * Set when one task was given to several people: each person has their own
     * copy, and every copy carries the same `group` (and how many there were).
     */
    group: { type: mongoose.Schema.Types.ObjectId, default: null },
    groupSize: { type: Number, default: undefined },
    bucket: { type: String, enum: TASK_BUCKETS, default: 'open', required: true },
    rank: { type: String, required: true },
    rev: { type: Number, default: 1 },
    completedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    commentCount: { type: Number, default: 0 },
    lastCommentAt: { type: Date, default: null },
    /**
     * The browser's id for this create, so a double-click or a retried request makes
     * one task. A copy for one of several people stores `<clientId>.<personId>`.
     */
    clientId: { type: String, default: undefined, maxlength: 100 },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);

/*
  Every index below is also built at startup by config/db.js ensureCriticalIndexes
  (autoIndex is off in production), under the same names. Each list is
  equality(person or team) + equality(bucket) + range/sort(rank, _id): the keyset
  page and the overdue / due-today filters are both a single index range.
*/
StaffTaskSchema.index({ number: 1 }, { unique: true, name: 'staff_task_number' });
StaffTaskSchema.index({ assignee: 1, bucket: 1, rank: 1, _id: 1 }, { name: 'staff_task_assignee' });
StaffTaskSchema.index({ team: 1, bucket: 1, rank: 1, _id: 1 }, { name: 'staff_task_team' });
StaffTaskSchema.index({ createdBy: 1, bucket: 1, rank: 1, _id: 1 }, { name: 'staff_task_creator' });
StaffTaskSchema.index({ bucket: 1, rank: 1, _id: 1 }, { name: 'staff_task_all' });
// The copies of one task given to several people. Partial: most tasks have no group.
StaffTaskSchema.index({ group: 1 }, { partialFilterExpression: { group: { $type: 'objectId' } }, name: 'staff_task_group' });
// `$type`, not `$ne`/`$exists: true` on null — MongoDB rejects `$ne` in a partialFilterExpression.
StaffTaskSchema.index(
  { createdBy: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } }, name: 'staff_task_client_id' },
);

export default mongoose.models.StaffTask || mongoose.model('StaffTask', StaffTaskSchema);
