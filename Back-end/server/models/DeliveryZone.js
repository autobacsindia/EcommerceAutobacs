import mongoose from "mongoose";

const DeliveryZoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Zone name is required"],
    unique: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: {
      values: ["metro", "tier1", "tier2", "remote"],
      message: "Type must be metro, tier1, tier2, or remote"
    }
  },
  pinCodes: [{
    type: String,
    trim: true
  }],
  cities: [{
    type: String,
    trim: true
  }],
  states: [{
    type: String,
    trim: true
  }],
  deliveryTime: {
    minDays: {
      type: Number,
      required: [true, "Minimum delivery days is required"],
      min: [1, "Minimum delivery days must be at least 1"]
    },
    maxDays: {
      type: Number,
      required: [true, "Maximum delivery days is required"],
      min: [1, "Maximum delivery days must be at least 1"],
      validate: {
        validator: function(value) {
          return value >= this.deliveryTime.minDays;
        },
        message: "Maximum delivery days must be greater than or equal to minimum days"
      }
    }
  },
  shippingCost: {
    baseRate: {
      type: Number,
      default: 0,
      min: [0, "Base rate cannot be negative"]
    },
    perKgRate: {
      type: Number,
      default: 0,
      min: [0, "Per kg rate cannot be negative"]
    }
  },
  isServiceable: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 0,
    comment: "Higher priority zones take precedence when PIN codes overlap"
  }
}, {
  timestamps: true
});

// Indexes for performance
DeliveryZoneSchema.index({ pinCodes: 1 });
DeliveryZoneSchema.index({ type: 1 });
DeliveryZoneSchema.index({ isServiceable: 1 });
DeliveryZoneSchema.index({ cities: 1 });
DeliveryZoneSchema.index({ states: 1 });
DeliveryZoneSchema.index({ priority: -1 });

// Virtual for delivery time range display
DeliveryZoneSchema.virtual("deliveryTimeRange").get(function() {
  if (this.deliveryTime.minDays === this.deliveryTime.maxDays) {
    return `${this.deliveryTime.minDays} days`;
  }
  return `${this.deliveryTime.minDays}-${this.deliveryTime.maxDays} days`;
});

// Method to check if zone services a PIN code
DeliveryZoneSchema.methods.servicesPinCode = function(pinCode) {
  return this.pinCodes.includes(pinCode) && this.isServiceable;
};

// Method to calculate shipping cost
DeliveryZoneSchema.methods.calculateShippingCost = function(weightKg = 0) {
  return this.shippingCost.baseRate + (weightKg * this.shippingCost.perKgRate);
};

// Method to estimate delivery date
DeliveryZoneSchema.methods.estimateDeliveryDate = function(orderDate = new Date(), processingDays = 1) {
  const startDate = new Date(orderDate);
  let daysAdded = 0;
  let currentDate = new Date(startDate);
  
  // Add processing days first
  while (daysAdded < processingDays) {
    currentDate.setDate(currentDate.getDate() + 1);
    // Skip Sundays (0 = Sunday)
    if (currentDate.getDay() !== 0) {
      daysAdded++;
    }
  }
  
  // Calculate min and max delivery dates
  const minDate = new Date(currentDate);
  daysAdded = 0;
  while (daysAdded < this.deliveryTime.minDays) {
    minDate.setDate(minDate.getDate() + 1);
    if (minDate.getDay() !== 0) {
      daysAdded++;
    }
  }
  
  const maxDate = new Date(currentDate);
  daysAdded = 0;
  while (daysAdded < this.deliveryTime.maxDays) {
    maxDate.setDate(maxDate.getDate() + 1);
    if (maxDate.getDay() !== 0) {
      daysAdded++;
    }
  }
  
  return {
    minDate,
    maxDate,
    formattedRange: this.formatDateRange(minDate, maxDate)
  };
};

// Helper method to format date range
DeliveryZoneSchema.methods.formatDateRange = function(minDate, maxDate) {
  const options = { month: "short", day: "numeric" };
  const minStr = minDate.toLocaleDateString("en-IN", options);
  const maxStr = maxDate.toLocaleDateString("en-IN", options);
  
  if (minStr === maxStr) {
    return `by ${minStr}`;
  }
  return `between ${minStr} and ${maxStr}`;
};

// Static method to find zone by PIN code
DeliveryZoneSchema.statics.findByPinCode = async function(pinCode) {
  const zones = await this.find({
    pinCodes: pinCode,
    isServiceable: true
  }).sort({ priority: -1 });
  
  return zones.length > 0 ? zones[0] : null;
};

// Static method to check if PIN code is serviceable
DeliveryZoneSchema.statics.isPinCodeServiceable = async function(pinCode) {
  const zone = await this.findByPinCode(pinCode);
  return zone !== null;
};

// Static method to get all zones summary
DeliveryZoneSchema.statics.getZonesSummary = async function() {
  return this.aggregate([
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
        totalPinCodes: { $sum: { $size: "$pinCodes" } },
        avgMinDays: { $avg: "$deliveryTime.minDays" },
        avgMaxDays: { $avg: "$deliveryTime.maxDays" }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
};

// Static method to bulk add PIN codes to a zone
DeliveryZoneSchema.statics.bulkAddPinCodes = async function(zoneId, pinCodes) {
  return this.findByIdAndUpdate(
    zoneId,
    { $addToSet: { pinCodes: { $each: pinCodes } } },
    { new: true }
  );
};

export default mongoose.model("DeliveryZone", DeliveryZoneSchema);
