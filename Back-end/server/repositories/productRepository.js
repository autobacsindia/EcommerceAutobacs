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
   * (slug + updatedAt only). Excludes seo.noindex products. Paginated for the
   * sharded sitemap. The pre-find hook already scopes to deletedAt: null.
   */
  async findSitemap({ limit = 250, skip = 0 } = {}) {
    return Product.find({
      isActive: true,
      slug: { $exists: true, $nin: [null, ''] },
      'seo.noindex': { $ne: true },
    })
      .select('slug updatedAt')
      .sort({ updatedAt: -1 })
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
   * Find products on offer/discount
   */
  async findOnOffer(limit = 24) {
    const now = new Date();

    return Product.find({
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
    })
      .populate('categories', 'name slug')
      .limit(Number(limit))
      .sort({ createdAt: -1 })
      .lean()
      .maxTimeMS(QUERY_TIMEOUTS.listing);
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
   * Count active products grouped by category id. A product can belong to
   * multiple categories, so each membership is counted once. Returns
   * [{ _id: categoryId, count }]. Matches the active-only listing semantics so
   * the per-category badge equals what "View products" actually shows.
   */
  async countActiveByCategory() {
    return Product.aggregate([
      { $match: { isActive: true, categories: { $exists: true, $ne: [] } } },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } }
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
   * Set product stock status ('in' | 'low' | 'out').
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
}

// Singleton instance
export default new ProductRepository();
