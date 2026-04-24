import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  items: [
    {
      product: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Product",
        required: true
      },
      quantity: { 
        type: Number, 
        required: true,
        min: 1
      },
      price: { 
        type: Number, 
        required: true 
      },
      name: String,
      image: String
    }
  ],
  shippingAddress: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, default: "India" }
  },
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payment"
  },
  assignedWarehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Warehouse"
  },
  deliveryZone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DeliveryZone"
  },
  subtotal: {
    type: Number,
    required: true
  },
  shippingCost: {
    type: Number,
    default: 0
  },
  tax: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  totalAmount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded", "failed"], 
    default: "pending" 
  },
  
  // Guest checkout session binding (prevents order hijacking)
  sessionId: String,  // Client-provided session ID (for initial order lookup)
  guestSessionHash: String,  // SHA256 hash of server-generated session token (defense-in-depth)
  sessionCreatedAt: Date,  // Timestamp when session was created (anti-replay)
  guestIPHash: String,  // SHA256 hash of guest IP (forensic visibility)
  guestUAHash: String,  // SHA256 hash of guest User-Agent (anomaly detection)
  securityFlags: [{  // Security event tracking
    type: String,
    enum: ['SESSION_EXPIRED_DURING_PAYMENT', 'SESSION_MISMATCH', 'REDIS_UNAVAILABLE', 'GUEST_UA_MISMATCH', 'GUEST_IP_MISMATCH']
  }],
  
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    reason: String,
    notes: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  trackingNumber: String,
  carrier: {
    name: String,
    code: String,
    trackingUrl: String
  },
  trackingEvents: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    status: String,
    location: String,
    description: String,
    scannedBy: String
  }],
  // estimatedDeliveryDate and actualDeliveryDate removed — unused duplicates of estimatedDelivery / deliveredAt
  estimatedDelivery: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  fulfillmentMetrics: {
    confirmedAt: Date,
    processingStartedAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    timeToShip: Number, // hours from confirmation to shipping
    timeToDeliver: Number // hours from shipping to delivery
  },
  returnRequest: {
    requestedAt: Date,
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    reason: {
      type: String,
      enum: ["defective", "wrong_item", "other"]
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "item_received", "completed", "cancelled", "refund_processed"],
      default: "pending"
    },
    items: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      },
      quantity: Number,
      reason: String
    }],
    images: [{
      url: String,
      description: String
    }],
    adminNotes: String,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    approvedAt: Date,
    rejectedReason: String,
    returnShippingLabel: String,
    itemReceivedAt: Date,
    inspectionNotes: String
  },
  refundDetails: {
    requestedAt: Date,
    amount: Number,
    refundType: {
      type: String,
      enum: ["full", "partial"]
    },
    refundMethod: {
      type: String,
      enum: ["original_payment", "store_credit", "bank_transfer"]
    },
    itemsRefunded: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      },
      quantity: Number,
      amount: Number
    }],
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending"
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    processedAt: Date,
    transactionId: String,
    failureReason: String,
    notes: String
  },
  notes: String
}, { 
  timestamps: true 
});

// Indexes for order queries
// COMPOUND indexes for common query patterns
OrderSchema.index({ user: 1, createdAt: -1 }); // User order history (sorted by date)
OrderSchema.index({ status: 1, createdAt: -1 }); // Admin dashboard (filter by status, sort by date)

// SINGLE-FIELD indexes for specific lookups
OrderSchema.index({ trackingNumber: 1 }); // Tracking lookup
OrderSchema.index({ 'returnRequest.status': 1 }); // Return request queries
OrderSchema.index({ 'refundDetails.status': 1 }); // Refund status queries

// Pre-save middleware to add initial status to history
OrderSchema.pre('save', function(next) {
  // Only add to history if this is a new document or status changed
  if (this.isNew || this.isModified('status')) {
    // Initialize statusHistory if it doesn't exist
    if (!this.statusHistory) {
      this.statusHistory = [];
    }
    
    // Add current status to history if not already there
    const lastHistoryStatus = this.statusHistory.length > 0 
      ? this.statusHistory[this.statusHistory.length - 1].status 
      : null;
    
    if (lastHistoryStatus !== this.status) {
      this.statusHistory.push({
        status: this.status,
        timestamp: new Date()
      });
    }
  }
  next();
});

// Method to get valid next statuses
OrderSchema.methods.getValidNextStatuses = function() {
  const transitions = {
    'pending': ['confirmed', 'cancelled', 'failed'],
    'confirmed': ['processing', 'cancelled'],
    'processing': ['shipped', 'cancelled'],
    'shipped': ['delivered'],
    'delivered': ['refunded'],
    'cancelled': [],
    'refunded': [],
    'failed': []
  };
  return transitions[this.status] || [];
};

// Method to check if status transition is valid
OrderSchema.methods.canTransitionTo = function(newStatus) {
  const validStatuses = this.getValidNextStatuses();
  return validStatuses.includes(newStatus);
};

const Order = mongoose.model("Order", OrderSchema);

export default Order;
