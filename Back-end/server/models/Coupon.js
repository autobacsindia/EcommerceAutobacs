import mongoose from "mongoose";

/**
 * Coupon — admin-managed discount code.
 *
 * Pricing authority lives in services/pricingService.js; this model only stores
 * the rule. `usedCount` is a global atomic counter incremented inside the order
 * transaction with a guarded $inc, so a limited coupon can never be oversold under
 * concurrency. Per-user limits are enforced separately via the CouponUserUsage
 * counter (see that model) — counting redemptions is not atomic, a guarded counter is.
 *
 * visibility:
 *   public — listed at checkout (GET /coupons/available) for eligible carts.
 *   hidden — never listed; only applies when the customer types the exact code.
 */
const CouponSchema = new mongoose.Schema({
  // Stored uppercased + trimmed; matching is always case-insensitive on the uppercased form.
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  description: { type: String, trim: true },

  type: {
    type: String,
    enum: ["percentage", "fixed", "free_shipping"],
    required: true
  },
  // percentage: 0–100. fixed: rupee amount off. free_shipping: ignored.
  value: { type: Number, default: 0, min: 0 },
  // Caps the rupee discount for `percentage` coupons (e.g. "10% off, up to ₹500"). 0/null = uncapped.
  maxDiscountAmount: { type: Number, min: 0, default: null },

  visibility: {
    type: String,
    enum: ["public", "hidden"],
    default: "hidden"
  },

  // ── Conditions ("valid when…") — all optional, ANDed at apply time ──────────
  minCartValue: { type: Number, min: 0, default: 0 },        // eligible subtotal must be ≥ this
  maxCartValue: { type: Number, min: 0, default: null },     // optional upper bound
  startsAt: { type: Date, default: null },                   // not yet started → rejected
  expiresAt: { type: Date, default: null },                  // expired → rejected
  firstOrderOnly: { type: Boolean, default: false },         // buyer's first paid order only
  // Optional scope. When any array is non-empty the coupon only discounts matching
  // line items, and the min/max cart checks measure the matching subset.
  appliesTo: {
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
    brandSlugs: [{ type: String, trim: true }],
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }]
  },

  // ── Usage limits ────────────────────────────────────────────────────────────
  usageLimit: { type: Number, min: 0, default: null },        // global cap, null = unlimited
  usageLimitPerUser: { type: Number, min: 0, default: null }, // per-user cap, null = unlimited
  usedCount: { type: Number, default: 0, min: 0 },            // atomic global counter

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Listing eligible public coupons + admin filtering.
CouponSchema.index({ isActive: 1, visibility: 1, expiresAt: 1 });

/** True when the coupon's own active/date/limit gates pass (cart-independent checks). */
CouponSchema.methods.isCurrentlyValid = function (now = new Date()) {
  if (!this.isActive) return false;
  if (this.startsAt && now < this.startsAt) return false;
  if (this.expiresAt && now > this.expiresAt) return false;
  if (this.usageLimit != null && this.usedCount >= this.usageLimit) return false;
  return true;
};

export default mongoose.model("Coupon", CouponSchema);
