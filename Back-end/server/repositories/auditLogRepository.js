import AuditLog from '../models/AuditLog.js';

/**
 * AuditLog data access. Passthrough to the model (incl. the logAction static)
 * so the model import stays isolated to the repository layer.
 */
class AuditLogRepository {
  create(...args) { return AuditLog.create(...args); }
  logAction(...args) { return AuditLog.logAction(...args); }
}

export default new AuditLogRepository();
