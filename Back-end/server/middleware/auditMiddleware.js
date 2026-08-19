import auditLogRepository from "../repositories/auditLogRepository.js";

/**
 * Log an admin action to the database.
 *
 * Goes through the repository (and therefore `AuditLog.record()`), which
 * normalises field names and never throws. `resourceType` here is translated to
 * the canonical `resource` — see models/AuditLog.js.
 *
 * @param {Object} params
 * @param {Object} [req] express request, for user / IP / user-agent fallbacks
 * @returns {Promise<object|null>} the saved row, or null if it could not be saved
 */
export const logAudit = async ({
  user,
  action,
  resourceType,
  resourceId,
  details,
  status = "SUCCESS",
  metadata
}, req = null) => {
  // NOTE: this used to bail out when no user could be determined. That threw away
  // the most security-relevant events (anonymous or rejected admin attempts).
  // `user` is nullable in the schema now, so the row is written either way.
  return auditLogRepository.create({
    user: user || req?.user?._id || null,
    userEmail: req?.user?.email || null,
    action,
    resourceType,
    resourceId,
    details,
    metadata,
    status,
    ipAddress: req?.headers?.['cf-connecting-ip'] || req?.ip || req?.connection?.remoteAddress,
    userAgent: req?.get?.('user-agent'),
  });
};

/**
 * Attaches `req.logAudit(details, resourceId, overrideAction)` for controllers to
 * call once they know the resource id and the outcome.
 *
 * Usage: router.post('/', protect, admin, auditMiddleware('CREATE', 'Product'), controller)
 */
export const auditMiddleware = (action, resourceType) => {
  return (req, res, next) => {
    req.logAudit = async (details = {}, resourceId = null, overrideAction = null) =>
      logAudit({
        user: req.user?._id,
        action: overrideAction || action,
        resourceType,
        resourceId: resourceId || req.params.id,
        details,
        status: "SUCCESS",
      }, req);

    next();
  };
};
