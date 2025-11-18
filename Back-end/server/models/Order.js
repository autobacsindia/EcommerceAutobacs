import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  items: [
    {
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
  totalAmount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded"], 
    default: "pending" 
  },
  trackingNumber: String,
  estimatedDelivery: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  notes: String
}, { 
  timestamps: true 
});

// Indexes for order queries
OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ trackingNumber: 1 });

export default mongoose.model("Order", OrderSchema);
