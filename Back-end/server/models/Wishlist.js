import mongoose from "mongoose";

const WishlistSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true,
    unique: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { 
  timestamps: true 
});

// Index for user lookup
WishlistSchema.index({ user: 1 });
WishlistSchema.index({ 'items.product': 1 });

export default mongoose.model("Wishlist", WishlistSchema);
