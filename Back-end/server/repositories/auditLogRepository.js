import AuditLog from '../models/AuditLog.js';

/**
 * AuditLog data access. Passthrough to the model so the model import stays
 * isolated to the repository layer.
 *
 * Both methods funnel into `AuditLog.record()`, which normalises the three
 * historical payload shapes into one and never throws. Callers previously used
 * `create()` and `logAction()` with incompatible field names, and the mismatch
 * silently killed audit logging for 153 days — see models/AuditLog.js.
 */
class AuditLogRepository {
  /** @returns {Promise<object|null>} saved row, or null if it could not be saved */
  create(data) { return AuditLog.record(data); }

  /** @returns {Promise<object|null>} saved row, or null if it could not be saved */
  logAction(data) { return AuditLog.record(data); }

  find(...args) { return AuditLog.find(...args); }
  countDocuments(...args) { return AuditLog.countDocuments(...args); }
}

export default new AuditLogRepository();
