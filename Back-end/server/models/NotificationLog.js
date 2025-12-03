/**
 * NotificationLog Model
 * Tracks all notification attempts for audit trail and debugging
 */

import mongoose from 'mongoose';

const notificationLogSchema = new mongoose.Schema({
  // Unique identifier for the notification
  notificationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Associated order ID
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },
  
  // Recipient user ID
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Notification type: email or sms
  type: {
    type: String,
    enum: ['email', 'sms'],
    required: true
  },
  
  // Event type that triggered the notification
  event: {
    type: String,
    enum: [
      'order_placed',
      'order_confirmed',
      'order_shipped',
      'order_delivered',
      'order_cancelled',
      'return_requested',
      'return_approved',
      'return_rejected',
      'item_received',
      'refund_processed',
      'tracking_update'
    ],
    required: true
  },
  
  // Recipient (email address or phone number)
  recipient: {
    type: String,
    required: true
  },
  
  // Delivery status
  status: {
    type: String,
    enum: ['success', 'failed', 'retrying'],
    default: 'retrying',
    index: true
  },
  
  // Number of delivery attempts
  attemptCount: {
    type: Number,
    default: 1
  },
  
  // Service provider (SendGrid or Twilio)
  provider: {
    type: String,
    enum: ['sendgrid', 'twilio', 'mock'],
    required: true
  },
  
  // Message ID from provider (for tracking)
  providerId: {
    type: String
  },
  
  // Error message if delivery failed
  errorMessage: {
    type: String
  },
  
  // Additional metadata
  metadata: {
    subject: String,
    messagePreview: String,
    retryDelays: [Number],
    httpStatusCode: Number
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Index for efficient queries
notificationLogSchema.index({ orderId: 1, type: 1 });
notificationLogSchema.index({ status: 1, createdAt: -1 });

// TTL index for automatic cleanup after 90 days (7776000 seconds)
notificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

// Instance method to mark as success
notificationLogSchema.methods.markSuccess = function(providerId) {
  this.status = 'success';
  this.providerId = providerId;
  this.errorMessage = undefined;
  return this.save();
};

// Instance method to mark as failed
notificationLogSchema.methods.markFailed = function(errorMessage) {
  this.status = 'failed';
  this.errorMessage = errorMessage;
  return this.save();
};

// Instance method to increment retry attempt
notificationLogSchema.methods.incrementAttempt = function(retryDelay) {
  this.attemptCount += 1;
  if (!this.metadata.retryDelays) {
    this.metadata.retryDelays = [];
  }
  this.metadata.retryDelays.push(retryDelay);
  return this.save();
};

// Static method to get notification stats for an order
notificationLogSchema.statics.getOrderStats = async function(orderId) {
  return this.aggregate([
    { $match: { orderId: mongoose.Types.ObjectId(orderId) } },
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
    }
  ]);
};

const NotificationLog = mongoose.model('NotificationLog', notificationLogSchema);

export default NotificationLog;
