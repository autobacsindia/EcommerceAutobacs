import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    // Not required for historical WooCommerce orders (ADR-005); live orders always carry a user.
    required: function () { return this.source !== "woocommerce"; }
  },

  // WooCommerce migration linkage (ADR-005). Historical orders are flagged so they feed
  // analytics but stay out of live fulfilment queues.
  wpId: { type: Number, index: { unique: true, sparse: true } },
  source: { type: String, enum: ["web", "woocommerce"], default: "web", index: true },
  legacyStatus: String,

  items: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        // Historical line items may reference products no longer in catalog; name/price are snapshotted.
        required: function () { return this.parent()?.source !== "woocommerce"; }
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
  // Discount breakdown (server-computed; see services/pricingService.js).
  // `discount` above is the goods-level total = couponDiscount + karmaDiscount.
  couponCode: { type: String, default: null },      // applied coupon code snapshot
  couponDiscount: { type: Number, default: 0 },     // rupee discount from the coupon (goods)
  karmaDiscount: { type: Number, default: 0 },      // rupee discount from redeemed karma
  karmaPointsUsed: { type: Number, default: 0 },     // points spent on this order
  karmaAwarded: { type: Boolean, default: false },   // earn-on-delivery idempotency flag
  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded", "failed"],
    default: "pending"
  },
  
  // Contact email for guest orders — allows confirmation emails, support, and admin visibility
  // Not required for authenticated orders (user.email is the source of truth)
  guestEmail: {
    type: String,
    lowercase: true,
    trim: true,
    validate: {
      validator: v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message: 'Invalid guest email address'
    }
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
  // Invoice/receipt (generated on payment success — see services/invoiceService.js).
  // invoiceUrl/invoicePublicId are set only when Cloudinary storage is enabled;
  // invoiceEmailedAt is the idempotency guard so the invoice email fires once.
  invoiceUrl: String,
  invoicePublicId: String,
  invoiceEmailedAt: Date,
  // Fulfillment-status emails already sent to the customer. Idempotency guard so a
  // BullMQ retry of send-order-status-email never double-notifies (see services/orderStatusEmailService.js).
  notifiedStatuses: {
    type: [String],
    default: []
  },
  // Set once the +1-day post-delivery review-request email is sent, so the delayed
  // send-review-request job is idempotent (see services/reviewRequestService.js).
  reviewRequestedAt: Date,
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
OrderSchema.index({ user: 1, status: 1 });      // User orders filtered by status (order tracking page)
OrderSchema.index({ status: 1, createdAt: -1 }); // Admin dashboard (filter by status, sort by date)

// SINGLE-FIELD indexes for specific lookups
OrderSchema.index({ trackingNumber: 1 }); // Tracking lookup
OrderSchema.index({ 'returnRequest.status': 1 }); // Return request queries
OrderSchema.index({ 'refundDetails.status': 1 }); // Refund status queries

// CRITICAL: Guest order lookup (order confirmation page, guest order tracking)
// Partial: Only index documents where sessionId exists AND is not null (guest orders only)
OrderSchema.index(
  { sessionId: 1 },
  {
    partialFilterExpression: { sessionId: { $exists: true, $ne: null } }
  }
);

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
