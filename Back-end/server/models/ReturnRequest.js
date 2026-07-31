import mongoose from "mongoose";
import { RETURN_REASONS, ACTIVE_RETURN_STATUSES } from "../config/returnPolicy.js";

/**
 * A private (authenticated) Cloudinary asset attached to a return — the unboxing
 * video, proof-of-purchase, or an extra photo. We persist ONLY server-derived
 * values (publicId + type + bytes); the browsable URL is re-signed at view time
 * by an admin. Mirrors JobApplication.files so a leaked plain URL is useless.
 */
const CloudAssetSchema = new mongoose.Schema({
  publicId:     { type: String, required: true },
  resourceType: { type: String, enum: ["video", "image", "raw"], required: true },
  bytes:        { type: Number, default: 0 },
}, { _id: false });

const ReturnRequestSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    // Set for a returned line of a variable product (which variant was bought).
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    reason: {
      type: String,
      enum: RETURN_REASONS,
      required: true
    },
    // Charged price of ONE unit at request time (rupees). Snapshotted from the
    // order line so the refund calculation never re-reads a since-changed product
    // price. Sum(unitPrice × quantity) is the refundable product value.
    unitPrice: { type: Number, required: true, min: 0 }
  }],
  // Exchanges + store-credit were dropped by operations (2026-07-31). Every
  // accepted return refunds to the original payment method. Kept as a pinned
  // field for analytics / forward compatibility.
  type: {
    type: String,
    enum: ["return"],
    default: "return"
  },
  // Lifecycle:
  //   pending        → submitted, awaiting operations review
  //   approved       → operations approved; return courier to be booked by us
  //   courier_booked → pickup arranged (we always book the courier)
  //   received       → item is back at the warehouse
  //   refunded       → passed inspection and refund initiated to original payment
  //   rejected       → declined at review OR failed inspection (see rejectionReason)
  //   cancelled      → customer withdrew the request
  status: {
    type: String,
    enum: ["pending", "approved", "courier_booked", "received", "refunded", "rejected", "cancelled"],
    default: "pending"
  },

  // ── Mandatory documentation (all three required to submit; enforced in the
  //    controller against Cloudinary — matches "all three required or rejected").
  video:              { type: CloudAssetSchema, default: null }, // continuous unboxing video
  proofOfPurchase:    { type: CloudAssetSchema, default: null }, // invoice / payment proof
  problemDescription: { type: String, required: true, trim: true, maxlength: 2000 },
  images:             { type: [CloudAssetSchema], default: [] }, // optional extra photos

  // Who bears the return courier. All accepted reasons are Roavion-attributable,
  // so this defaults to 'roavion'; operations can flip it (goodwill/discretion)
  // and enter the actual shipping deduction when initiating the refund.
  shippingBorneBy: { type: String, enum: ["roavion", "customer"], default: "roavion" },
  courier: {
    provider:       String,
    trackingNumber: String,
    bookedAt:       Date,
    bookedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },

  // Warehouse inspection outcome. Refund is gated on `passed === true`; a failed
  // inspection moves the request to `rejected` with the reason.
  inspection: {
    passed: { type: Boolean, default: null },
    notes:  String,
    at:     Date,
    by:     { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },

  // Refund is decided BY HAND at initiation (full, or minus shipping / restocking).
  // All amounts in rupees. finalAmount is what is sent to Razorpay.
  refund: {
    productValue:         { type: Number, default: 0 }, // Σ(unitPrice × qty) of returned lines
    shippingDeduction:    { type: Number, default: 0 }, // manual, variable
    restockingDeduction:  { type: Number, default: 0 }, // 10% on >₹1L (suggested) / oversized (manual)
    finalAmount:          { type: Number, default: 0 },
    method:               { type: String, enum: ["original_payment"], default: "original_payment" },
    razorpayRefundId:     String,
    status:               { type: String, enum: ["pending", "processing", "completed", "failed"], default: "pending" },
    initiatedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    initiatedAt:          Date,
    completedAt:          Date,
    failureReason:        String,
    // Once-only guard for the net-LTV reversal (subtract finalAmount from the
    // customer's totalSpentPaise). Flipped atomically the first time a completed
    // refund reverses LTV, so the immediate-completion path and the refund.processed
    // webhook can't both decrement (PAY-2 / ADR-006, partial-refund variant).
    ltvReversed:          { type: Boolean, default: false }
  },

  adminNotes:      String,
  rejectionReason: String,

  // Email idempotency stamp: set once the "request received" acknowledgement is
  // accepted by the provider, so a queue retry never double-mails the customer.
  submittedEmailedAt: { type: Date, default: null },

  timeline: [{
    status:    String,
    note:      String,
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }]
}, {
  timestamps: true
});

// Index for faster lookups
ReturnRequestSchema.index({ user: 1, status: 1 });
ReturnRequestSchema.index({ order: 1 });
ReturnRequestSchema.index({ status: 1, createdAt: -1 }); // admin queue (filter + sort)
// DB-level idempotency: one ACTIVE (non-cancelled) return per order+product pair.
// This is the race-safe backstop the controller pre-check relies on — two
// concurrent POST /returns for the same line both pass the findOne check, then the
// second create() hits E11000 here instead of creating a duplicate return.
//   - `unique: true` is what actually enforces it (was missing → enforced nothing).
//   - The partial filter MUST use `$in` (an enumerated positive set): `$ne` is not a
//     supported operator in a partialFilterExpression, so the previous `$ne:'cancelled'`
//     form threw at index build and the index was never created at all. The status
//     list lives in returnPolicy.js so the controller pre-check uses the identical set.
// Multikey (items.product is an array): each returned line contributes a key, so the
// uniqueness is per (order, product) across active returns — exactly the guarantee.
// autoIndex is off in prod, so db.js ensureCriticalIndexes builds this there too.
ReturnRequestSchema.index(
  { order: 1, 'items.product': 1 },
  {
    name: 'unique_active_return_per_order_product',
    unique: true,
    partialFilterExpression: { status: { $in: ACTIVE_RETURN_STATUSES } }
  }
);

export default mongoose.model("ReturnRequest", ReturnRequestSchema);
