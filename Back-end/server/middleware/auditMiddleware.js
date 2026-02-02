import AuditLog from "../models/AuditLog.js";

/**
 * Log an admin action to the database
 * @param {Object} params - The log parameters
 * @param {Object} req - The express request object (optional, for IP/User extraction)
 */
export const logAudit = async ({
  user,
  action,
  resourceType,
  resourceId,
  details,
  status = "success",
  metadata
}, req = null) => {
  try {
    const logData = {
      user: user || (req?.user?._id),
      action,
      resourceType,
      resourceId,
      details,
      status,
      metadata,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.get('user-agent')
    };

    // Ensure we have a user
    if (!logData.user) {
      console.warn("Audit log attempted without user ID");
      // We can still log it if it's a system action or anonymous, but schema requires user.
      // For now, we'll skip or handle if user is missing (e.g., failed login).
      // If req.user is missing but it's a critical failure, we might want to allow it or use a system user ID.
      return;
    }

    await AuditLog.create(logData);
  } catch (error) {
    console.error("Failed to create audit log:", error);
    // Don't throw error to prevent blocking the main request
  }
};

/**
 * Middleware to log successful requests for specific routes
 * Usage: router.post('/', protect, admin, auditLog('CREATE_PRODUCT', 'Product'), controller)
 */
export const auditMiddleware = (action, resourceType) => {
  return (req, res, next) => {
    // We hook into the response 'finish' event to log after the request is done
    // This allows us to capture the status and potentially the response body (if we wrapped send)
    // However, for simplicity and reliability, we'll just log successful completion of the middleware chain
    // OR we can explicitly call logAudit in controllers.
    
    // Better approach for middleware: Attach a logger to req and let controller call it, 
    // or log on success if we can determine resourceId.
    
    // For now, let's provide a helper on req
    req.logAudit = async (details = {}, resourceId = null, overrideAction = null) => {
      await logAudit({
        user: req.user._id,
        action: overrideAction || action,
        resourceType,
        resourceId: resourceId || req.params.id,
        details,
        status: "success"
      }, req);
    };

    next();
  };
};
