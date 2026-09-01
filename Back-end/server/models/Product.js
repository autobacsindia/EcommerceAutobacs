import mongoose from "mongoose";
import { enqueueNotification } from '../queue/queues.js';
import { STOCK_STATUS, STOCK_VALUES, normalizeStockValue, stockRankFor } from '../utils/stockStatus.js';
import { snapshotStock, diffRecoveredTargets } from '../utils/restockDetect.js';
import SeoSchema from './shared/seoSchema.js';
import { slugify, generateUniqueSlug } from '../utils/slug.js';

// One selectable model of a `variable` product (e.g. the car model a filter fits).
// Each variant carries its OWN price + stock status, independent of its siblings —
// the shopper picks one on the PDP and that variant's price is what gets charged.
// `_id` (the subdoc id) is the canonical variant identifier used by cart/order/API;
// `wpVariationId` only maps back to the WooCommerce variation during import/sync.
/**
 * Is this an image WE host, and therefore one we are responsible for deleting?
 *
 * Kept as an explicit host allowlist rather than "anything that is not
 * external": a new provider must be added here deliberately, so the failure
 * mode is a loud validation error on save rather than a silent leak.
 *
 * R2_PUBLIC_BASE_URL is read at call time — scripts load dotenv after the model
 * graph is built, so a value captured at import would be empty and would exempt
 * every R2 image from the requirement.
 */
export const isHostedImageUrl = (url) => {
  if (typeof url !== 'string' || !url) return false;
  if (url.includes('cloudinary.com')) return true;
  const base = process.env.R2_PUBLIC_BASE_URL || '';
  if (!base) return false;
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
};

