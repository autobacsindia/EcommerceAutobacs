/**
 * Notification Logger Service
 * Handles logging of all notification attempts to database
 */

import NotificationLog from '../models/NotificationLog.js';
import { v4 as uuidv4 } from 'uuid';

class NotificationLogger {
  /**
   * Log a notification attempt
   * @param {Object} options - Logging options
   * @param {string} options.orderId - Order ID
   * @param {string} options.userId - User ID
   * @param {string} options.type - email or sms
   * @param {string} options.event - Event type
   * @param {string} options.recipient - Email or phone number
   * @param {string} options.provider - sendgrid, twilio, or mock
   * @param {Object} options.result - Result from handler
   * @param {Object} options.metadata - Additional metadata
   * @returns {Promise<Object>} - Created log entry
   */
  async logNotification({ orderId, userId, type, event, recipient, provider, result, metadata = {} }) {
    try {
      const notificationId = uuidv4();
      
      // Prepare metadata
      const logMetadata = {
        ...metadata,
        httpStatusCode: result?.statusCode
      };
      
      // Determine status
      let status = 'retrying';
      if (result?.success) {
        status = 'success';
      } else if (result?.retryable === false || !result?.fallbackToConsole) {
        status = 'failed';
      }
      
      // Create log entry
      const log = await NotificationLog.create({
        notificationId,
        orderId,
        userId,
        type,
        event,
        recipient,
        status,
        attemptCount: result?.attempt || 1,
        provider,
        providerId: result?.messageId || result?.messageSid,
        errorMessage: result?.error,
        metadata: logMetadata
      });
      
      if (process.env.NODE_ENV !== 'test') {
        if (result?.success) {
          console.log(`[NotificationLogger] ✓ Logged successful ${type} notification: ${notificationId}`);
        } else {
          console.log(`[NotificationLogger] ✗ Logged failed ${type} notification: ${notificationId} - ${result?.error}`);
        }
      }
      
      return log;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[NotificationLogger] Failed to log notification:', error.message);
      }
      // Don't throw - logging failures shouldn't break notification flow
      return null;
    }
  }

  /**
   * Log email notification
   * @param {Object} options - Email notification options
   * @returns {Promise<Object>} - Log entry
   */
  async logEmail({ orderId, userId, event, recipient, result, subject }) {
    return this.logNotification({
      orderId,
      userId,
      type: 'email',
      event,
      recipient,
      provider: result?.provider || 'mock',
      result,
      metadata: { subject }
    });
  }

  /**
   * Log SMS notification
   * @param {Object} options - SMS notification options
   * @returns {Promise<Object>} - Log entry
   */
  async logSms({ orderId, userId, event, recipient, result, messagePreview }) {
    return this.logNotification({
      orderId,
      userId,
      type: 'sms',
      event,
      recipient,
      provider: result?.provider || 'mock',
      result,
      metadata: { messagePreview }
    });
  }

  /**
   * Update notification log status
   * @param {string} notificationId - Notification ID
   * @param {string} status - New status
   * @param {Object} updates - Additional updates
   * @returns {Promise<Object>} - Updated log entry
   */
  async updateStatus(notificationId, status, updates = {}) {
    try {
      const log = await NotificationLog.findOne({ notificationId });
      
      if (!log) {
        console.error(`[NotificationLogger] Notification log not found: ${notificationId}`);
        return null;
      }
      
      log.status = status;
      
      if (updates.providerId) {
        log.providerId = updates.providerId;
      }
      
      if (updates.errorMessage) {
        log.errorMessage = updates.errorMessage;
      }
      
      if (updates.attemptCount) {
        log.attemptCount = updates.attemptCount;
      }
      
      await log.save();
      
      return log;
    } catch (error) {
      console.error('[NotificationLogger] Failed to update notification status:', error.message);
      return null;
    }
  }

  /**
   * Get notification logs for an order
   * @param {string} orderId - Order ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Array of log entries
   */
  async getOrderLogs(orderId, options = {}) {
    try {
      const query = { orderId };
      
      if (options.type) {
        query.type = options.type;
      }
      
      if (options.status) {
        query.status = options.status;
      }
      
      const logs = await NotificationLog.find(query)
        .sort({ createdAt: -1 })
        .limit(options.limit || 50);
      
      return logs;
    } catch (error) {
      console.error('[NotificationLogger] Failed to get order logs:', error.message);
      return [];
    }
  }

  /**
   * Get notification statistics for an order
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} - Statistics
   */
  async getOrderStats(orderId) {
    try {
      const stats = await NotificationLog.getOrderStats(orderId);
      return stats;
    } catch (error) {
      console.error('[NotificationLogger] Failed to get order stats:', error.message);
      return null;
    }
  }

  /**
   * Get recent failed notifications for monitoring
   * @param {number} hours - Look back hours (default 24)
   * @param {number} limit - Max results (default 100)
   * @returns {Promise<Array>} - Failed notifications
   */
  async getRecentFailures(hours = 24, limit = 100) {
    try {
      const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const failures = await NotificationLog.find({
        status: 'failed',
        createdAt: { $gte: cutoffDate }
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('orderId', 'status')
        .populate('userId', 'email name');
      
      return failures;
    } catch (error) {
      console.error('[NotificationLogger] Failed to get recent failures:', error.message);
      return [];
    }
  }

  /**
   * Get delivery success rate
   * @param {number} hours - Look back hours (default 24)
   * @returns {Promise<Object>} - Success rate by type
   */
  async getSuccessRate(hours = 24) {
    try {
      const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const stats = await NotificationLog.aggregate([
        {
          $match: {
            createdAt: { $gte: cutoffDate }
          }
        },
        {
          $group: {
            _id: '$type',
            total: { $sum: 1 },
            successful: {
              $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
            },
            failed: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            type: '$_id',
            total: 1,
            successful: 1,
            failed: 1,
            successRate: {
              $multiply: [
                { $divide: ['$successful', '$total'] },
                100
              ]
            }
          }
        }
      ]);
      
      return stats;
    } catch (error) {
      console.error('[NotificationLogger] Failed to get success rate:', error.message);
      return null;
    }
  }
}

// Export singleton instance
export default new NotificationLogger();
