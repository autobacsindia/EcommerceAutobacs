import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true 
  },
  description: { 
    type: String, 
    required: true 
  },
  shortDescription: {
    type: String,
    maxlength: 200
  },
  price: { 
    type: Number, 
    required: true,
    min: 0
  },
  originalPrice: {
    type: Number,
    min: 0
  },
  categories: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Category"
  }],
  brand: {
    type: String,
    trim: true
  },
  images: [{
    url: { type: String, required: true },
    alt: { type: String },
    isPrimary: { type: Boolean, default: false }
  }],
  stock: { 
    type: Number, 
    required: true,
    min: 0,
    default: 0
  },
  sku: {
    type: String,
    unique: true,
    sparse: true
  },
  compatibleVehicles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vehicle"
  }],
  specifications: [{
    key: { type: String },
    value: { type: String }
  }],
  features: [String],
  whyChoose: [String],
  packageContents: [String],
  qna: [{
    question: { type: String, required: true },
    answer: { type: String, required: true }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isFastMoving: {
    type: Boolean,
    default: false
  },
  isOfferFeatured: {
    type: Boolean,
    default: false
  },
  offerStartDate: {
    type: Date
  },
  offerEndDate: {
    type: Date
  },
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  },
  tags: [String],
  variableSpecs: [{
    key: { type: String, required: true },
    options: [{
      label: { type: String, required: true },
      price: { type: Number, required: true, min: 0 }
    }]
  }],
  externalId: {
    type: String,
    unique: true,
    sparse: true
  }
}, { 
  timestamps: true 
});

// Indexes for better query performance
ProductSchema.index({ name: 'text', description: 'text', tags: 'text', brand: 'text' });
ProductSchema.index({ categories: 1, isActive: 1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ brand: 1 });
ProductSchema.index({ averageRating: -1 });
ProductSchema.index({ stock: 1 });

export default mongoose.model("Product", ProductSchema);
