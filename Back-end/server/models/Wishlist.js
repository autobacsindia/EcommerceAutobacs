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

// Add comprehensive validation debugging
WishlistItemSchema.pre('validate', function(next) {
  console.log('WishlistItemSchema pre-validate hook:', {
    doc: this.toObject(),
    product: this.product,
    addedAt: this.addedAt,
    notes: this.notes
  });
  
  // Check if product is valid
  if (!this.product) {
    console.error('WishlistItem validation error: product is required');
  }
  
  next();
});

WishlistItemSchema.post('validate', function(doc, next) {
  console.log('WishlistItemSchema post-validate hook:', doc.toObject());
  next();
});

WishlistItemSchema.post('save', function(error, doc, next) {
  if (error.name === 'ValidationError') {
    console.error('WishlistItem save validation error:', {
      error: error,
      message: error.message,
      errors: error.errors
    });
  }
  next(error);
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

// Add comprehensive validation debugging
WishlistSchema.pre('validate', function(next) {
  console.log('WishlistSchema pre-validate hook:', {
    doc: this.toObject(),
    user: this.user,
    name: this.name,
    items: this.items,
    privacy: this.privacy
  });
  
  // Check if user is valid
  if (!this.user) {
    console.error('Wishlist validation error: user is required');
  }
  
  // Check if name is valid
  if (!this.name) {
    console.error('Wishlist validation error: name is required');
  }
  
  next();
});

WishlistSchema.post('validate', function(doc, next) {
  console.log('WishlistSchema post-validate hook:', doc.toObject());
  next();
});

WishlistSchema.post('save', function(error, doc, next) {
  if (error.name === 'ValidationError') {
    console.error('Wishlist save validation error:', {
      error: error,
      message: error.message,
      errors: error.errors
    });
  }
  next(error);
});

// Index for user lookup
WishlistSchema.index({ user: 1 });
WishlistSchema.index({ 'items.product': 1 });
WishlistSchema.index({ shareToken: 1 });

// Ensure unique wishlist names per user
WishlistSchema.index({ user: 1, name: 1 }, { unique: true });

export default mongoose.model("Wishlist", WishlistSchema);