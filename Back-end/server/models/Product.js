import mongoose from "mongoose";
import { getSearchSyncQueue } from '../queue/queues.js';
import { STOCK_STATUS, STOCK_VALUES } from '../utils/stockStatus.js';

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
  // Canonical Brand.slug this product maps to (stable for URLs/filtering).
  // `brand` holds the display name; both are governed by the Brand registry.
  brandSlug: {
    type: String,
    trim: true,
    index: true
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
  // Availability status (coarse), not a numeric quantity. Admin-managed.
  // See utils/stockStatus.js. No per-unit deduction happens on orders.
  stock: {
    type: String,
    enum: STOCK_VALUES,
    required: true,
    default: STOCK_STATUS.IN
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
  // Complementary products - manually curated items that go well together
  complementaryProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product"
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
  // Editable product-page marketing sections
  productStoryText: { type: String, trim: true },        // Paragraph under "Engineered for Indian Trails"
  productStoryCards: [{                                  // The 4 condition cards in "Engineered for Indian Trails"
    title: { type: String, required: true },
    description: { type: String, required: true }
  }],
  installationSteps: [{                                  // Steps for "Easy DIY Installation"
    title: { type: String, required: true },
    description: { type: String, required: true }
  }],
  indianRoadsText: { type: String, trim: true },         // Paragraph under "Perfect for Indian Roads & Climate"
  indianRoadsCards: [{                                   // The condition cards for "Perfect for Indian Roads & Climate"
    title: { type: String, required: true },
    description: { type: String, required: true }
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
  }],

  // Soft-delete timestamp. null = live product; Date = permanently removed.
  // Distinct from isActive (which means "temporarily disabled / out of stock").
  // Soft-deleting preserves the document so Order.items[].product references
  // remain resolvable and order history stays intact.
  deletedAt: {
    type: Date,
    default: null
  }
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
ProductSchema.index({ isActive: 1, createdAt: -1 });            // New arrivals / homepage (filters + sorts)
ProductSchema.index({ isActive: 1, isFeatured: 1 });            // Homepage featured section — replaces single-field isFeatured index
ProductSchema.index({ isActive: 1, categories: 1 });            // Category page listing (active-first prefix avoids scanning inactive products)

// SINGLE-FIELD indexes for specific queries
ProductSchema.index({ averageRating: -1 }); // Top rated products
ProductSchema.index({ stock: 1 }); // Stock management
ProductSchema.index({ compatibleVehicles: 1 }); // Vehicle-specific products
ProductSchema.index({ isFastMoving: 1 }); // Fast-moving products

// WordPress sync indexes
ProductSchema.index({ wpId: 1 }); // Fast lookup by WordPress ID
ProductSchema.index({ syncedFromWordPress: 1 }); // Filter synced products

// Sparse index for admin "show deleted products" queries
ProductSchema.index({ deletedAt: 1 }, { sparse: true });

// Automatically exclude soft-deleted products from all find queries.
// Pass { includeDeleted: true } via .setOptions() to bypass (admin use only).
ProductSchema.pre(/^find/, function () {
  if (!this.getOptions().includeDeleted) {
    this.where({ deletedAt: null });
  }
});

// ── Elasticsearch sync hooks ──────────────────────────────────────────────────
// Enqueue an async BullMQ job after every write so ES stays in sync with
// MongoDB without blocking the request. Using jobId = productId deduplicates
// pending jobs: if multiple writes hit the same product before the worker
// drains (e.g. rapid stock decrements during concurrent orders), only one
// sync job remains in the queue and it fetches the latest committed state.
//
// Guards: both REDIS_URL and ELASTICSEARCH_ENABLED must be set, otherwise the
// enqueue is skipped entirely (development / ES-disabled environments).

function enqueueSync(productId) {
  if (!process.env.REDIS_URL || process.env.ELASTICSEARCH_ENABLED !== 'true') return;
  const id = productId.toString();
  getSearchSyncQueue()
    .add('es-sync-product', { productId: id }, { jobId: id })
    .catch(err => console.error('[SearchSync] Failed to enqueue sync for', id, ':', err.message));
}

// Fires after doc.save() — covers creates and full-document updates (including
// soft-deletes: controller sets deletedAt then calls save()).
ProductSchema.post('save', function (doc) {
  enqueueSync(doc._id);
});

// Fires after findOneAndUpdate / findByIdAndUpdate — covers partial updates,
// price changes, admin stock edits, atomicDeductStock, etc.
// `doc` is the query result; we only need _id to identify which product changed.
ProductSchema.post('findOneAndUpdate', function (doc) {
  if (!doc) return;
  enqueueSync(doc._id);
});

// Fires after findOneAndDelete / findByIdAndDelete — hard-delete path.
// The worker will find no document for this ID and will call deleteProduct.
ProductSchema.post('findOneAndDelete', function (doc) {
  if (!doc) return;
  enqueueSync(doc._id);
});

// Fires after updateOne / findByIdAndUpdate-via-query (e.g. productRepository
// .updateStock which uses Product.updateOne({ _id }, { $inc: { stock } })).
// `this` is the Query; _id is always present in the filter for these calls.
ProductSchema.post('updateOne', function () {
  const id = this.getFilter()._id;
  if (id) enqueueSync(id);
});

// Fires after deleteMany — covers the WordPress sync service which bulk-deletes
// products that no longer exist in WooCommerce. We capture IDs in a pre-hook
// (before the documents are gone) and enqueue one sync job per deleted product.
ProductSchema.pre('deleteMany', async function () {
  const docs = await this.model
    .find(this.getFilter(), '_id')
    .setOptions({ includeDeleted: true })
    .lean();
  this._idsToSync = docs.map(d => d._id.toString());
});

ProductSchema.post('deleteMany', function () {
  for (const id of (this._idsToSync || [])) {
    enqueueSync(id);
  }
});

export default mongoose.model("Product", ProductSchema);