const VariantSchema = new mongoose.Schema({
  wpVariationId: { type: Number, index: true, sparse: true },
  // Human-facing model name, e.g. "COROLLA ALTIS 1.8 P". Built from the WC
  // variation's attribute option(s); for multi-attribute products it's the
  // options joined, e.g. "Black / XL".
  label: { type: String, required: true, trim: true },
  // The raw attribute pairs the label is built from. Stored so a future
  // multi-dropdown UI can resolve a variant from a combination without a reparse.
  attributes: [{
    name:   { type: String, trim: true },   // e.g. "models"
    option: { type: String, trim: true }     // e.g. "COROLLA ALTIS 1.8 P"
  }],
  // Same price semantics as the parent Product: `price` is the charged price,
  // `originalPrice` the slashed "was" (set only when genuinely on sale), and an
  // optional per-variant sale window (saleEndsAt) that the pricing service's
  // read-time guard honours exactly like it does for simple products.
  price:         { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, min: 0 },
  salePrice:     { type: Number, min: 0 },
  saleEndsAt:    { type: Date, default: null },
  // Per-variant availability (coarse status, mirrors Product.stock).
  stock: { type: String, enum: STOCK_VALUES, default: STOCK_STATUS.IN },
  sku:   { type: String, trim: true }
}, { _id: true });

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
    lowercase: true,
    trim: true
  }, // unique index declared in the index block below (avoids duplicate-index warning)
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
    url:        { type: String, required: true },   // hosted secure_url or external URL
    public_id:  {
                  type: String,
                  /*
                    The delete handle. Without it, removing an image from a
                    product deletes the Mongo row and leaks the object: nothing
                    references it and nothing can address it, so no cleanup
                    sweep will ever find it. That is not hypothetical — the same
                    shape produced 1.68 GB of unreachable careers uploads.

                    Required for every image WE host, on any provider. The
                    earlier rule tested `url.includes('cloudinary.com')`, which
                    silently exempted R2 the moment uploads moved there —
                    a gap that would have started leaking on cutover day with
                    no error anywhere.

                    Still optional for genuinely external URLs (legacy
                    wp-content, stock photography): we cannot delete what we do
                    not own, so demanding a handle for it would only block saves.
                  */
                  required: function () {
                    return isHostedImageUrl(this.url);
                  },
                },
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

  /**
   * Availability sort key: 0 = purchasable, 1 = out/backorder. DERIVED from
   * `stock` — never set it by hand; see stockRankFor() and the sync hooks below.
   *
   * It exists because neither engine can sort correctly on `stock` itself. The
   * enum sorts alphabetically (backorder < in < low < out), so `.sort({stock:1})`
   * put backorder FIRST on every browse page, and Atlas ignores relevance score
   * whenever an explicit sort is set, so the availability boost cannot cover the
   * browse case either. A number is the only key both can agree on.
   *
   * No Mongoose index is declared: prod runs autoIndex:false, so a declared index
   * is not a built one, and adding it here would show up as drift without ever
   * being created. If the fallback's browse sort needs one, that is a deliberate
   * migration plus an ensure-production-indexes.js entry.
   */
  stockRank: { type: Number, default: 0, select: true },

  /**
   * Trailing-sales popularity, time-decayed. DERIVED from paid orders by
   * services/salesScoreService.js on a nightly cron — never set by hand.
   *
   * It replaces `isFastMoving` as the commercial ranking signal. That flag was
   * manual, dead (its section is never rendered), and set on 3 of 931 products,
   * so it handed three arbitrary items a permanent boost on every search. With
   * only 5 products carrying any review or rating, this is the only signal that
   * distinguishes a best seller from something that has never sold.
   *
   * No Mongoose index, deliberately: search ranking reads this from the Atlas
   * index, not from MongoDB, and prod runs autoIndex:false so a declared index
   * would show as drift without ever being built.
   */
  salesScore: { type: Number, default: 0 },
  sku: {
    type: String,
    unique: true,
    sparse: true
  },
  // Product type (mirrors WooCommerce). 'simple' = one price/stock (the default,
  // covers the vast majority). 'variable' = the shopper picks a model/variant and
  // that variant's price is charged (see variants[] below). 'grouped' is accepted
  // for parity/filtering but has no dedicated buy behaviour yet.
  productType: {
    type: String,
    enum: ['simple', 'variable', 'grouped'],
    default: 'simple',
    index: true
  },
  // Selectable models for a 'variable' product. Empty for simple products.
  // Derivation hook keeps priceMin/priceMax + the parent price/stock in sync
  // with these on every save (see pre-validate below).
  variants: { type: [VariantSchema], default: [] },
  // Cheapest / dearest variant price — drives the "₹X – ₹Y" range on the PDP and
  // card, sort/filter, and the min used for coupon thresholds. For simple products
  // both equal `price`.
  priceMin: { type: Number, min: 0 },
  priceMax: { type: Number, min: 0 },
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
  // "What's in the box" — one pointer per line (NOT a paragraph). Migrated from the
  // WooCommerce "Package"/"Package Includes" custom tab (yikes_woo_products_tabs);
  // see utils/wcCustomTabs.js. Rendered as a bulleted list on the PDP.
  packageContents: [String],
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

  // Return / cancellation eligibility for this product (see config/returnPolicy.js
  // and the signed Roavion policy). Defaults keep every product returnable +
  // cancellable so existing/imported products behave exactly as before; the admin
  // product editor flips these for the policy's non-returnable classes.
  //   returnable  = false → the item can never be returned (electrical/electronic,
  //                 custom/made-to-order, imported kits, or installed items).
  //   cancellable = false → the order cannot be cancelled once confirmed (custom
  //                 builds / installation bookings — advance is forfeited).
  //   nonReturnReason = which policy class made it non-returnable (label/audit only).
  returnPolicy: {
    returnable:  { type: Boolean, default: true },
    cancellable: { type: Boolean, default: true },
    nonReturnReason: {
      type: String,
      enum: ['electrical', 'custom', 'imported', 'installed', null],
      default: null,
    },
  },

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
    type: Number
  }, // unique + sparse index declared in the index block below
  wpSlug: String,
  syncedFromWordPress: {
    type: Boolean,
    default: false
  }, // index declared in the index block below
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
// Declared retroactively from $indexStats (2026-08-21): these were hand-built in
// production and existed in NO schema, so `audit-index-drift` reported them as EXTRA
// forever and `--allow-drop` would have deleted indexes that real traffic depends on.
// The ops counts below are measured over a 162h window, not assumed.
ProductSchema.index({ isActive: 1, stock: 1 });        // 3,495 ops — availability filtering
ProductSchema.index({ categories: 1, isActive: 1 });   // 1,876 ops — category listing (categories-first)
ProductSchema.index({ price: 1 });                     //     9 ops — price sort on the catalogue

