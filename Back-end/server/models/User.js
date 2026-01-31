import mongoose from "mongoose";

const AddressSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  addressLine1: { type: String, required: true },
  addressLine2: String,
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, default: "India" },
  isDefault: { type: Boolean, default: false },
  coordinates: {
    type: {
      type: String,
      enum: ["Point"]
    },
    coordinates: {
      type: [Number],
      validate: {
        validator: function(v) {
          // Allow empty array or undefined (optional coordinates)
          if (!v || v.length === 0) return true;
          // If provided, must be valid [longitude, latitude]
          return v.length === 2 && 
                 v[0] >= -180 && v[0] <= 180 && // longitude
                 v[1] >= -90 && v[1] <= 90;      // latitude
        },
        message: "Coordinates must be [longitude, latitude] with valid ranges"
      }
    }
  },
  placeId: { type: String },
  deliveryZone: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "DeliveryZone" 
  }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["customer", "admin"], default: "customer" },
  addresses: [AddressSchema],
  
  // Email verification fields
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  verificationTokenExpire: Date,
  verifiedAt: Date,
  
  // Password reset fields
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  resetPasswordUsed: { type: Boolean, default: false },
  
  // Refresh token fields for session management
  refreshTokens: [{
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    deviceInfo: String,
    ipAddress: String,
    createdAt: { type: Date, default: Date.now }
  }],
  
  // Security audit fields
  lastLoginAt: Date,
  lastLoginIp: String,
  loginAttempts: [{
    timestamp: { type: Date, default: Date.now },
    ipAddress: String,
    success: Boolean,
    userAgent: String
  }],

  // Store Credits / Wallet
  wallet: {
    balance: { type: Number, default: 0 },
    transactions: [{
      type: { type: String, enum: ['credit', 'debit'], required: true },
      amount: { type: Number, required: true },
      description: String,
      referenceId: { type: mongoose.Schema.Types.ObjectId }, // ReturnRequest ID or Order ID
      referenceModel: { type: String, enum: ['ReturnRequest', 'Order'] },
      expiryDate: Date,
      createdAt: { type: Date, default: Date.now }
    }]
  }
}, { timestamps: true });

export default mongoose.model("User", UserSchema);