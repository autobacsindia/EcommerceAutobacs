import mongoose from "mongoose";

/**
 * CouponUserUsage — strict per-user redemption counter.
 *
 * Per-user limits can't be enforced by counting CouponRedemption rows (a count +
 * insert is not atomic, so two concurrent checkouts both pass). Instead we keep one
 * counter doc per {coupon, user} and increment it with a guarded atomic upsert:
 *
 *   findOneAndUpdate({ coupon, user, count: { $lt: limit } },
 *                    { $inc: { count: 1 } }, { upsert: true })
 *
 * If an over-limit doc already exists the filter misses, the upsert tries to INSERT,
 * and the unique {coupon, user} index throws a duplicate-key error — caught by the
 * caller as "usage limit reached". Fully atomic, no TOCTOU window.
 */
const CouponUserUsageSchema = new mongoose.Schema({
  coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
  user:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  count:  { type: Number, default: 0, min: 0 }
}, { timestamps: true });

CouponUserUsageSchema.index({ coupon: 1, user: 1 }, { unique: true });

export default mongoose.model("CouponUserUsage", CouponUserUsageSchema);
