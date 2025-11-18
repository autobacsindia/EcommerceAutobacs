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
    type: String,
    enum: ["credit_card", "debit_card", "upi", "net_banking", "wallet", "cod"],
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
PaymentSchema.index({ transactionId: 1 });
PaymentSchema.index({ status: 1 });

export default mongoose.model("Payment", PaymentSchema);
