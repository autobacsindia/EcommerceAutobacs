import mongoose from "mongoose";

const ReviewSchema = new mongoose.Schema({
  product: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Product",
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    // Customer-submitted reviews carry a user. Imported WooCommerce reviews (wpId) and
    // admin-authored/manual reviews (guestName) are user-less. (ADR-005)
    required: function () { return !this.wpId && !this.guestName; }
  },
  // WooCommerce migration linkage (ADR-005) + guest reviewer identity.
  wpId: { type: Number, index: { unique: true, sparse: true } },
  guestName: { type: String, trim: true },
  guestEmail: { type: String, trim: true, lowercase: true },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    trim: true,
    maxlength: 100
  },
  comment: {
    type: String,
    // Migrated reviews may be rating-only; live reviews require a comment.
    required: function () { return !this.wpId; },
    trim: true,
    maxlength: 1000
  },
  images: [{
    url: String,
    alt: String
  }],
  isVerifiedPurchase: {
    type: Boolean,
    default: false
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  helpfulCount: {
    type: Number,
    default: 0
  },
  // Promote a review to the homepage testimonials section (admin-toggled). Any review —
  // customer, imported, or manual — can be flagged. (ADR-005)
  isTestimonial: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Prevent duplicate reviews from same user for same product.
// Partial so guest/migrated reviews (user unset) don't collide on a null user.
ReviewSchema.index(
  { product: 1, user: 1 },
  { unique: true, partialFilterExpression: { user: { $exists: true } } }
);
ReviewSchema.index({ product: 1, isApproved: 1 });
// Homepage testimonials feed (approved + flagged).
ReviewSchema.index({ isTestimonial: 1, isApproved: 1 });

export default mongoose.model("Review", ReviewSchema);
