import mongoose from "mongoose";

const WishlistItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    maxlength: 200
  }
});

const SharedUserSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  role: {
    type: String,
    enum: ["viewer", "editor"],
    default: "viewer"
  },
  sharedAt: {
    type: Date,
    default: Date.now
  }
});

const WishlistSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    maxlength: 500
  },
  privacy: {
    type: String,
    enum: ["private", "public", "shared"],
    default: "private"
  },
  items: [WishlistItemSchema],
  sharedWith: [SharedUserSchema],
  shareToken: {
    type: String
  }
}, { 
  timestamps: true 
});

// Index for user lookup
WishlistSchema.index({ user: 1 });
WishlistSchema.index({ 'items.product': 1 });
WishlistSchema.index({ shareToken: 1 });

// Ensure unique wishlist names per user
WishlistSchema.index({ user: 1, name: 1 }, { unique: true });

export default mongoose.model("Wishlist", WishlistSchema);