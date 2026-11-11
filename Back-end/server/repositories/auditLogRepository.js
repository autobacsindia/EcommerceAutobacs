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
  /** Newest actions by these people; `from`/`until` bound the window (index { user, createdAt }). */
  recentByUsers(userIds, limit, { from = null, until = null } = {}) {
    const createdAt = { ...(from ? { $gte: from } : {}), ...(until ? { $lt: until } : {}) };
    return AuditLog.find({ user: { $in: userIds }, ...(from || until ? { createdAt } : {}) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('user action resource resourceId details createdAt')
      .lean();
  }

  /**
   * Actions per person in [since, until) (index { user, createdAt }). `nDay` counts
   * the ones from `dayStart` on — the chosen day inside the same window, one read.
   */
  countByUserSince(userIds, since, { until = null, dayStart = null } = {}) {
    return AuditLog.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: since, ...(until ? { $lt: until } : {}) } } },
      { $group: {
        _id: '$user', n: { $sum: 1 }, last: { $max: '$createdAt' },
        nDay: { $sum: dayStart ? { $cond: [{ $gte: ['$createdAt', dayStart] }, 1, 0] } : 0 },
      } },
    ]);
  }
}

export default new AuditLogRepository();
