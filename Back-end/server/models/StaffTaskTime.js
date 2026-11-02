import mongoose from 'mongoose';

/**
 * Time spent on a staff task: one row per timer run or per time added by hand.
 * Written by services/staffTaskTimeService.js.
 *
 * A running timer is a row with `running: true` and no `seconds` yet. One person
 * has at most one: { user } is unique among running rows, so a double-clicked
 * Start or a second tab cannot start two. Stopping unsets `running` and stores
 * `seconds`, which is the amount every total adds up — totals are summed from
 * these rows when shown, never kept as a counter on the task that could drift.
 *
 * The task's number and title are copied in, so a running timer still reads
 * right for someone later taken off the task. Rows are the record of work done
 * and do not expire.
 */
export const TIME_SOURCES = Object.freeze(['timer', 'manual']);

const StaffTaskTimeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: '' },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTask', required: true },
    number: { type: Number, required: true },
    title: { type: String, default: '' },
    source: { type: String, enum: TIME_SOURCES, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    /** The amount: null while the timer runs, set when it stops or is added by hand. */
    seconds: { type: Number, default: null, min: 0 },
    /** The IST day the time counts for (YYYY-MM-DD). */
    day: { type: String, required: true },
    note: { type: String, default: '', maxlength: 200 },
    running: { type: Boolean, default: undefined },
    /** Left running past the limit and stopped there, so the person can correct it. */
    autoStopped: { type: Boolean, default: undefined },
    edited: { type: Boolean, default: undefined },
    /** Time added by hand: the browser's key, so a retried "Add" adds once. */
    clientId: { type: String, default: undefined, maxlength: 64 },
  },
  { timestamps: true, collection: 'stafftasktime' },
);

// Also built at startup by config/db.js ensureCriticalIndexes, same names.
StaffTaskTimeSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { running: { $eq: true } }, name: 'staff_task_time_running' },
);
// A task's entries, newest first, and the totals for a page of tasks.
StaffTaskTimeSchema.index({ task: 1, _id: -1 }, { name: 'staff_task_time_task' });
StaffTaskTimeSchema.index(
  { user: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } }, name: 'staff_task_time_client_id' },
);

export default mongoose.models.StaffTaskTime || mongoose.model('StaffTaskTime', StaffTaskTimeSchema);
