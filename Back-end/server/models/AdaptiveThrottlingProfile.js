import mongoose from 'mongoose';

const endpointAdjustmentSchema = new mongoose.Schema({
  endpointPattern: {
    type: String,
    required: true,
    description: 'Regex pattern to match endpoints (e.g., /checkout.*, /cart.*)'
  },
  originalLimit: {
    type: Number,
    required: true,
    description: 'The standard rate limit for this endpoint'
  },
  multiplier: {
    type: Number,
    required: true,
    min: 0.1,
    max: 5,
    description: 'Multiplier to apply to original limit (0.1-5x)'
  },
  absoluteMaxLimit: {
    type: Number,
    required: true,
    description: 'Hard ceiling that cannot be exceeded regardless of multiplier'
  }
}, { _id: false });

const activationHistorySchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  action: {
    type: String,
    enum: ['activated', 'deactivated', 'auto_deactivated'],
    required: true
  },
  triggeredBy: {
    type: String,
    enum: ['admin', 'scheduled', 'auto'],
    required: true
  },
  adminUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reason: {
    type: String
  },
  errorRate: {
    type: Number,
    description: 'Error rate at time of auto-deactivation (if applicable)'
  }
}, { _id: false });

const adaptiveThrottlingProfileSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    description: 'Human-readable profile name (e.g., "Flash Sale", "Holiday Season")'
  },
  description: {
    type: String,
    required: true
  },
  endpointAdjustments: {
    type: [endpointAdjustmentSchema],
    required: true,
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'At least one endpoint adjustment is required'
    }
  },
  activationSchedule: {
    startTime: {
      type: Date,
      description: 'Scheduled start time (optional for manual activation)'
    },
    endTime: {
      type: Date,
      description: 'Scheduled end time (optional for manual deactivation)'
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
      description: 'Timezone for scheduled activation'
    }
  },
  status: {
    type: String,
    enum: ['active', 'scheduled', 'inactive'],
    default: 'inactive',
    index: true
  },
  safetyChecks: {
    maxMultiplier: {
      type: Number,
      default: 5,
      description: 'Maximum allowed multiplier cap'
    },
    absoluteCeilingLimit: {
      type: Number,
      default: 1000,
      description: 'Never exceed this many requests/min for any endpoint'
    },
    errorRateThreshold: {
      type: Number,
      default: 5,
      description: 'Auto-deactivate if error rate exceeds this percentage'
    },
    autoDeactivateOnError: {
      type: Boolean,
      default: true,
      description: 'Automatically deactivate if error rate threshold exceeded'
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastActivated: {
    type: Date
  },
  lastDeactivated: {
    type: Date
  },
  activationHistory: {
    type: [activationHistorySchema],
    default: []
  },
  metrics: {
    totalActivations: {
      type: Number,
      default: 0
    },
    totalDeactivations: {
      type: Number,
      default: 0
    },
    autoDeactivations: {
      type: Number,
      default: 0
    },
    totalActiveTime: {
      type: Number,
      default: 0,
      description: 'Total time profile was active in milliseconds'
    }
  }
}, {
  timestamps: true,
  collection: 'adaptive_throttling_profiles'
});

// Index for finding active profiles
// adaptiveThrottlingProfileSchema.index({ status: 1 }); // Already indexed in schema definition

// Index for scheduled profiles
adaptiveThrottlingProfileSchema.index({ 'activationSchedule.startTime': 1, status: 1 });

