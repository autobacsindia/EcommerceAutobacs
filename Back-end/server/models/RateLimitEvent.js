import mongoose from 'mongoose';

const rateLimitEventSchema = new mongoose.Schema({
  // Event identification
  eventType: {
    type: String,
    required: true,
    enum: ['hit', 'block', 'retry_success', 'retry_failure', 'threshold_change'],
    index: true
  },
  
  // Request context
  endpoint: {
    type: String,
    required: true,
    index: true
  },
  method: {
    type: String,
    required: true,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  },
  
  // User/IP identification
  ipAddress: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    sparse: true,
    index: true
  },
  userEmail: {
    type: String,
    sparse: true
  },
  
  // Rate limit details
  limitType: {
    type: String,
    enum: ['burst', 'window'],
    required: true
  },
  currentLimit: {
    type: Number,
    required: true
  },
  attemptCount: {
    type: Number,
    required: true
  },
  retryAfter: {
    type: Number, // seconds
    required: function() {
      return this.eventType === 'block';
    }
  },
  
  // Retry tracking
  retryCount: {
    type: Number,
    default: 0
  },
  totalDelay: {
    type: Number, // milliseconds
    default: 0
  },
  
  // Threshold change tracking
  oldLimit: {
    type: Number,
    required: function() {
      return this.eventType === 'threshold_change';
    }
  },
  newLimit: {
    type: Number,
    required: function() {
      return this.eventType === 'threshold_change';
    }
  },
  changeReason: {
    type: String,
    required: function() {
      return this.eventType === 'threshold_change';
    }
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.eventType === 'threshold_change';
    }
  },
  
  // Request metadata
  userAgent: {
    type: String
  },
  deviceInfo: {
    type: String
  },
  
  // Adaptive throttling context
  adaptiveProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdaptiveThrottlingProfile',
    sparse: true
  },
  adaptiveProfileActive: {
    type: Boolean,
    default: false
  },
  
  // Timestamp
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
    expires: 7776000 // Auto-delete after 90 days (90 * 24 * 60 * 60)
  }
}, {
  timestamps: false, // We use custom timestamp field
  collection: 'rate_limit_events'
});

// Compound indexes for efficient queries
rateLimitEventSchema.index({ eventType: 1, timestamp: -1 });
rateLimitEventSchema.index({ endpoint: 1, timestamp: -1 });
rateLimitEventSchema.index({ eventType: 1, endpoint: 1, timestamp: -1 });
rateLimitEventSchema.index({ ipAddress: 1, timestamp: -1 });
rateLimitEventSchema.index({ userId: 1, timestamp: -1 });

// Static methods for analytics

rateLimitEventSchema.statics.getEventCountsByType = async function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 }
      }
    }
  ]);
};

rateLimitEventSchema.statics.getTopRateLimitedEndpoints = async function(limit = 10, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        eventType: 'block',
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$endpoint',
        count: { $sum: 1 },
        avgRetryAfter: { $avg: '$retryAfter' },
        uniqueIPs: { $addToSet: '$ipAddress' }
      }
    },
    {
      $project: {
        endpoint: '$_id',
        blockCount: '$count',
        avgRetryAfter: 1,
        uniqueIPCount: { $size: '$uniqueIPs' }
      }
    },
    {
      $sort: { blockCount: -1 }
    },
    {
      $limit: limit
    }
  ]);
};

rateLimitEventSchema.statics.getUserImpactMetrics = async function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        eventType: 'block',
        userId: { $exists: true },
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$userId',
        blockCount: { $sum: 1 },
        endpoints: { $addToSet: '$endpoint' }
      }
    },
    {
      $project: {
        userId: '$_id',
        blockCount: 1,
        affectedEndpointsCount: { $size: '$endpoints' }
      }
    },
    {
      $sort: { blockCount: -1 }
    }
  ]);
};

rateLimitEventSchema.statics.getRetrySuccessRate = async function(startDate, endDate) {
  const results = await this.aggregate([
    {
      $match: {
        eventType: { $in: ['retry_success', 'retry_failure'] },
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const successCount = results.find(r => r._id === 'retry_success')?.count || 0;
  const failureCount = results.find(r => r._id === 'retry_failure')?.count || 0;
  const total = successCount + failureCount;
  
  return {
    successCount,
    failureCount,
    total,
    successRate: total > 0 ? (successCount / total) * 100 : 0
  };
};

rateLimitEventSchema.statics.getRealtimeMetrics = async function() {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60000);
  
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: oneMinuteAgo }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 }
      }
    }
  ]);
};

const RateLimitEvent = mongoose.model('RateLimitEvent', rateLimitEventSchema);

export default RateLimitEvent;
