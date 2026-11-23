import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Append-only record of every HR change: who, when, what, old → new, why.
 *
 * Separate from models/AuditLog.js on purpose: that collection expires after two
 * years (TTL), while salary, attendance and leave records must be kept for years
 * (Indian wage/PF record-keeping). There is NO TTL here.
 *
 * `changes` holds only the changed fields, with sensitive values already masked
 * by the writer (services/hr/audit.js) — a PAN or bank number never lands here
 * in clear text.
 */
const ChangeSchema = new mongoose.Schema({
  field: { type: String, required: true, maxlength: 80 },
  from: { type: mongoose.Schema.Types.Mixed, default: null },
  to: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const HrAuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, maxlength: 80 }, // free string, see AuditLog.js for why
  entity: { type: String, required: true, maxlength: 60 }, // 'EmployeeProfile', 'PayrollRun', …
  entityId: { type: ObjectId, default: null },
  subject: { type: ObjectId, ref: 'EmployeeProfile', default: null }, // whose record
  actor: { type: ObjectId, ref: 'User', default: null }, // null = system (cron)
  actorName: { type: String, default: 'system', maxlength: 120 },
  reason: { type: String, default: '', maxlength: 1000 },
  changes: { type: [ChangeSchema], default: [] },
  requestId: { type: String, default: '', maxlength: 80 },
}, { timestamps: { createdAt: true, updatedAt: false } });

HrAuditLogSchema.index({ subject: 1, createdAt: -1, _id: -1 }, { name: 'hr_audit_subject_created' });
HrAuditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 }, { name: 'hr_audit_entity_created' });

const appendOnly = function appendOnly(next) { next(new Error('HrAuditLog is append-only')); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  HrAuditLogSchema.pre(op, appendOnly);
}

export default mongoose.models.HrAuditLog || mongoose.model('HrAuditLog', HrAuditLogSchema);
