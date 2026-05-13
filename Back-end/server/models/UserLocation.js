import mongoose from "mongoose";

const UserLocationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    sparse: true
  },
  sessionId: {
    type: String,
    sparse: true,
    index: true
  },
  selectedAddress: {
    formatted: {
      type: String,
      required: [true, "Formatted address is required"]
    },
    street: {
      type: String
    },
    city: {
      type: String,
      required: [true, "City is required"]
    },
    state: {
      type: String,
      required: [true, "State is required"]
    },
    postalCode: {
      type: String,
      default: '',
      index: true
    },
    country: {
      type: String,
      default: "India"
    },
    coordinates: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: {
        type: [Number],
        required: [true, "Coordinates are required"],
        validate: {
          validator: function(v) {
            return v.length === 2 && 
                   v[0] >= -180 && v[0] <= 180 && // longitude
                   v[1] >= -90 && v[1] <= 90;      // latitude
          },
          message: "Coordinates must be [longitude, latitude] with valid ranges"
        }
      }
    }
  },
  deliveryZone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DeliveryZone"
  },
  nearestWarehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Warehouse"
  },
  placeId: {
    type: String,
    sparse: true
  },
  lastUsed: {
    type: Date,
    default: Date.now,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for performance
UserLocationSchema.index({ "selectedAddress.coordinates": "2dsphere" });
UserLocationSchema.index({ user: 1, isActive: 1 });
UserLocationSchema.index({ sessionId: 1, isActive: 1 });
UserLocationSchema.index({ lastUsed: -1 });

// Ensure either user or sessionId is present
UserLocationSchema.pre("validate", function(next) {
  if (!this.user && !this.sessionId) {
    next(new Error("Either user or sessionId must be provided"));
  } else {
    next();
  }
});

// Method to check if location has expired (for guest users)
UserLocationSchema.methods.isExpired = function(expiryDays = 7) {
  if (this.user) {
    return false; // Authenticated user locations don't expire
  }
  const expiryDate = new Date(this.lastUsed);
  expiryDate.setDate(expiryDate.getDate() + expiryDays);
  return new Date() > expiryDate;
};

// Method to update last used timestamp
UserLocationSchema.methods.touch = async function() {
  this.lastUsed = new Date();
  await this.save();
  return this;
};

// Static method to find active location for user
UserLocationSchema.statics.findByUser = async function(userId) {
  return this.findOne({
    user: userId,
    isActive: true
  }).populate("deliveryZone nearestWarehouse");
};

// Static method to find active location for session
UserLocationSchema.statics.findBySession = async function(sessionId) {
  const location = await this.findOne({
    sessionId: sessionId,
    isActive: true
  }).populate("deliveryZone nearestWarehouse");
  
  // Check if expired
  if (location && location.isExpired()) {
    location.isActive = false;
    await location.save();
    return null;
  }
  
  return location;
};

// Static method to create or update location
UserLocationSchema.statics.upsertLocation = async function(identifier, locationData) {
  const query = identifier.userId 
    ? { user: identifier.userId } 
    : { sessionId: identifier.sessionId };
  
  // Deactivate old locations
  await this.updateMany(query, { isActive: false });
  
  // Create new location
  const newLocation = new this({
    ...query,
    ...locationData,
    isActive: true,
    lastUsed: new Date()
  });
  
  await newLocation.save();
  return newLocation.populate("deliveryZone nearestWarehouse");
};

// Static method to cleanup expired guest locations
UserLocationSchema.statics.cleanupExpired = async function(expiryDays = 7) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() - expiryDays);
  
  const result = await this.updateMany(
    {
      user: { $exists: false },
      lastUsed: { $lt: expiryDate },
      isActive: true
    },
    {
      isActive: false
    }
  );
  
  return result.modifiedCount;
};

// Static method to get recent locations for user
UserLocationSchema.statics.getRecentLocations = async function(userId, limit = 5) {
  return this.find({
    user: userId
  })
  .sort({ lastUsed: -1 })
  .limit(limit)
  .populate("deliveryZone");
};

export default mongoose.model("UserLocation", UserLocationSchema);