// Pre-save validation
adaptiveThrottlingProfileSchema.pre('save', function(next) {
  // Validate multipliers don't exceed safety cap
  const maxMultiplier = this.safetyChecks.maxMultiplier;
  for (const adjustment of this.endpointAdjustments) {
    if (adjustment.multiplier > maxMultiplier) {
      return next(new Error(`Multiplier ${adjustment.multiplier} exceeds safety cap of ${maxMultiplier}`));
    }
    
    // Validate absolute max limit
    const calculatedLimit = adjustment.originalLimit * adjustment.multiplier;
    if (calculatedLimit > adjustment.absoluteMaxLimit) {
      return next(new Error(`Calculated limit ${calculatedLimit} exceeds absolute max ${adjustment.absoluteMaxLimit}`));
    }
  }
  
  // Validate schedule if status is scheduled
  if (this.status === 'scheduled') {
    if (!this.activationSchedule.startTime) {
      return next(new Error('Start time required for scheduled profiles'));
    }
    if (this.activationSchedule.startTime < new Date()) {
      return next(new Error('Start time must be in the future'));
    }
  }
  
  next();
});

// Static method to get active profile
adaptiveThrottlingProfileSchema.statics.getActiveProfile = async function() {
  return this.findOne({ status: 'active' });
};

// Static method to check for scheduled profiles that should activate
adaptiveThrottlingProfileSchema.statics.checkScheduledProfiles = async function() {
  const now = new Date();
  
  // Find profiles that should activate
  const profilesToActivate = await this.find({
    status: 'scheduled',
    'activationSchedule.startTime': { $lte: now }
  });
  
  // Find active profiles that should deactivate
  const profilesToDeactivate = await this.find({
    status: 'active',
    'activationSchedule.endTime': { $exists: true, $lte: now }
  });
  
  return { profilesToActivate, profilesToDeactivate };
};

// Instance method to activate profile
adaptiveThrottlingProfileSchema.methods.activate = async function(triggeredBy = 'admin', adminUserId = null, reason = '') {
  // Deactivate any currently active profile
  await this.constructor.updateMany(
    { status: 'active' },
    {
      $set: { status: 'inactive', lastDeactivated: new Date() },
      $push: {
        activationHistory: {
          timestamp: new Date(),
          action: 'deactivated',
          triggeredBy: 'auto',
          reason: 'Replaced by another profile activation'
        }
      }
    }
  );
  
  // Activate this profile
  this.status = 'active';
  this.lastActivated = new Date();
  this.metrics.totalActivations += 1;
  this.activationHistory.push({
    timestamp: new Date(),
    action: 'activated',
    triggeredBy,
    adminUserId,
    reason
  });
  
  await this.save();
  
  return this;
};

// Instance method to deactivate profile
adaptiveThrottlingProfileSchema.methods.deactivate = async function(triggeredBy = 'admin', adminUserId = null, reason = '', errorRate = null) {
  if (this.status !== 'active') {
    throw new Error('Profile is not currently active');
  }
  
  // Calculate active time
  if (this.lastActivated) {
    const activeTime = Date.now() - this.lastActivated.getTime();
    this.metrics.totalActiveTime += activeTime;
  }
  
  this.status = 'inactive';
  this.lastDeactivated = new Date();
  this.metrics.totalDeactivations += 1;
  
  if (triggeredBy === 'auto') {
    this.metrics.autoDeactivations += 1;
  }
  
  this.activationHistory.push({
    timestamp: new Date(),
    action: triggeredBy === 'auto' ? 'auto_deactivated' : 'deactivated',
    triggeredBy,
    adminUserId,
    reason,
    errorRate
  });
  
  await this.save();
  
  return this;
};

// Instance method to get adjusted limit for an endpoint
adaptiveThrottlingProfileSchema.methods.getAdjustedLimit = function(endpoint) {
  if (this.status !== 'active') {
    return null;
  }
  
  for (const adjustment of this.endpointAdjustments) {
    const regex = new RegExp(adjustment.endpointPattern);
    if (regex.test(endpoint)) {
      const adjustedLimit = Math.floor(adjustment.originalLimit * adjustment.multiplier);
      // Never exceed absolute max limit
      return Math.min(adjustedLimit, adjustment.absoluteMaxLimit, this.safetyChecks.absoluteCeilingLimit);
    }
  }
  
  return null;
};

const AdaptiveThrottlingProfile = mongoose.model('AdaptiveThrottlingProfile', adaptiveThrottlingProfileSchema);

export default AdaptiveThrottlingProfile;
