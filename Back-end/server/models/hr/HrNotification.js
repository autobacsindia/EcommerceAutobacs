import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One phone notification to one employee, keyed by the EVENT (e.g.
 * `leave:<requestId>:approved`). The unique `key` is the idempotency guard: a
 * retried decision, a replayed job or a second cron run finds the row and sends
 * nothing. `sentTo` lists tokens Expo already accepted, so a job retry after a
 * partial failure only sends to the rest.
 *
 * Low volume (a few per employee per month); no TTL — a clean-up, if ever
 * needed, is a cron, never a TTL (CLAUDE.md index rules).
 */
const HrNotificationSchema = new mongoose.Schema({
  key: { type: String, required: true, maxlength: 200 },
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  type: { type: String, required: true, enum: ['leave_decided', 'overtime_decided', 'payslip_ready', 'missed_punch'] },
  title: { type: String, required: true, maxlength: 120 },
  body: { type: String, required: true, maxlength: 300 },
  // Where the app opens on tap: a route inside the app, never a URL.
  path: { type: String, default: '/', maxlength: 100 },
  status: { type: String, enum: ['queued', 'sent', 'no_device', 'failed'], default: 'queued' },
  sentTo: { type: [String], default: [] },
  sentAt: { type: Date, default: null },
  error: { type: String, default: '', maxlength: 300 },
}, { timestamps: true });

HrNotificationSchema.index({ key: 1 }, { name: 'hr_notify_key', unique: true });
HrNotificationSchema.index({ employee: 1, createdAt: -1, _id: -1 }, { name: 'hr_notify_employee_created' });

export default mongoose.models.HrNotification || mongoose.model('HrNotification', HrNotificationSchema);
