import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema({
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
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: "INR"
  },
  paymentMethod: {
    // `other` is a deliberate catch-all: gateways add methods over time (cardless_emi,
    // paylater, bank_transfer…). The mapper normalizes unknowns to `other` so a valid
    // capture is never rejected by enum validation inside the payment transaction
    // (which would strand captured money in an unrecorded state). Raw method is always
    // retained in paymentDetails.
    type: String,
    enum: ["credit_card", "debit_card", "upi", "net_banking", "wallet", "cod", "emi", "other"],
    required: true
  },
  paymentGateway: {
    type: String,
    enum: ["razorpay", "stripe", "payu", "cashfree"],
    required: true
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },
  gatewayOrderId: {
    type: String
  },
  gatewayPaymentId: {
    type: String
  },
  status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed", "refunded", "cancelled"],
    default: "pending"
  },
  paymentDetails: {
    type: mongoose.Schema.Types.Mixed
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  refundReason: {
    type: String
  },
  refundedAt: {
    type: Date
  },
  failureReason: {
    type: String
  }
}, { 
  timestamps: true 
});

// Indexes for payment tracking
PaymentSchema.index({ order: 1 });
PaymentSchema.index({ user: 1 });
PaymentSchema.index({ status: 1 });

// MONEY-CRITICAL: gatewayPaymentId is globally unique per gateway capture. This unique
// index is the hard serialization point that makes payment processing idempotent under
// concurrent/duplicate webhook deliveries (Razorpay delivers at-least-once). Two racing
// transactions inserting the same id resolve to one commit + one retryable WriteConflict,
// never two Payment rows. Partial on $type:string so legacy/null gatewayPaymentId docs
// (e.g. migrated WooCommerce orders) are excluded and don't collide on null.
PaymentSchema.index(
  { gatewayPaymentId: 1 },
  { unique: true, partialFilterExpression: { gatewayPaymentId: { $type: "string" } } }
);

export default mongoose.model("Payment", PaymentSchema);
