/**
 * Audit Log Model
 *
 * Persistent audit trail for security-sensitive admin actions: who did what, to
 * which resource, from where.
 *
 * ─── WHY THIS FILE WAS REWRITTEN (2026-08-19) ────────────────────────────────
 * Audit logging was silently dead for 153 days. The collection held 45 documents,
 * all from 2026-03-19, while admins deleted products and changed orders daily.
 *
 * The schema described a different system than the code wrote:
 *   - it required `adminId` + `adminEmail`; every writer sends `user`
 *   - `action` was a closed enum of 8 values; writers send CREATE/UPDATE/DELETE/LOGIN
 *   - it indexed `timestamp`; documents only ever had `createdAt`
 * So every write failed validation twice over — and all three call sites caught
 * the error and console.error'd it, so nothing ever surfaced.
 *
 * Two rules follow from that, and both are load-bearing:
 *   1. `action` is a FREE STRING, not an enum. A closed enum on an audit log is a
 *      footgun: adding a new admin action silently stops it being recorded, which
 *      is precisely the failure above. Validate audit data loosely; losing the
 *      record is worse than recording an odd value.
 *   2. Only `action` is required. A failed login has no `user` and possibly no
 *      `ipAddress` — that is exactly the event most worth keeping.
 *
 * Retention: 2 years (see the TTL at the bottom).
 */

import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  // Who performed the action. NOT required: anonymous/failed actions (a rejected
  // login, an unauthenticated admin attempt) are the most security-relevant rows.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // Denormalised so the row stays readable if the user is later deleted.
  userEmail: {
    type: String,
    default: null,
  },

  // What happened, e.g. CREATE / UPDATE / DELETE / LOGIN / CACHE_CLEAR /
  // SESSION_REVOKE_ALL. Deliberately NOT an enum — see the header.
  action: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
  },

  // What it happened to: the resource TYPE ("Product", "Order", "User", "Cache").
  resource: {
    type: String,
    default: null,
  },

  // String, not ObjectId: some targets are not Mongo documents (a cache key,
  // a config name), and an audit row must never fail to save over a cast error.
  resourceId: {
    type: String,
    default: null,
  },

  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },

  // Request context.
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },

  // Outcome.
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILURE'],
    default: 'SUCCESS',
    uppercase: true,
  },

  errorMessage: { type: String, default: null },
}, {
  timestamps: true, // createdAt is the authoritative time; there is no `timestamp` field
});

// Matches the indexes that actually exist in production and the queries that use
// them. All keyed on createdAt — the field documents actually carry.
AuditLogSchema.index({ user: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ resource: 1 });

// Retention: 2 years. Long enough for a dispute or an insider investigation to
// look back, bounded so the collection cannot grow forever. Volume is tiny
// (tens of rows/month), so this is hygiene, not a cost control.
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });

/**
 * Accept the three historical payload shapes and normalise to one.
 *
 * Callers disagree on field names (`adminId`/`user`, `resourceType`/`resource`,
 * `success`/`status`). Rather than break existing call sites — which is how this
 * system died last time — translate here and keep one shape on disk.
 *
 * @param {object} data raw payload from any caller
 * @returns {object} normalised document
 */
export function normalizeAuditEntry(data = {}) {
  const status = data.status
    ?? (data.success === false ? 'FAILURE' : data.success === true ? 'SUCCESS' : undefined);

  return {
    user: data.user ?? data.adminId ?? null,
    userEmail: data.userEmail ?? data.adminEmail ?? null,
    action: data.action,
    resource: data.resource ?? data.resourceType ?? data.targetResourceType ?? null,
    // `targetUserId` is redisMonitor's name for the subject of a session-revoke.
    // Without it here the row would record that sessions were revoked but not
    // whose — the single most important detail of that event.
    resourceId: data.resourceId != null ? String(data.resourceId)
      : data.targetResourceId != null ? String(data.targetResourceId)
        : data.targetUserId != null ? String(data.targetUserId)
          : null,
    // `metadata` was auditMiddleware's name for the same thing.
    details: data.details ?? data.metadata ?? {},
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
    status: status ? String(status).toUpperCase() : 'SUCCESS',
    errorMessage: data.errorMessage ?? null,
  };
}

/**
 * The one way to write an audit row.
 *
 * Never throws — a failed audit write must not break the operation being audited.
 * But it is LOUD: the previous silent `console.error` is why nobody noticed 153
 * days of nothing. Failures log with a greppable marker and return null so a
 * caller can react if it wants to.
 *
 * @returns {Promise<object|null>} the saved document, or null if it could not be saved
 */
AuditLogSchema.statics.record = async function record(data) {
  const entry = normalizeAuditEntry(data);
  try {
    const log = await this.create(entry);
    return log;
  } catch (err) {
    console.error(
      `[AuditLog] ✗ AUDIT WRITE FAILED — action=${entry.action} resource=${entry.resource} ` +
      `user=${entry.user}: ${err.message}`
    );
    return null;
  }
};

/** Back-compat alias for the older call sites. */
AuditLogSchema.statics.logAction = function logAction(data) {
  return this.record(data);
};

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

export default AuditLog;
