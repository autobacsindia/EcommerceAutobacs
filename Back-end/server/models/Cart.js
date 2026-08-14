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
    // For variable products: the selected variant's subdoc _id (Product.variants[]._id)
    // and its label snapshot. null/absent for simple products. A product+variant pair
    // is a DISTINCT cart line — the same filter for two car models = two lines.
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    variantLabel: {
      type: String,
      default: null
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
// Unique: Prevents duplicate carts for same user/session
//
// The filter is `$type`, NOT `$exists: true, $ne: null`. MongoDB rejects `$ne`
// in a partialFilterExpression ("Expression not supported in partial index"), so
// the previous declaration could never be built — which is exactly why
// production still had the older `sparse` version of these indexes and drifted
// from this file for months. `sparse` is not equivalent: it skips only MISSING
// fields, so a document with `sessionId: null` IS indexed, and under a unique
// index only one such document could ever exist.
// `$type` is supported and expresses the real intent — index only documents
// where the field holds a real value. Verified against MongoDB, not assumed.
CartSchema.index(
  { sessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { sessionId: { $type: 'string' } }
  }
);
CartSchema.index(
  { user: 1 },
  {
    unique: true,
    partialFilterExpression: { user: { $type: 'objectId' } }
  }
);

// Abandoned GUEST carts expire after 30 days of inactivity.
//
// Read the partial filter carefully before touching this — a TTL index is how
// this collection previously lost live carts. Two orphan TTL indexes existed in
// production on `recentChanges.createdAt` (300s) that were never in this schema.
// A TTL index over an array of dates expires on the *minimum* value and deletes
// the WHOLE document, so any cart that recorded a stock-adjustment note was
// destroyed five minutes later, wiping the shopper's basket. They are removed by
// scripts/fix-cart-indexes-v2.js.
//
// This index is safe where those were not, for three specific reasons:
//   1. partialFilterExpression restricts it to GUEST carts. A logged-in user's
//      cart has no sessionId and is therefore never indexed, so it never expires.
//   2. It keys on `updatedAt` — a real top-level Date maintained by `timestamps`,
//      not a subdocument array. Any write refreshes it, so an active cart never
//      reaches the threshold.
//   3. 30 days is far outside a shopping session, unlike the 300s above.
// The "never expires a logged-in user's cart" property is asserted in tests/cart.test.js.
CartSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: { sessionId: { $type: 'string' } },
    name: 'guest_cart_ttl'
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
