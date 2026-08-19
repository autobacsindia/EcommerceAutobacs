import auditLogRepository from "../repositories/auditLogRepository.js";

/**
 * Service to handle audit logging for admin actions and critical system events.
 */
const auditLogger = {
  /**
   * Log an action to the audit log.
   *
   * @param {Object} req      Express request (for user / IP / user-agent)
   * @param {String} action   CREATE, UPDATE, DELETE, LOGIN, …
   * @param {String} resource Resource type being acted on (User, Product, Order…)
   * @param {String} [resourceId]
   * @param {Object} [details]
   * @param {String} [status] SUCCESS | FAILURE
   * @returns {Promise<object|null>} the saved row, or null if it could not be saved
   */
  logAction: async (req, action, resource, resourceId = null, details = {}, status = 'SUCCESS') => {
    // NOTE: this used to `return` early when there was no authenticated user.
    // That discarded exactly the rows worth keeping — a rejected admin action or
    // a failed login. `user` is nullable in the schema, so record it anyway.
    const entry = {
      user: req?.user?._id ?? null,
      userEmail: req?.user?.email ?? null,
      action,
      resource,
      resourceId: resourceId != null ? String(resourceId) : null,
      details,
      ipAddress: req?.headers?.['cf-connecting-ip'] || req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.headers?.['user-agent'],
      status,
    };

    // Fire and forget: auditing must never block or break the audited operation.
    // `record()` swallows its own errors but logs them loudly, so a failure is
    // visible in the logs rather than silent as it was before.
    return auditLogRepository.create(entry);
  },
};

export default auditLogger;
