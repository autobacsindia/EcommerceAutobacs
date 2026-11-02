import mongoose from 'mongoose';
import StaffTaskTime from '../models/StaffTaskTime.js';

/** A timer left running stops itself here: 10 hours. Totals never count one past it. */
export const TIMER_CAP_SECONDS = 10 * 60 * 60;
const CAP_MS = TIMER_CAP_SECONDS * 1000;

/**
 * The seconds a row counts for at `now`: what was stored, or — for a timer
 * still running — how long it has run, never more than `capMs`.
 */
const secondsAt = (now, capMs) => ({
  $ifNull: ['$seconds', { $floor: { $divide: [{ $min: [{ $max: [{ $subtract: [now, '$startedAt'] }, 0] }, capMs] }, 1000] } }],
});

const asIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));

/**
 * Time on staff tasks (models/StaffTaskTime.js). Data access only — who may
 * track and change time lives in services/staffTaskTimeService.js.
 */
const staffTaskTimeRepository = {
  model: StaffTaskTime,

  /** `user`'s running timer, or null. One range of staff_task_time_running. */
  findRunning: (user) => StaffTaskTime.findOne({ user, running: true }).lean(),

  /** Start a timer. Throws E11000 when `user` already has one running. */
  insert: async (row) => (await StaffTaskTime.create(row)).toObject(),

  /**
   * Stop the running row `id`. Only the call that still finds it running gets it
   * back; a second Stop, or one racing another tab, gets null.
   */
  close: (id, { endedAt, seconds, autoStopped }) => StaffTaskTime.findOneAndUpdate(
    { _id: id, running: true },
    { $set: { endedAt, seconds, ...(autoStopped ? { autoStopped: true } : {}) }, $unset: { running: '' } },
    { new: true, lean: true },
  ),

  /** Time added by hand earlier under this browser key (restating the partial filter). */
  findByClientId: (user, clientId) => StaffTaskTime.findOne({ user, clientId: { $eq: clientId, $type: 'string' } }).lean(),

  findOnTask: (task, id) => StaffTaskTime.findOne({ _id: id, task }).lean(),

  /** Change a stopped row; null when it is gone or has started running (it never does). */
  update: (task, id, set) => StaffTaskTime.findOneAndUpdate(
    { _id: id, task, running: { $exists: false } },
    { $set: { ...set, edited: true } },
    { new: true, lean: true },
  ),

  remove: async (task, id) => (await StaffTaskTime.deleteOne({ _id: id, task })).deletedCount,

  /** A task's rows, newest first, `limit` of them below `before` (an _id). */
  page: (task, { before, limit }) => StaffTaskTime.find({ task, ...(before ? { _id: { $lt: before } } : {}) })
    .sort({ _id: -1 }).limit(limit).lean(),

  /** Seconds per person on one task, running timers counted up to `now`. */
  totalsByPerson: (task, now, capMs = CAP_MS) => StaffTaskTime.aggregate([
    { $match: { task: new mongoose.Types.ObjectId(String(task)) } },
    { $group: { _id: '$user', name: { $last: '$userName' }, seconds: { $sum: secondsAt(now, capMs) } } },
    { $sort: { seconds: -1, _id: 1 } },
  ]),

  /** Seconds per task for a page of tasks (only tasks with time come back). */
  totalsByTask: (taskIds, now, capMs = CAP_MS) => (taskIds.length ? StaffTaskTime.aggregate([
    { $match: { task: { $in: asIds(taskIds) } } },
    { $group: { _id: '$task', seconds: { $sum: secondsAt(now, capMs) } } },
  ]) : Promise.resolve([])),
};

export default staffTaskTimeRepository;
