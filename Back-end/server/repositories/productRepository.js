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
import mongoose from 'mongoose';
import { QUERY_TIMEOUTS } from '../config/db.js';

class ProductRepository {
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
   * Find vehicle by ID or slug
   */
  async findVehicleByIdOrSlug(identifier) {
    const { default: Vehicle } = await import('../models/Vehicle.js');
    
    if (this.isValidObjectId(identifier)) {
      return Vehicle.findById(identifier);
    }
    
    return Vehicle.findOne({ slug: identifier, isActive: true });
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
   * Get product stock by ID
   */
  async getStock(productId) {
    const product = await Product.findById(productId, 'stock');
    return product?.stock || 0;
  }

  /**
   * Update product stock
   */
  async updateStock(productId, quantityChange) {
    return Product.updateOne(
      { _id: productId },
      { $inc: { stock: -quantityChange } }
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

  /**
   * Atomically deduct stock with availability guard.
   * Returns the old document if successful, null if stock was insufficient.
   * Inside a transaction the caller's session handles rollback automatically —
   * do NOT call restoreStock manually when a session is provided.
   */
  async atomicDeductStock(productId, quantity, session = null) {
    return Product.findOneAndUpdate(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { new: false, ...(session && { session }) }
    );
  }

  /**
   * Restore stock (cancellation / non-transactional rollback).
   */
  async restoreStock(productId, quantity, session = null) {
    return Product.findByIdAndUpdate(
      productId,
      { $inc: { stock: quantity } },
      session ? { session } : {}
    );
  }

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
