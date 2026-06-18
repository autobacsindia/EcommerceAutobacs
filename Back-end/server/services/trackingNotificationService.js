/**
 * Tracking Notification Service
 * Handles notifications for tracking events
 */

import Order from '../models/Order.js';
import User from '../models/User.js';

/**
 * Email templates for tracking notifications
 */
const EMAIL_TEMPLATES = {
  TRACKING_ADDED: {
    subject: 'Your Order is Being Prepared for Shipment',
    getBody: (order, trackingInfo) => `
Dear ${order.shippingAddress.fullName},

Great news! Your order #${order._id} is being prepared for shipment.

Tracking Details:
- Tracking Number: ${trackingInfo.trackingNumber}
- Carrier: ${trackingInfo.carrier.name}
- Estimated Delivery: ${new Date(trackingInfo.estimatedDelivery).toLocaleDateString()}

You can track your package at:
${trackingInfo.carrier.trackingUrl}

Thank you for shopping with Autobacs India!

Best regards,
Autobacs India Team
    `
  },
  
  PACKAGE_PICKED_UP: {
    subject: 'Your Package Has Been Picked Up',
    getBody: (order, event) => `
Dear ${order.shippingAddress.fullName},

Your order #${order._id} has been picked up by the carrier.

Status: Package Picked Up
Location: ${event.location}
Time: ${new Date(event.timestamp).toLocaleString()}

Track your package: ${order.carrier?.trackingUrl || 'Check your email for tracking link'}

Best regards,
Autobacs India Team
    `
  },

  IN_TRANSIT: {
    subject: 'Your Package is On Its Way',
    getBody: (order, event) => `
Dear ${order.shippingAddress.fullName},

Your order #${order._id} is currently in transit.

Current Location: ${event.location}
Status: ${event.description}
Time: ${new Date(event.timestamp).toLocaleString()}

Estimated Delivery: ${order.estimatedDelivery ? new Date(order.estimatedDelivery).toLocaleDateString() : 'TBD'}

Track your package: ${order.carrier?.trackingUrl || 'Check your email for tracking link'}

Best regards,
Autobacs India Team
    `
  },

  OUT_FOR_DELIVERY: {
    subject: 'Your Package is Out for Delivery Today!',
    getBody: (order, event) => `
Dear ${order.shippingAddress.fullName},

Exciting news! Your order #${order._id} is out for delivery and should arrive today.

Status: Out for Delivery
Location: ${event.location}
Time: ${new Date(event.timestamp).toLocaleString()}

Please ensure someone is available to receive the package.

Delivery Address:
${order.shippingAddress.addressLine1}
${order.shippingAddress.addressLine2 || ''}
${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}

Best regards,
Autobacs India Team
    `
  },

  DELIVERED: {
    subject: 'Your Package Has Been Delivered',
    getBody: (order, event) => `
Dear ${order.shippingAddress.fullName},

Your order #${order._id} has been successfully delivered!

Delivery Time: ${new Date(event.timestamp).toLocaleString()}
Location: ${event.location}

We hope you enjoy your purchase! If you have any questions or concerns, please contact our support team.

Thank you for choosing Autobacs India!

Best regards,
Autobacs India Team
    `
  },

  FAILED_DELIVERY: {
    subject: 'Delivery Attempt Failed for Your Package',
    getBody: (order, event) => `
Dear ${order.shippingAddress.fullName},

We attempted to deliver your order #${order._id}, but were unable to complete the delivery.

Reason: ${event.description}
Attempted: ${new Date(event.timestamp).toLocaleString()}

The carrier will attempt delivery again. Please ensure someone is available to receive the package.

Contact the carrier directly if you need to reschedule delivery.

Best regards,
Autobacs India Team
    `
  },

  EXCEPTION: {
    subject: 'Update on Your Package Delivery',
    getBody: (order, event) => `
Dear ${order.shippingAddress.fullName},

There has been an update regarding your order #${order._id}.

Status: ${event.description}
Location: ${event.location}
Time: ${new Date(event.timestamp).toLocaleString()}

We're working to resolve this and will keep you updated. Your package will be delivered as soon as possible.

Track your package: ${order.carrier?.trackingUrl || 'Check your email for tracking link'}

Best regards,
Autobacs India Team
    `
  }
};

/**
 * SMS templates for tracking notifications (shorter)
 */
const SMS_TEMPLATES = {
  TRACKING_ADDED: (order, trackingInfo) => 
    `Autobacs: Order #${order._id.toString().slice(-8)} is being prepared. Track: ${trackingInfo.trackingNumber}`,
  
  PACKAGE_PICKED_UP: (order) => 
    `Autobacs: Your package has been picked up by ${order.carrier?.name}. Track: ${order.trackingNumber}`,
  
  IN_TRANSIT: (order, event) => 
    `Autobacs: Package in transit. Current location: ${event.location}. ETA: ${new Date(order.estimatedDelivery).toLocaleDateString()}`,
  
  OUT_FOR_DELIVERY: (order) => 
    `Autobacs: Your package is out for delivery today! Order #${order._id.toString().slice(-8)}`,
  
  DELIVERED: (order) => 
    `Autobacs: Package delivered successfully! Thank you for your order #${order._id.toString().slice(-8)}`,
  
  FAILED_DELIVERY: (order, event) => 
    `Autobacs: Delivery attempt failed. ${event.description}. We'll try again soon.`,
  
  EXCEPTION: (order, event) => 
    `Autobacs: Update on your order #${order._id.toString().slice(-8)}: ${event.description}`
};

