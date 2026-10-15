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

  /** Newest actions by these people (index { user, createdAt }). For the admin activity feed. */
  recentByUsers(userIds, limit) {
    return AuditLog.find({ user: { $in: userIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('user action resource resourceId details createdAt')
      .lean();
  }

  /** Actions per person since a date (index { user, createdAt }). */
  countByUserSince(userIds, since) {
    return AuditLog.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: since } } },
      { $group: { _id: '$user', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
    ]);
  }
}

export default new AuditLogRepository();
