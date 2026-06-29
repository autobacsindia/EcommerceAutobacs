import mongoose from "mongoose";

/**
 * CouponRedemption — append-only audit record, one per coupon use on an order.
 *
 * The unique {coupon, order} index makes redemption idempotent: a retried order
 * write can never double-count the same coupon. Released (coupon decremented) when
 * an order is cancelled before fulfilment.
 */
const CouponRedemptionSchema = new mongoose.Schema({
  coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
  user:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  order:  { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  code:   { type: String, required: true },   // snapshot — survives coupon edits/deletes
  discountAmount: { type: Number, required: true, min: 0 }
}, { timestamps: true });

CouponRedemptionSchema.index({ coupon: 1, order: 1 }, { unique: true });
CouponRedemptionSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("CouponRedemption", CouponRedemptionSchema);
