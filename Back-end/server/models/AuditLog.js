/**
 * Audit Log Model
 * 
 * Persistent audit trail for security-sensitive admin actions.
 * Used to track cache clears, session revocations, and other critical operations.
 */

import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  // Who performed the action
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  
  adminEmail: {
    type: String,
    required: true,
    index: true,
  },
  
  // What action was performed
  action: {
    type: String,
    required: true,
    enum: [
      'CACHE_CLEAR',
      'SESSION_REVOKE_SINGLE',
      'SESSION_REVOKE_ALL',
      'SESSION_REVOKE_ADMIN_ATTEMPT',
      'USER_ROLE_CHANGE',
      'PRODUCT_DELETE',
      'ORDER_STATUS_CHANGE',
      'CONFIG_CHANGE',
    ],
    index: true,
  },
  
  // Details about the action
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  
  // Target of the action (if applicable)
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  
  targetResourceType: {
    type: String,
    enum: ['User', 'Product', 'Order', 'Config', 'Cache'],
  },
  
  targetResourceId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  
  // Request context
  ipAddress: {
    type: String,
    required: true,
  },
  
  userAgent: {
    type: String,
  },
  
  // Result
  success: {
    type: Boolean,
    default: true,
  },
  
  errorMessage: {
    type: String,
  },
  
  // Timestamps
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

// Index for efficient querying by date range
AuditLogSchema.index({ timestamp: -1 });

// Compound index for admin + action queries
AuditLogSchema.index({ adminId: 1, action: 1, timestamp: -1 });

// Auto-delete logs older than 90 days (TTL index)
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

/**
 * Helper method to create audit log
 */
AuditLogSchema.statics.logAction = async function(data) {
  try {
    const log = await this.create(data);
    console.log(`[AuditLog] ${data.action} by ${data.adminEmail}`);
    return log;
  } catch (err) {
    console.error('[AuditLog] Failed to create log:', err.message);
    // Don't throw - audit logging should not break the main operation
  }
};

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

export default AuditLog;
