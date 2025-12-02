import mongoose from "mongoose";

const WarehouseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Warehouse name is required"],
    trim: true,
    maxlength: [100, "Warehouse name cannot exceed 100 characters"]
  },
  code: {
    type: String,
    required: [true, "Warehouse code is required"],
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: [20, "Warehouse code cannot exceed 20 characters"]
  },
  type: {
    type: String,
    required: true,
    enum: {
      values: ["warehouse", "store", "hub"],
      message: "Type must be warehouse, store, or hub"
    },
    default: "warehouse"
  },
  location: {
    address: {
      type: String,
      required: [true, "Address is required"]
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
      required: [true, "Postal code is required"]
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
  serviceablePinCodes: [{
    type: String,
    trim: true
  }],
  operationalStatus: {
    type: String,
    enum: {
      values: ["active", "inactive", "maintenance"],
      message: "Status must be active, inactive, or maintenance"
    },
    default: "active"
  },
  operationalHours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String }
  },
  contactInfo: {
    phone: String,
    email: String,
    manager: String
  },
  capacity: {
    type: Number,
    min: 0,
    default: 10000
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for performance optimization
WarehouseSchema.index({ "location.coordinates": "2dsphere" }); // Geospatial queries
WarehouseSchema.index({ code: 1 });
WarehouseSchema.index({ operationalStatus: 1, isActive: 1 });
WarehouseSchema.index({ "location.city": 1 });
WarehouseSchema.index({ "location.postalCode": 1 });
WarehouseSchema.index({ serviceablePinCodes: 1 });

// Virtual for getting full address
WarehouseSchema.virtual("fullAddress").get(function() {
  return `${this.location.address}, ${this.location.city}, ${this.location.state} - ${this.location.postalCode}, ${this.location.country}`;
});

// Method to check if warehouse services a PIN code
WarehouseSchema.methods.servicesPinCode = function(pinCode) {
  if (!this.serviceablePinCodes || this.serviceablePinCodes.length === 0) {
    return true; // If no specific PIN codes defined, serves all
  }
  return this.serviceablePinCodes.includes(pinCode);
};

// Static method to find nearest warehouse
WarehouseSchema.statics.findNearest = async function(longitude, latitude, maxDistance = 50000) {
  return this.aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [longitude, latitude]
        },
        distanceField: "distance",
        maxDistance: maxDistance,
        spherical: true,
        query: { operationalStatus: "active", isActive: true }
      }
    },
    {
      $limit: 10
    }
  ]);
};

export default mongoose.model("Warehouse", WarehouseSchema);
