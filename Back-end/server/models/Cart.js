import mongoose from "mongoose";

const CartSchema = new mongoose.Schema({
  // Support both authenticated users and guest sessions
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: false, // Make optional for guest checkout
    unique: true
  },
  sessionId: {
    type: String,
    required: false, // Optional for guest sessions
    unique: true,
    sparse: true // Allow multiple nulls but ensure unique non-null values
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
      default: Date.now,
      expires: 300 // Auto-expire after 5 minutes (TTL index)
    }
  }]
}, { 
  timestamps: true 
});

// Create TTL index for recentChanges
CartSchema.index({ recentChanges: 1 }, { expireAfterSeconds: 300 });

// Calculate totals before saving
CartSchema.pre('save', function(next) {
  this.totalItems = this.items.reduce((sum, item) => sum + item.quantity, 0);
  this.totalPrice = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  next();
});

export default mongoose.model("Cart", CartSchema);
