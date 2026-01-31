import mongoose from "mongoose";

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
    quantity: { 
      type: Number, 
      required: true,
      min: 1 
    },
    reason: {
      type: String,
      enum: ["defective", "wrong_item", "other"],
      required: true
    },
    condition: {
      type: String,
      enum: ["unopened", "opened", "damaged"],
      default: "opened"
    }
  }],
  type: {
    type: String,
    enum: ["return", "exchange"],
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "item_received", "completed", "cancelled"],
    default: "pending"
  },
  images: [{
    url: String,
    description: String
  }],
  video: {
    url: String,
    description: String
  },
  refundMethod: {
    type: String,
    enum: ["store_credit", "original_payment"],
    default: "store_credit"
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  replacementOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order"
  },
  adminNotes: String,
  rejectionReason: String,
  timeline: [{
    status: String,
    note: String,
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }]
}, { 
  timestamps: true 
});

// Index for faster lookups
ReturnRequestSchema.index({ user: 1, status: 1 });
ReturnRequestSchema.index({ order: 1 });

export default mongoose.model("ReturnRequest", ReturnRequestSchema);
