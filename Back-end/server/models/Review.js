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
    required: true
  },
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
    required: true,
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
  }
}, { 
  timestamps: true 
});

// Prevent duplicate reviews from same user for same product
ReviewSchema.index({ product: 1, user: 1 }, { unique: true });
ReviewSchema.index({ product: 1, isApproved: 1 });

export default mongoose.model("Review", ReviewSchema);
