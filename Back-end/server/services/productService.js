/**
 * Product Service - BUSINESS LOGIC LAYER
 * 
 * This layer is responsible for:
 * - Business rules and validations
 * - Orchestrating multiple repositories
 * - Data transformation for API responses
 * - Caching decisions
 * 
 * NO direct database calls! Use repositories only.
 */

import productRepository from '../repositories/productRepository.js';
import elasticsearchService from './elasticsearchService.js';
import cacheService, { TTL } from './cacheService.js';
import { STOCK_STATUS, isPurchasable } from '../utils/stockStatus.js';

class ProductService {
  /**
   * Search products with ES fallback to MongoDB
   */
  async searchProducts(queryParams) {
    // Try Elasticsearch first
    if (elasticsearchService.enabled) {
      try {
        return await elasticsearchService.searchProducts(queryParams);
      } catch (error) {
        console.warn('Elasticsearch failed, falling back to MongoDB:', error.message);
      }
    }

    // Fallback to MongoDB via repository
    return this._searchWithMongoDB(queryParams);
  }

  /**
   * Get featured products with caching
   */
  async getFeaturedProducts(limit = 6) {
    const cacheKey = cacheService.generateKey('products', {
      type: 'featured',
      limit
    });

    return cacheService.wrap(
      cacheKey,
      () => productRepository.findFeatured(limit),
      { 
        ttl: TTL.PRODUCT_FEATURED, 
        strategy: 'swr',
        tags: ['products', 'products:featured']
      }
    );
  }

  /**
   * Get products on offer with business logic
   */
  async getOfferProducts(limit = 24) {
    const cacheKey = cacheService.generateKey('products', {
      type: 'offers',
      limit
    });

    return cacheService.wrap(
      cacheKey,
      () => productRepository.findOnOffer(limit),
      { 
        ttl: TTL.PRODUCT_OFFERS, 
        strategy: 'swr',
        tags: ['products', 'products:offers']
      }
    );
  }

  /**
   * Get products by vehicle with compatibility check
   */
  async getProductsByVehicle(vehicleIdentifier, queryParams) {
    // Get vehicle from repository
    const vehicle = await productRepository.findVehicleByIdOrSlug(vehicleIdentifier);
    
    if (!vehicle) {
      return null; // Vehicle not found
    }

    // Build search params with vehicle filter.
    // `vehicle` (id) drives the MongoDB fallback (`compatibleVehicles` match);
    // `vehicleMake`/`vehicleModel` drive Elasticsearch, which indexes the
    // vehicle make/model strings (not the id) on each product. Both are set so
    // the query is filtered correctly regardless of which engine serves it.
    const searchParams = {
      ...queryParams,
      vehicle: vehicle._id.toString(),
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model
    };

    // Search products
    const searchResults = await this.searchProducts(searchParams);

    return {
      vehicle: {
        _id: vehicle._id,
        make: vehicle.make,
        model: vehicle.model,
        slug: vehicle.slug,
        name: `${vehicle.make} ${vehicle.model}`
      },
      ...searchResults
    };
  }

  /**
   * Get brands with product counts
   */
  async getBrandsWithCounts() {
    const cacheKey = cacheService.generateKey('brands', {
      withCounts: true
    });

    return cacheService.wrap(
      cacheKey,
      async () => {
        const brands = await productRepository.findAllBrands();
        const brandNames = brands.map(b => b.name);
        const productCounts = await productRepository.countProductsByBrand(brandNames);

        const countMap = {};
        productCounts.forEach(item => {
          countMap[item._id] = item.count;
        });

        return brands
          .map(brand => {
            const raw = brand.logo;
            const logoUrl = typeof raw === 'string' ? raw || null
                          : raw && typeof raw === 'object' ? raw.url || null
                          : null;
            return {
              id: brand._id.toString(),
              name: brand.name,
              slug: brand.slug,
              productCount: countMap[brand.name] || 0,
              logo: logoUrl,
              description: brand.description || null
            };
          })
          .filter(b => b.productCount > 0);
      },
      { 
        ttl: TTL.BRANDS, 
        strategy: 'basic',
        tags: ['brands']
      }
    );
  }

  /**
   * Get single product by slug
   */
  async getProductBySlug(slug) {
    const cacheKey = cacheService.generateKey('product', {
      slug
    });

    return cacheService.wrap(
      cacheKey,
      () => productRepository.findBySlug(slug, [
        { path: 'categories', select: 'name slug' }
      ]),
      { ttl: 3600, strategy: 'basic' } // 1 hour
    );
  }

  /**
   * Get search suggestions
   */
  async getSearchSuggestions(query, limit = 10) {
    if (!query || query.trim().length < 2) {
      return { suggestions: [], corrections: [] };
    }

    // Try Elasticsearch first
    if (elasticsearchService.enabled) {
      try {
        return await elasticsearchService.getSearchSuggestions(query, limit);
      } catch {
        console.warn('ES suggestions failed, using MongoDB fallback');
      }
    }

    // Fallback to MongoDB
    const suggestions = await productRepository.getSuggestions(query, limit);

    return {
      suggestions: suggestions.map(p => p.name),
      corrections: []
    };
  }

  /**
   * Check product stock availability. Stock is a coarse status, so a product
   * is fulfillable as long as it is not marked out of stock (quantity-agnostic).
   */
  async checkStock(productId, requestedQuantity) {
    const status = await productRepository.getStock(productId);
    const canFulfill = isPurchasable(status);

    return {
      status,
      requested: requestedQuantity,
      inStock: canFulfill,
      canFulfill
    };
  }

  /**
   * MongoDB fallback search
   */
  async _searchWithMongoDB(queryParams) {
    const {
      page = 1,
      limit = 24,
      sortBy = 'createdAt',
      order = 'desc',
      category,
      brand,
      minPrice,
      maxPrice,
      inStock,
      vehicle,
      q
    } = queryParams;

    // Build query
    const query = { isActive: true };

    if (q) {
      query.$text = { $search: q };
    }

    if (category) {
      query.categories = category;
    }

    if (brand) {
      query.brand = brand;
    }

    if (vehicle) {
      query.compatibleVehicles = vehicle;
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    if (inStock === 'true') {
      query.stock = { $ne: STOCK_STATUS.OUT };
    }

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Build sort
    const sort = {};
    sort[sortBy] = order === 'desc' ? -1 : 1;

    // Execute query via repository
    const [products, total] = await Promise.all([
      productRepository.find(query, {
        limit: Number(limit),
        skip,
        sort,
        select: 'name slug price originalPrice images stock sku brand averageRating totalReviews shortDescription isFeatured isFastMoving isOfferFeatured offerStartDate offerEndDate categories isActive tags',
        populate: [
          { path: 'categories', select: 'name slug' }
        ]
      }),
      productRepository.count(query)
    ]);

    return {
      products,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      },
      facets: await this._buildFacets(query)
    };
  }

  /**
   * Build filter facets
   */
  async _buildFacets(_baseQuery) {
    // In a full implementation, you'd aggregate facets here
    // For now, return empty facets (Elasticsearch handles this better)
    return {
      categories: [],
      brands: [],
      priceRanges: [],
      ratings: [],
      availability: []
    };
  }
}

// Singleton instance
export default new ProductService();
