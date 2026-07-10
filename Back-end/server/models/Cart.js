import mongoose from "mongoose";

const CartSchema = new mongoose.Schema({
  // Support both authenticated users and guest sessions
  // ONE cart per user or session (enforced by unique sparse indexes below)
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: false // Optional for guest checkout
  },
  sessionId: {
    type: String,
    required: false // Optional for authenticated users
  },
  isGuest: {
    type: Boolean,
    default: false
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    price: {
      type: Number,
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  totalItems: {
    type: Number,
    default: 0
  },
  totalPrice: {
    type: Number,
    default: 0
  },
  // Coupon the shopper applied on the cart page. A carrier only — never a discount
  // amount. Every read re-prices through pricingService, and order creation re-validates
  // and re-computes from scratch, so a stale/now-invalid code here can never mis-charge.
  couponCode: {
    type: String,
    default: null,
    uppercase: true,
    trim: true
  },
  // Track recent cart changes for user transparency
  recentChanges: [{
    type: {
      type: String,
      enum: ['REMOVED_OUT_OF_STOCK', 'QUANTITY_ADJUSTED', 'PRICE_UPDATED'],
      required: true
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    productName: String,
    previousQuantity: Number,
    newQuantity: Number,
    message: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { 
  timestamps: true 
});

// Prune stale recentChanges entries on every save.
// MongoDB TTL indexes only work on top-level Date fields, not subdocument arrays,
// so a pre-save hook is the correct mechanism here.
CartSchema.pre('save', function(next) {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  this.recentChanges = this.recentChanges.filter(c => c.createdAt > cutoff);
  next();
});

// CRITICAL: Unique partial indexes for cart retrieval (guest + authenticated)
// Ensures ONE cart per user or session (data integrity)
// Partial: Only index documents where field exists AND is not null (more precise than sparse)
// Unique: Prevents duplicate carts for same user/session
CartSchema.index(
  { sessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { sessionId: { $exists: true, $ne: null } }
  }
);
CartSchema.index(
  { user: 1 },
  {
    unique: true,
    partialFilterExpression: { user: { $exists: true, $ne: null } }
  }
);

// CRITICAL: Enforce mutual exclusivity (user XOR sessionId, not both)
CartSchema.pre('save', function (next) {
  if (this.user && this.sessionId) {
    return next(new Error('Cart cannot have both user and sessionId'));
  }
  if (!this.user && !this.sessionId) {
    return next(new Error('Cart must have either user or sessionId'));
  }
  next();
});

// Calculate totals before saving
CartSchema.pre('save', function(next) {
  this.totalItems = this.items.reduce((sum, item) => sum + item.quantity, 0);
  this.totalPrice = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  next();
});

export default mongoose.model("Cart", CartSchema);
