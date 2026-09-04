/**
 * Product Repository - DATA ACCESS LAYER ONLY
 * 
 * This layer is responsible for:
 * - Direct database operations
 * - Query building
 * - Data transformation from DB format
 * 
 * NO business logic should be here!
 */

import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Vehicle from '../models/Vehicle.js';
import Brand from '../models/Brand.js';
import { STOCK_STATUS } from '../utils/stockStatus.js';
import mongoose from 'mongoose';
import { QUERY_TIMEOUTS } from '../config/db.js';

class ProductRepository {
  /**
   * Sitemap data: active, indexable products with a minimal projection
   * (slug + updatedAt only). Excludes seo.noindex products. The pre-find hook
   * already scopes to deletedAt: null.
   *
   * ⚠️ The sort MUST stay total — `updatedAt` alone is not unique, and the
   * caller pages this endpoint with skip/limit. With a non-total sort MongoDB
   * is free to order tied documents differently per query, so a document can
   * land on page 2 in one call and page 3 in the next: it is returned twice and
   * another is never returned at all. On production that silently cost the
   * sitemap 46 of 931 products — 931 rows came back across 4 pages carrying
   * only 885 distinct slugs. Bulk writes stamp many products with an identical
   * `updatedAt`, so ties are the norm here, not an edge case. `_id` is unique,
   * which makes the ordering total and skip/limit deterministic.
   */
  async findSitemap({ limit = 250, skip = 0 } = {}) {
    return Product.find({
      isActive: true,
      slug: { $exists: true, $nin: [null, ''] },
      'seo.noindex': { $ne: true },
    })
      .select('slug updatedAt')
      .sort({ updatedAt: -1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Count of indexable products — drives sitemap shard planning.
   * countDocuments does NOT trigger the /^find/ soft-delete hook, so
   * deletedAt: null is set explicitly here.
   */
  async countSitemap() {
    return Product.countDocuments({
      isActive: true,
      deletedAt: null,
      slug: { $exists: true, $nin: [null, ''] },
      'seo.noindex': { $ne: true },
    }).maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Meta (Facebook/Instagram) catalogue feed data.
   *
   * Same visibility rules as the sitemap — active, non-noindex, has a slug — but a
   * richer projection because the feed carries price/stock/brand/images and the
   * per-variant rows of variable products. Out-of-stock items are INCLUDED on
   * purpose: Meta expects them present (marked `out of stock`) so ad delivery
   * pauses rather than the item vanishing and its ad history resetting.
   *
   * `wpId` / `variants.wpVariationId` are what let the feed reproduce the exact
   * retailer_id the old Facebook-for-WooCommerce plugin wrote, so Meta updates the
   * existing catalogue items in place instead of creating duplicates.
   *
   * Also feeds the Google Merchant Center feed, which needs two extra fields:
   * `sku` (emitted as MPN — brand + MPN is the identifier pair Google accepts for
   * parts with no GTIN) and `categories` (populated to names for `product_type`).
   * Both are cheap and both improve the Meta feed too, so one projection serves
   * both channels rather than two near-identical reads of the same collection.
   */
  async findForFeed() {
    return Product.find({
      isActive: true,
      slug: { $exists: true, $nin: [null, ''] },
      'seo.noindex': { $ne: true },
    })
      .select(
        'name shortDescription description slug price originalPrice salePrice ' +
        'saleEndsAt stock brand images wpId productType variants updatedAt ' +
        'sku categories'
      )
      .populate({ path: 'categories', select: 'name' })
      .sort({ updatedAt: -1 })
      .lean()
      .maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Find products by query
   */
  async find(query, options = {}) {
    const {
      limit = 24,
      skip = 0,
      sort = { createdAt: -1 },
      populate = []
    } = options;

    let queryBuilder = Product.find(query);

  // Apply populate
    if (populate.length > 0) {
      populate.forEach(pop => {
        queryBuilder = queryBuilder.populate(pop.path, pop.select);
      });
    }

    // Apply sort, skip, limit
    return queryBuilder
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean()
      .maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Find single product by ID
   */
  async findById(productId, populate = []) {
    let query = Product.findById(productId);
    
    if (populate.length > 0) {
      populate.forEach(pop => {
        query = query.populate(pop.path, pop.select);
      });
    }

    return query;
  }

  /**
   * Lightweight availability view for the back-in-stock feature: just the fields
   * needed to validate a notify-me request, resolve a variant, and build the email
   * (no heavy `description`). Lean — read-only.
   */
  async findStockView(productId) {
    return Product.findById(productId)
      .select('name slug stock variants productType images')
      .lean();
  }

  /**
   * Stock-view for a set of products (admin Stock Requests list). Lean.
   */
  async findStockViewByIds(ids) {
    return Product.find({ _id: { $in: ids } })
      .select('name slug stock variants productType images')
      .lean();
  }

  /**
   * Find single product by slug
   */
  async findBySlug(slug, populate = []) {
    let query = Product.findOne({ slug, isActive: true });
    
    if (populate.length > 0) {
      populate.forEach(pop => {
        query = query.populate(pop.path, pop.select);
      });
    }

    return query;
  }

  /**
   * Find featured products
   */
  async findFeatured(limit = 6) {
    return Product.find({ isActive: true, isFeatured: true })
      .populate('categories', 'name slug')
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .lean()
      .maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Find products on offer/discount, paginated. Mirrors the page/skip/count shape
   * `_searchWithMongoDB` uses for the main listing, so the offers endpoint can return
   * the same `{total, pages, currentPage, hasNext, hasPrev}` the frontend already
   * knows how to render (`normalizeProductsResponse` + the shared `Pagination`
   * component) instead of a bespoke shape.
   */
  async findOnOffer({ page = 1, limit = 24 } = {}) {
    const now = new Date();
    const skip = (Number(page) - 1) * Number(limit);

    const query = {
      isActive: true,
      $and: [
        {
          $or: [
            { isOfferFeatured: true },
            { $expr: { $gt: ['$originalPrice', '$price'] } }
          ]
        },
        {
          $or: [
            { offerStartDate: { $exists: false } },
            { offerStartDate: null },
            { offerStartDate: { $lte: now } }
          ]
        },
        {
          $or: [
            { offerEndDate: { $exists: false } },
            { offerEndDate: null },
            { offerEndDate: { $gte: now } }
          ]
        }
      ]
    };

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('categories', 'name slug')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .maxTimeMS(QUERY_TIMEOUTS.listing),
      Product.countDocuments(query).maxTimeMS(QUERY_TIMEOUTS.listing)
    ]);

    return { products, total };
  }

  /**
   * Find vehicle by ID or slug with progressive fallback.
   *
   * The public vehicles page uses static slugs (e.g. "hyundai", "bmw") that may
   * not exactly match the DB slugs (e.g. "hyundai-creta", "bmw-x5"). We try
   * four strategies in order so stale/partial slugs still resolve correctly:
   *
   * 1. ObjectId lookup (fastest path)
   * 2. Exact slug match
   * 3. Slug-prefix match — "hyundai" matches "hyundai-creta"
   * 4. Normalised match — strips non-alphanumerics, handles "isuzu-dmax" ↔ "isuzu-d-max"
   * 5. Make-name match — treats identifier as a make name (last resort)
   */
  async findVehicleByIdOrSlug(identifier) {
    const { default: Vehicle } = await import('../models/Vehicle.js');

    if (this.isValidObjectId(identifier)) {
      return Vehicle.findById(identifier);
    }

    // 2. Exact slug
    const exact = await Vehicle.findOne({ slug: identifier, isActive: true });
    if (exact) return exact;

    // 3. Slug prefix — identifier is a leading portion of the full slug
    //    e.g. "hyundai" matches "hyundai-creta", "bmw" matches "bmw-x5"
    const safeId = identifier.replace(/[^a-zA-Z0-9-]/g, '');
    if (safeId.length >= 2) {
      const prefix = await Vehicle.findOne({
        slug: { $regex: new RegExp(`^${safeId}-`, 'i') },
        isActive: true,
      }).sort({ slug: 1 });
      if (prefix) return prefix;
    }

    // 4. Normalised slug — strip non-alphanumeric chars from both sides
    //    handles "isuzu-dmax" ↔ "isuzu-d-max" (both normalise to "isuzudmax")
    const norm = identifier.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (norm.length >= 3) {
      const allActive = await Vehicle.find({ isActive: true }).select('_id slug').lean();
      const hit = allActive.find(v =>
        v.slug.replace(/[^a-z0-9]/g, '').toLowerCase().startsWith(norm)
      );
      if (hit) return Vehicle.findById(hit._id);
    }

    // 5. Make-name fallback — treat the identifier as a vehicle make
    const makeQuery = identifier.replace(/-/g, ' ');
    return Vehicle.findOne({
      make: { $regex: new RegExp(`^${makeQuery}$`, 'i') },
      isActive: true,
    });
  }

  /**
   * Get all active brands
   */
  async findAllBrands() {
    const { default: Brand } = await import('../models/Brand.js');
    return Brand.find({ isActive: true }).sort({ name: 1 }).lean();
  }

  /**
   * Which of the given vehicle ids have at least one active product mapped to
   * them. Drives the vehicle sitemap, so a vehicle with no products is never
   * submitted as an empty listing page.
   */
  async distinctCompatibleVehicles(vehicleIds) {
    if (!vehicleIds?.length) return [];
    return Product.distinct('compatibleVehicles', {
      compatibleVehicles: { $in: vehicleIds },
      isActive: true,
    }).maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Count products by brand
   */
  async countProductsByBrand(brandNames) {
    return Product.aggregate([
      {
        $match: {
          brand: { $in: brandNames },
          isActive: true
        }
      },
      {
        $group: {
          _id: '$brand',
          count: { $sum: 1 }
        }
      }
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });
  }

  /**
   * Count total products matching query
   */
  async count(query) {
    return Product.countDocuments(query).maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Active product ids grouped by category id. Returns
   * [{ _id: categoryId, ids: [productId, …] }] — the DISTINCT set of products
   * tagged with each category (a product tagged with N categories appears in N
   * groups, once each). Callers union these sets up the category tree so a
   * subtree total counts each product ONCE even when it's tagged with both a
   * hub and a descendant; a plain $sum would double-count those and inflate the
   * badge above the listing's distinct total. Mirrors SearchService.getFacets.
   */
  async distinctActiveIdsByCategory() {
    return Product.aggregate([
      { $match: { isActive: true, categories: { $exists: true, $ne: [] } } },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', ids: { $addToSet: '$_id' } } }
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });
  }

  /**
   * Get product stock status by ID. Missing product → treated as out of stock.
   */
  async getStock(productId) {
    const product = await Product.findById(productId, 'stock');
    return product?.stock ?? STOCK_STATUS.OUT;
  }

  /**
   * Set product stock status ('in' | 'low' | 'out' | 'backorder').
   */
  async updateStock(productId, status) {
    return Product.updateOne(
      { _id: productId },
      { stock: status }
    );
  }

  /**
   * Create new product
   */
  async create(productData) {
    return Product.create(productData);
  }

  /**
   * Update product
   */
  async update(productId, updateData) {
    return Product.findByIdAndUpdate(productId, updateData, { new: true });
  }

  /**
   * Delete product
   */
  async delete(productId) {
    return Product.findByIdAndDelete(productId);
  }

  /**
   * Time-boxed sales whose window has closed (saleEndsAt <= now). Minimal
   * projection — the sweep only needs the ids and the two prices to revert.
   * The pre-find hook already scopes to deletedAt: null.
   */
  async findExpiredSales(now = new Date(), limit = 500) {
    // `slug` is projected so the sweep can hand per-PDP revalidation tags to the
    // frontend revalidator — an expired sale moves the price UP, and a stale PDP
    // would keep advertising the lower sale price.
    return Product.find({ saleEndsAt: { $ne: null, $lte: now } })
      .select('_id price originalPrice slug')
      .limit(limit)
      .lean();
  }

  /**
   * Revert one expired sale: charged price moves UP to originalPrice, and the
   * sale markers (originalPrice slash + saleEndsAt window) are cleared. Uses
   * findByIdAndUpdate so the post-update hook re-syncs Elasticsearch.
   */
  async revertExpiredSale(productId, revertPrice) {
    return Product.findByIdAndUpdate(
      productId,
      { $set: { price: revertPrice }, $unset: { originalPrice: '', saleEndsAt: '' } },
      { new: true }
    );
  }

  /**
   * Check if product exists
   */
  async exists(productId) {
    const count = await Product.countDocuments({ _id: productId });
    return count > 0;
  }

  /**
   * Validate MongoDB ObjectId
   */
  isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }

  /**
   * Find active product by ID (requires isActive: true)
   */
  async findActiveById(productId, session = null) {
    let q = Product.findOne({ _id: productId, isActive: true });
    if (session) q = q.session(session);
    return q;
  }

  // Stock is a coarse status (not a quantity), so orders no longer deduct or
  // restore per-unit stock. Availability is enforced by checking that a
  // product is not marked out of stock; see orderService.validateAndPriceItems.

  /**
   * Get text search suggestions
   */
  async getSuggestions(query, limit = 10) {
    return Product.find(
      { $text: { $search: query }, isActive: true },
      { score: { $meta: 'textScore' }, name: 1, slug: 1 }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .select('name slug')
      .lean()
      .maxTimeMS(QUERY_TIMEOUTS.listing);
  }

  /**
   * Reset `salesScore` to 0 for products outside the scored set.
   *
   * Exists on the repository (rather than as a direct model call in
   * salesScoreService) because direct model imports outside repositories/ are
   * eslint-forbidden. Scoped to documents that currently have a non-zero score, so
   * this stays a small targeted write rather than a full-collection update that
   * would churn the change stream feeding the Atlas index on every nightly run.
   */
  /**
   * Bulk-apply computed `salesScore` values.
   *
   * `ordered: false` so one bad operation cannot abort the rest of a nightly
   * recompute. Bypassing Mongoose middleware is safe here specifically because
   * Atlas Search indexes the collection via change streams — there is no separate
   * search index to enqueue, which is the usual reason bulkWrite drifts a
   * denormalized field.
   */
  async bulkWriteSalesScores(operations) {
    if (!operations || operations.length === 0) return null;
    return Product.bulkWrite(operations, { ordered: false });
  }

  async clearSalesScoresExcept(ids) {
    return Product.updateMany(
      { _id: { $nin: ids }, salesScore: { $gt: 0 } },
      { $set: { salesScore: 0 } }
    );
  }
}

// Singleton instance

export default new ProductRepository();