ProductSchema.index({ averageRating: -1 }); // Top rated products
ProductSchema.index({ stock: 1 }); // Stock management
ProductSchema.index({ compatibleVehicles: 1 }); // Vehicle-specific products
ProductSchema.index({ isFastMoving: 1 }); // Fast-moving products

// WordPress sync indexes
ProductSchema.index({ wpId: 1 }, { unique: true, sparse: true }); // Fast lookup by WordPress ID (unique; sparse allows null for non-WP products)
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
// Keep variable-product aggregates in sync with variants[] BEFORE validation, so
// the required `price` passes even when the admin/importer only sends variants.
//   • variable → priceMin/priceMax = cheapest/dearest variant; parent `price` =
//     priceMin (back-compat for sort/coupon-min/ES); parent `stock` = IN if any
//     variant is purchasable, else OUT. Must have ≥1 variant.
//   • simple/grouped → clear variants; priceMin/priceMax mirror `price`.
ProductSchema.pre('validate', function () {
  if (this.productType === 'variable') {
    const variants = Array.isArray(this.variants) ? this.variants : [];
    if (variants.length === 0) {
      this.invalidate('variants', 'A variable product must have at least one variant');
      return;
    }
    const prices = variants.map(v => v.price).filter(p => typeof p === 'number' && !Number.isNaN(p));
    if (prices.length) {
      this.priceMin = Math.min(...prices);
      this.priceMax = Math.max(...prices);
      // Parent price mirrors the cheapest variant so existing price-based sort,
      // coupon minimums and search ranking keep working unchanged.
      this.price = this.priceMin;
    }
    // Parent stock = best availability among variants: any in/low → IN;
    // else any backorder → BACKORDER; else OUT (mirrors aggregateFromVariants).
    const anyInStock = variants.some(v => v.stock === STOCK_STATUS.IN || v.stock === STOCK_STATUS.LOW);
    const anyBackorder = variants.some(v => v.stock === STOCK_STATUS.BACKORDER);
    this.stock = anyInStock ? STOCK_STATUS.IN : anyBackorder ? STOCK_STATUS.BACKORDER : STOCK_STATUS.OUT;
  } else {
    // Non-variable: no variants, and the range collapses to the single price.
    if (this.variants?.length) this.variants = [];
    if (typeof this.price === 'number') {
      this.priceMin = this.price;
      this.priceMax = this.price;
    }
  }
});

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

// ── Back-in-stock notification hooks ──────────────────────────────────────────
// When an item transitions out → purchasable (in/low), fan out an email to every
// customer who asked to be notified (see models/StockNotificationRequest.js and
// queue/workers/notificationWorker.js). Detection is a before/after snapshot diff
// (utils/restockDetect.js): per-variant for variable products, whole-item for
// simple ones. Enqueue is fire-and-forget — a queue outage must never fail the
// stock write. The prior-state read is only taken when the write actually touches
// `stock`/`variants`, so non-availability updates (price edits, SEO, etc.) pay nothing.

function enqueueRestock(before, after, productId) {
  for (const variantId of diffRecoveredTargets(before, after)) {
    notifyRestockForTarget(productId, variantId);
  }
}

// Explicit escape hatch for bulk stock writes that BYPASS the document hooks below.
// `updateMany` / `bulkWrite` fire no per-doc middleware, so a future bulk "mark
// back in stock" path (there is none today) must enqueue restock itself. Keeps the
// job name/shape in one place.
export function notifyRestockForTarget(productId, variantId = null) {
  enqueueNotification('notify-back-in-stock', {
    productId: productId.toString(),
    variantId: variantId != null ? variantId.toString() : null,
  });
}

