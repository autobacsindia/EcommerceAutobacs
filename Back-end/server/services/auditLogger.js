import auditLogRepository from "../repositories/auditLogRepository.js";

/**
 * Service to handle audit logging for admin actions and critical system events
 */
const auditLogger = {
  /**
   * Log an action to the audit log
   * @param {Object} req - Express request object
   * @param {String} action - Action type (CREATE, UPDATE, DELETE, etc.)
   * @param {String} resource - Resource being acted upon (User, Product, Order, etc.)
   * @param {String} resourceId - ID of the resource (optional)
   * @param {Object} details - Additional details about the action (optional)
   * @param {String} status - Status of the action (SUCCESS, FAILURE)
   */
  logAction: async (req, action, resource, resourceId = null, details = {}, status = 'SUCCESS') => {
    try {
      // Skip logging if no user is authenticated (unless it's a login attempt)
      if (!req.user && action !== 'LOGIN') {
        return;
      }

      const logEntry = {
        user: req.user ? req.user._id : null,
        action,
        resource,
        resourceId: resourceId ? resourceId.toString() : null,
        details,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        status
      };

      // Create log entry asynchronously (fire and forget)
      auditLogRepository.create(logEntry).catch(err => {
        console.error('Failed to create audit log entry:', err);
      });
      
    } catch (error) {
      console.error('Audit logging error:', error);
    }
  }
};

export default auditLogger;
