import mongoose from "mongoose";
import { getSearchSyncQueue } from '../queue/queues.js';
import { STOCK_STATUS, STOCK_VALUES, normalizeStockValue } from '../utils/stockStatus.js';
import SeoSchema from './shared/seoSchema.js';
import { slugify, generateUniqueSlug } from '../utils/slug.js';

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
  // Optional sale window end. When set AND originalPrice > price, the product is
  // "on sale": `price` is the sale price, `originalPrice` is shown slashed, and a
  // live countdown runs on the PDP. Once this passes, the effective price reverts
  // UP to originalPrice (see pricingService read-time guard) and a cron sweep
  // normalizes the stored fields (price←originalPrice, clears originalPrice +
  // saleEndsAt). null/absent = no time-boxed sale.
  saleEndsAt: {
    type: Date,
    default: null
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

  // SEO metadata overrides (meta title/description, canonical, OG image,
  // noindex, internal focus keyword). All optional — blank fields fall back to
  // values derived from the product on the frontend. See models/shared/seoSchema.js.
  seo: { type: SeoSchema, default: () => ({}) },

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

// Sparse index drives the sale-expiry sweep (cronService) — only products with
// an active sale window carry a saleEndsAt, so the scan stays tiny.
ProductSchema.index({ saleEndsAt: 1 }, { sparse: true });

// Derive `slug` from `name` when the caller didn't supply one. `slug` is required
// and unique, but nothing upstream guarantees it: the admin create form never sends
// one, so every create used to die on a ValidationError. Server-side derivation also
// covers API clients, import scripts and the WooCommerce sync.
//
// Only runs when slug is absent — an explicitly supplied slug (admin edit form,
// WooCommerce's own slug) is normalized but never renamed, so URLs stay stable.
ProductSchema.pre('validate', async function () {
  if (this.slug) {
    this.slug = slugify(this.slug);
    return;
  }
  // No name either — let the `name` required-validator produce the error.
  const base = slugify(this.name);
  if (!base) return;

  this.slug = await generateUniqueSlug(this.constructor, base, { excludeId: this._id });
});

// Automatically exclude soft-deleted products from all find queries.
// Pass { includeDeleted: true } via .setOptions() to bypass (admin use only).
ProductSchema.pre(/^find/, function () {
  if (!this.getOptions().includeDeleted) {
    this.where({ deletedAt: null });
  }
});

// Read guard: coerce any legacy/stray `stock` value to a valid status on the
// way out. Until the numeric→status migration runs, the DB may still hold
// numeric stock (e.g. the 999 import sentinel); this keeps every API response
// — including .lean() queries — within the enum. Self-heals nothing in the DB;
// run scripts/migrate-stock-to-status.js for that.
function coerceStock(doc) {
  if (doc && typeof doc === 'object' && 'stock' in doc) {
    const normalized = normalizeStockValue(doc.stock);
    if (doc.stock !== normalized) doc.stock = normalized;
  }
}

ProductSchema.post(/^find/, function (res) {
  if (Array.isArray(res)) res.forEach(coerceStock);
  else coerceStock(res);
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

// Public helper for bulk writes that BYPASS the document hooks below.
// `Product.updateMany()` fires Mongoose's `updateMany` middleware — which this
// schema does NOT hook — so callers that bulk-mutate products (brand rename /
// mapping, vehicle-fitment mapping) must enqueue sync explicitly or ES silently
// goes stale. Capture the affected _ids BEFORE the updateMany (the filters there
// match on the field being mutated, so a post-update query returns nothing) and
// pass them here afterwards. Reuses enqueueSync so the env guard + per-id job
// dedup stay in one place.
export function enqueueProductSync(ids) {
  if (!ids) return;
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    if (id != null) enqueueSync(id);
  }
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