class TrackingNotificationService {
  /**
   * Send tracking notification
   * @param {string} orderId - Order ID
   * @param {string} eventType - Event type
   * @param {Object} eventData - Event data
   * @returns {Promise<Object>} - Notification result
   */
  async sendTrackingNotification(orderId, eventType, eventData = {}) {
    try {
      const order = await Order.findById(orderId).populate('user', 'name email phone');
      if (!order) {
        throw new Error('Order not found');
      }

      const user = order.user;
      if (!user) {
        throw new Error('User not found');
      }

      // Get notification templates
      const emailTemplate = EMAIL_TEMPLATES[eventType];
      const smsTemplate = SMS_TEMPLATES[eventType];

      if (!emailTemplate && !smsTemplate) {
        console.warn(`No template found for event type: ${eventType}`);
        return {
          success: false,
          message: 'No notification template found'
        };
      }

      const notifications = [];

      // Send email notification
      if (emailTemplate && user.email) {
        const emailResult = await this._sendEmail({
          to: user.email,
          subject: emailTemplate.subject,
          body: emailTemplate.getBody(order, eventData)
        });
        notifications.push({ type: 'email', ...emailResult });
      }

      // Send SMS notification
      if (smsTemplate && order.shippingAddress.phone) {
        const smsResult = await this._sendSMS({
          to: order.shippingAddress.phone,
          message: smsTemplate(order, eventData)
        });
        notifications.push({ type: 'sms', ...smsResult });
      }

      return {
        success: true,
        notifications
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Send email (mock implementation)
   * In production, integrate with SendGrid, AWS SES, etc.
   * @private
   */
  async _sendEmail({ to, subject, body }) {
    try {
      // TODO: Implement actual email sending
      // For now, just log to console
      console.log('📧 Email Notification:');
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body: ${body.substring(0, 100)}...`);

      return {
        success: true,
        sentAt: new Date(),
        channel: 'email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        channel: 'email'
      };
    }
  }

  /**
   * Send SMS (mock implementation)
   * In production, integrate with Twilio, AWS SNS, etc.
   * @private
   */
  async _sendSMS({ to, message }) {
    try {
      // TODO: Implement actual SMS sending
      // For now, just log to console
      console.log('📱 SMS Notification:');
      console.log(`To: ${to}`);
      console.log(`Message: ${message}`);

      return {
        success: true,
        sentAt: new Date(),
        channel: 'sms'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        channel: 'sms'
      };
    }
  }

  /**
   * Notify on tracking added
   */
  async notifyTrackingAdded(orderId, trackingInfo) {
    return await this.sendTrackingNotification(orderId, 'TRACKING_ADDED', trackingInfo);
  }

  /**
   * Notify on tracking event
   */
  async notifyTrackingEvent(orderId, event) {
    let eventType;
    
    // Map tracking status to notification type
    switch (event.status) {
      case 'picked_up':
        eventType = 'PACKAGE_PICKED_UP';
        break;
      case 'in_transit':
        eventType = 'IN_TRANSIT';
        break;
      case 'out_for_delivery':
        eventType = 'OUT_FOR_DELIVERY';
        break;
      case 'delivered':
        eventType = 'DELIVERED';
        break;
      case 'failed_delivery':
        eventType = 'FAILED_DELIVERY';
        break;
      case 'exception':
        eventType = 'EXCEPTION';
        break;
      default:
        return {
          success: false,
          message: 'No notification for this event type'
        };
    }

    return await this.sendTrackingNotification(orderId, eventType, event);
  }

  /**
   * Get notification preferences for user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - User preferences
   */
  async getNotificationPreferences(userId) {
    try {
      const user = await User.findById(userId).select('notificationPreferences');
      
      // Default preferences if not set
      return user?.notificationPreferences || {
        email: true,
        sms: true,
        trackingUpdates: true,
        orderUpdates: true
      };
    } catch {
      return {
        email: true,
        sms: true,
        trackingUpdates: true,
        orderUpdates: true
      };
    }
  }

  /**
   * Update notification preferences
   * @param {string} userId - User ID
   * @param {Object} preferences - New preferences
   * @returns {Promise<Object>} - Update result
   */
  async updateNotificationPreferences(userId, preferences) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      user.notificationPreferences = {
        ...user.notificationPreferences,
        ...preferences
      };

      await user.save();

      return {
        success: true,
        preferences: user.notificationPreferences
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Send batch notifications for multiple events
   * @param {Array} notifications - Array of notification requests
   * @returns {Promise<Object>} - Batch result
   */
  async sendBatchNotifications(notifications) {
    const results = [];

    for (const notification of notifications) {
      const result = await this.sendTrackingNotification(
        notification.orderId,
        notification.eventType,
        notification.eventData
      );
      results.push({
        orderId: notification.orderId,
        ...result
      });
    }

    return {
      success: true,
      total: notifications.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }
}

// Export singleton instance
const trackingNotificationService = new TrackingNotificationService();
export default trackingNotificationService;

// Export class for testing
export { TrackingNotificationService, EMAIL_TEMPLATES, SMS_TEMPLATES };
