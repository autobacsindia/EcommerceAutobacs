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
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
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
    url:        { type: String, required: true },   // Cloudinary secure_url or external URL
    public_id:  { 
                  type: String,
                  // Require public_id ONLY for Cloudinary images
                  // External images (if any) won't break
                  required: function() {
                    return this.url && this.url.includes('cloudinary.com');
                  }
                },                   // Cloudinary public_id — required for cleanup
    alt:        { type: String },
    isPrimary:  { type: Boolean, default: false }
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
      price: { type: Number, required: true, min: 0 },
      image: { type: String }, // Keep for backward compatibility
      images: [String] // Array of image URLs
    }]
  }],
  externalId: {
    type: String,
    unique: true,
    sparse: true
  },
  
  // WordPress/WooCommerce sync fields
  wpId: {
    type: Number,
    unique: true,
    sparse: true, // Allow null for non-WP products
    index: true
  },
  wpSlug: String,
  syncedFromWordPress: {
    type: Boolean,
    default: false,
    index: true
  },
  lastSyncedAt: Date,
  salePrice: {
    type: Number,
    min: 0
  },
  regularPrice: {
    type: Number,
    min: 0
  },
  categoryIds: [{
    type: Number // WordPress category IDs (for sync mapping)
  }]
}, { 
  timestamps: true 
});

// Indexes for better query performance
// OPTIMIZED: Removed 'description' from text index to reduce RAM usage
// Description fields are large (KBs per product) and waste memory
ProductSchema.index({ name: 'text', tags: 'text', brand: 'text' });

// UNIQUE indexes
ProductSchema.index({ slug: 1 }, { unique: true }); // Product URLs

// COMPOUND indexes for common query patterns
ProductSchema.index({ brand: 1, isActive: 1, createdAt: -1 }); // Brand filtering + sorting (NEW ARRIVALS by brand)
ProductSchema.index({ categories: 1, price: 1, isActive: 1 }); // Category + price range filtering
ProductSchema.index({ isActive: 1, createdAt: -1 }); // New arrivals / homepage (filters + sorts)

// SINGLE-FIELD indexes for specific queries
ProductSchema.index({ averageRating: -1 }); // Top rated products
ProductSchema.index({ stock: 1 }); // Stock management
ProductSchema.index({ compatibleVehicles: 1 }); // Vehicle-specific products
ProductSchema.index({ isFeatured: 1 }); // Featured products
ProductSchema.index({ isFastMoving: 1 }); // Fast-moving products

// WordPress sync indexes
ProductSchema.index({ wpId: 1 }); // Fast lookup by WordPress ID
ProductSchema.index({ syncedFromWordPress: 1 }); // Filter synced products

export default mongoose.model("Product", ProductSchema);