// save() path — admin create/edit (full-document), WooCommerce sync inserts.
ProductSchema.pre('save', async function () {
  this._stockBefore = null;
  if (this.isNew || !(this.isModified('stock') || this.isModified('variants'))) return;
  const prior = await this.constructor.findById(this._id).select('stock variants').lean();
  this._stockBefore = snapshotStock(prior);
});

ProductSchema.post('save', function (doc) {
  if (doc._stockBefore) enqueueRestock(doc._stockBefore, snapshotStock(doc), doc._id);
});

// findByIdAndUpdate / findOneAndUpdate path — admin quick stock edit, variable
// product edit, WooCommerce sync updates. Only snapshot when the update payload
// could change availability, so non-availability updates (price/SEO) pay nothing.
ProductSchema.pre('findOneAndUpdate', async function () {
  this._stockBefore = null;
  // Mongoose may carry fields both at the top level AND inside $set (it appends a
  // $set for the timestamp), so check both places — not `upd.$set || upd`.
  const upd = this.getUpdate() || {};
  const touches = (obj) => obj && ('stock' in obj || 'variants' in obj);
  if (!touches(upd) && !touches(upd.$set)) return;
  const prior = await this.model.findOne(this.getFilter()).select('stock variants').lean();
  this._stockBefore = snapshotStock(prior);
});

ProductSchema.post('findOneAndUpdate', async function (doc) {
  if (!this._stockBefore || !doc) return;
  // When the caller asked for the updated doc ({ new: true } / returnDocument:
  // 'after'), `doc` already reflects post-update state — reuse it and skip a second
  // read (the common admin path). The WooCommerce-sync path omits that option, so
  // `doc` there is the pre-update version and we must re-read the fresh state.
  const opts = this.getOptions();
  const returnsNew = opts.new === true || opts.returnDocument === 'after' || opts.returnOriginal === false;
  const after = returnsNew ? doc : await this.model.findById(doc._id).select('stock variants').lean();
  enqueueRestock(this._stockBefore, snapshotStock(after), doc._id);
});

/**
 * Keep `stockRank` consistent with `stock`, on every Mongoose write path.
 *
 * The field is denormalized, so it is only trustworthy if nothing can change
 * `stock` without it. Three hooks cover the three ways `stock` actually moves in
 * this codebase: document saves (admin editor), findOneAndUpdate (admin quick edit,
 * WooCommerce sync) and updateOne/updateMany (bulk admin actions, importers).
 *
 * ⚠ What these CANNOT cover is `bulkWrite` and raw-driver writes, which bypass
 * middleware entirely. That is not a theoretical gap — it is how the Elasticsearch
 * index used to drift. The guard for it is scripts/backfill-stock-rank.js (which
 * both backfills and audits) plus the drift test in tests/unit/models/stockRank.test.js,
 * NOT a promise that every caller remembers.
 */
function applyStockRankToUpdate(update) {
  if (!update) return;
  // Mongoose carries fields both at the top level and inside $set (it appends a
  // $set for timestamps), so a payload can set `stock` in either place.
  for (const container of [update, update.$set]) {
    if (container && typeof container === 'object' && 'stock' in container) {
      const rank = stockRankFor(normalizeStockValue(container.stock));
      if (update.$set) update.$set.stockRank = rank;
      else update.stockRank = rank;
      return;
    }
  }
}

ProductSchema.pre('save', function () {
  // Runs on create as well as edit: a new product must not default to rank 0 when
  // it is created out of stock.
  if (this.isNew || this.isModified('stock')) {
    this.stockRank = stockRankFor(normalizeStockValue(this.stock));
  }
});

ProductSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function () {
  applyStockRankToUpdate(this.getUpdate());
});

export default mongoose.model("Product", ProductSchema);
