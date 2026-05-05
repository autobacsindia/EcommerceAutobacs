import Product from "../models/Product.js";
import Category from "../models/Category.js";
import elasticsearchService from "./elasticsearchService.js";
import categoryMappingService from "./categoryMappingService.js";

class SearchService {
  /**
   * Search products with filters and pagination
   * @param {Object} params - Search parameters
   * @returns {Object} Search results with products and pagination info
   */
  static async searchProducts(params) {
    // Check if Elasticsearch is available
    if (await elasticsearchService.isConnected()) {
      try {
        const esParams = { ...params };
        if (!esParams.q && esParams.search) {
          esParams.q = esParams.search;
        }
        return await elasticsearchService.searchProducts(esParams);
      } catch (error) {
        console.error('Elasticsearch search failed, falling back to MongoDB:', error);
      }
    }
    
    // Fallback to MongoDB implementation
    const {
      page = 1,
      limit = 12,
      category,
      brand,
      minPrice,
      maxPrice,
      search,
      vehicle,
      isFeatured,
      isFastMoving,
      inStock,
      rating,
      sortBy = 'createdAt',
      order = 'desc'
    } = params;

    // Build query
    const query = { isActive: true };

    // Support multiple categories and include child categories
    if (category) {
      const categories = Array.isArray(category) ? category : category.split(',');
      if (categories.length > 0) {
        // For each category, get all child categories
        const allCategoryIds = [];
        for (const catIdentifier of categories) {
          // Make sure category mapping service is initialized
          if (!categoryMappingService.initialized) {
            await categoryMappingService.initialize();
          }
          
          // First try to find the category by slug or name, then get its ID
          const foundCategory = categoryMappingService.findCategory(catIdentifier);
          if (foundCategory) {
            const childCategoryIds = await categoryMappingService.getAllCategoryIdsIncludingChildren(foundCategory._id.toString());
            allCategoryIds.push(...childCategoryIds);
          } else {
            // If not found by name/slug, treat as ID directly
            const childCategoryIds = await categoryMappingService.getAllCategoryIdsIncludingChildren(catIdentifier);
            allCategoryIds.push(...childCategoryIds);
          }
        }
        
        if (allCategoryIds.length > 0) {
          query.categories = { $in: allCategoryIds };
        }
      }
    }
    
    // Support multiple brands with case-insensitive matching
    // This allows URL slugs (e.g., 'ironman') to match database values (e.g., 'Ironman')
    if (brand) {
      const brands = Array.isArray(brand) ? brand : brand.split(',');
      if (brands.length > 0) {
        // Use case-insensitive regex for each brand to match regardless of case
        // Escape special regex characters in brand names to prevent regex injection
        const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.brand = { 
          $in: brands.map(b => new RegExp('^' + escapeRegex(b.trim()) + '$', 'i')) 
        };
      }
    }
    
    // Price range filtering
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    
    if (vehicle) query.compatibleVehicles = vehicle;
    if (isFeatured) query.isFeatured = isFeatured === 'true';
    if (isFastMoving) query.isFastMoving = isFastMoving === 'true';
    
    // In stock filtering
    if (inStock === 'true') {
      query.stock = { $gt: 0 };
    }
    
    // Support multiple ratings (find products with rating >= any of the specified ratings)
    if (rating) {
      const ratings = Array.isArray(rating) ? rating : rating.split(',').map(Number);
      const validRatings = ratings.filter(r => !isNaN(r));
      if (validRatings.length > 0) {
        // Find products with rating >= the highest specified rating
        const maxRating = Math.max(...validRatings);
        query.averageRating = { $gte: maxRating };
      }
    }
    
    if (search) {
      query.$text = { $search: search };
    }

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    let sortOptions = {};
    if (search && sortBy === 'createdAt') {
      sortOptions = { score: { $meta: 'textScore' } };
    } else {
      sortOptions[sortBy] = order === 'asc' ? 1 : -1;
    }

    try {
      let productQuery = search
        ? Product.find(query, { score: { $meta: 'textScore' } })
        : Product.find(query);
      productQuery = productQuery
        .populate('categories', 'name slug')
        .populate('compatibleVehicles', 'make model year')
        .sort(sortOptions);
      
      const products = await productQuery
        .skip(skip)
        .limit(Number(limit));

      const total = await Product.countDocuments(query);

      return {
        products,
        pagination: {
          total,
          pages: Math.ceil(total / Number(limit)),
          currentPage: Number(page),
          hasNext: Number(page) < Math.ceil(total / Number(limit)),
          hasPrev: Number(page) > 1
        }
      };
    } catch (error) {
      console.error('[SearchService] Database query failed:', error);
      throw new Error(`Database query failed: ${error.message}`);
    }
  }

  /**
   * Get search suggestions based on partial text
   * @param {string} query - Partial search query
   * @param {number} limit - Maximum number of suggestions
   * @returns {Array} Array of search suggestions with additional metadata
   */
  static async getSearchSuggestions(query, limit = 10) {
    // Check if Elasticsearch is available
    if (await elasticsearchService.isConnected()) {
      try {
        return await elasticsearchService.getSearchSuggestions(query, limit);
      } catch (error) {
        console.error('Elasticsearch suggestions failed, falling back to MongoDB:', error);
      }
    }
    
    // Fallback to MongoDB implementation
    if (!query || query.length < 2) {
      return {
        suggestions: [],
        corrections: []
      };
    }

    // Find products matching the query in name or brand
    const products = await Product.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } }
      ],
      isActive: true
    })
    .select('name brand categories images')
    .populate('categories', 'name')
    .limit(limit * 2); // Get more results to allow for deduplication

    // Find categories matching the query
    const categories = await Category.find({
      name: { $regex: query, $options: 'i' },
      isActive: true
    }).limit(limit);

    // Extract unique suggestions
    const suggestions = [];
    const seenNames = new Set();
    const seenBrands = new Set();
    const seenCategories = new Set();

    // Add product suggestions
    products.forEach(product => {
      // Add product name suggestion
      if (!seenNames.has(product.name.toLowerCase())) {
        seenNames.add(product.name.toLowerCase());
        
        // Get primary image if available
        let imageUrl = null;
        if (Array.isArray(product.images) && product.images.length > 0) {
          const primaryImage = product.images.find(img => img.isPrimary) || product.images[0];
          imageUrl = primaryImage ? primaryImage.url : null;
        } else if (typeof product.images === 'string') {
          imageUrl = product.images;
        }
        
        suggestions.push({
          id: `product-${product._id}`,
          text: product.name,
          type: 'product',
          category: product.categories && product.categories.length > 0 ? product.categories[0].name : null,
          imageUrl: imageUrl,
          value: product._id
        });
      }

      // Add brand suggestion
      if (product.brand && !seenBrands.has(product.brand.toLowerCase())) {
        seenBrands.add(product.brand.toLowerCase());
        suggestions.push({
          id: `brand-${product.brand.toLowerCase().replace(/\s+/g, '-')}`,
          text: product.brand,
          type: 'brand',
          value: product.brand
        });
      }
    });

    // Add category suggestions
    categories.forEach(category => {
      if (!seenCategories.has(category.name.toLowerCase())) {
        seenCategories.add(category.name.toLowerCase());
        suggestions.push({
          id: `category-${category.name.toLowerCase().replace(/\s+/g, '-')}`,
          text: category.name,
          type: 'category',
          value: category.name
        });
      }
    });

    // Limit to requested number of suggestions
    return {
      suggestions: suggestions.slice(0, limit),
      corrections: [] // No corrections in MongoDB fallback
    };
  }
  
  /**
   * Get search analytics
   * @param {string} startDate - Start date for analytics
   * @param {string} endDate - End date for analytics
   * @returns {Object} Search analytics data
   */
  static async getSearchAnalytics(startDate, endDate) {
    // Check if Elasticsearch is available
    if (await elasticsearchService.isConnected()) {
      try {
        return await elasticsearchService.getSearchAnalytics(startDate, endDate);
      } catch (error) {
        console.error('Elasticsearch analytics failed:', error);
      }
    }
    
    // Return empty analytics if not available
    return {
      popularTerms: [],
      searchesOverTime: []
    };
  }

  /**
   * Add a search term to history
   * @param {string} term - The search term
   * @param {number} resultsCount - Number of results returned
   * @param {string} userId - User ID (optional)
   * @returns {Object} Success status
   */
  static async addToSearchHistory(term, resultsCount = 0, userId = null) {
    try {
      // For now, we'll just log the search query using Elasticsearch if available
      // In a more advanced implementation, we would store this in a database
      if (await elasticsearchService.isConnected()) {
        await elasticsearchService.logSearchQuery(term, userId);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error adding to search history:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get recent search history
   * @param {string} userId - User ID (optional)
   * @param {number} limit - Maximum number of history items to return
   * @returns {Array} Array of recent search terms
   */
  static async getSearchHistory(userId = null, limit = 10) {
    // For now, we'll return an empty array since we're not persisting history on the server
    // In a more advanced implementation, we would query a search_history collection
    return [];
  }

  /**
   * Clear search history
   * @param {string} userId - User ID (optional)
   * @returns {Object} Success status
   */
  static async clearSearchHistory(userId = null) {
    // For now, we'll just return success since we're not persisting history on the server
    // In a more advanced implementation, we would delete entries from a search_history collection
    return { success: true };
  }

  /**
   * Get products similar to the specified product (same category/brand/tags)
   * @param {string} productId - The ID of the reference product
   * @param {number} limit - Maximum number of similar products to return
   * @returns {Array} Array of similar products
   */
  static async getSimilarProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId).select('categories brand tags name').lean();
      
      if (!product) {
        console.warn('[SearchService] Product not found:', productId);
        return [];
      }
      
      console.log('[SearchService] Finding similar products for:', product.name, {
        categories: product.categories?.length || 0,
        brand: product.brand || 'none',
        tags: product.tags?.length || 0
      });
      
      // Build query for similar products
      const query = {
        _id: { $ne: productId },
        isActive: true,
        stock: { $gt: 0 }
      };
      
      // Prioritize by category > brand > tags
      if (product.categories && product.categories.length > 0) {
        query.categories = { $in: product.categories };
      } else if (product.brand) {
        query.brand = product.brand;
      } else if (product.tags && product.tags.length > 0) {
        query.tags = { $in: product.tags.slice(0, 3) };
      }
      
      // Try to find similar products
      let similarProducts = await Product.find(query)
        .limit(limit)
        .populate('categories', 'name slug')
        .lean();
      
      console.log('[SearchService] Primary query found:', similarProducts.length, 'products');
      
      // Fallback: If no similar products found, return popular products from same category or all products
      if (similarProducts.length === 0) {
        console.log('[SearchService] Using fallback query for:', product.name);
        const fallbackQuery = {
          _id: { $ne: productId },
          isActive: true,
          stock: { $gt: 0 }
        };
        
        // Try to get products from same category if available
        if (product.categories && product.categories.length > 0) {
          fallbackQuery.categories = { $in: product.categories };
        }
        
        similarProducts = await Product.find(fallbackQuery)
          .sort({ averageRating: -1, totalReviews: -1 }) // Sort by popularity
          .limit(limit)
          .populate('categories', 'name slug')
          .lean();
        
        console.log('[SearchService] Fallback query found:', similarProducts.length, 'products');
      }
      
      return similarProducts;
    } catch (error) {
      console.error('[SearchService] getSimilarProducts failed:', error);
      return [];
    }
  }

  /**
   * Get complementary products for a product
   * Uses manual curation first, then falls back to category-based matching
   */
  static async getComplementaryProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId)
        .select('complementaryProducts categories name')
        .populate('complementaryProducts')
        .lean();
      
      if (!product) {
        console.warn('[SearchService] Product not found for complementary:', productId);
        return [];
      }
      
      console.log('[SearchService] Finding complementary products for:', product.name);
      
      // First, get similar products to exclude them from complementary
      const similarProducts = await this.getSimilarProducts(productId, 20);
      const similarIds = new Set(similarProducts.map(p => p._id.toString()));
      console.log('[SearchService] Excluding', similarIds.size, 'similar products from complementary results');
      
      // Priority 1: Use manually curated complementary products (exclude similar ones)
      if (product.complementaryProducts && product.complementaryProducts.length > 0) {
        const complementary = product.complementaryProducts
          .filter(p => p && p.isActive && p.stock > 0 && !similarIds.has(p._id.toString()))
          .slice(0, limit);
        
        console.log('[SearchService] Found', complementary.length, 'manual complementary products (excluding similar)');
        
        if (complementary.length > 0) {
          return complementary;
        }
      }
      
      // Priority 2: Fallback to related categories (different from main categories AND similar products)
      if (product.categories && product.categories.length > 0) {
        console.log('[SearchService] Using category-based complementary matching');
        
        // Find products in related but different categories
        const relatedCategories = await this.getRelatedCategories(product.categories);
        
        if (relatedCategories.length > 0) {
          const complementary = await Product.find({
            _id: { $ne: productId, $nin: Array.from(similarIds) },
            categories: { $in: relatedCategories },
            isActive: true,
            stock: { $gt: 0 }
          })
            .limit(limit)
            .sort({ averageRating: -1, totalReviews: -1 })
            .populate('categories', 'name slug')
            .lean();
          
          console.log('[SearchService] Category fallback found:', complementary.length, 'products');
          
          if (complementary.length > 0) {
            return complementary;
          }
        }
      }
      
      // Priority 3: Return popular products from different categories (excluding similar)
      console.log('[SearchService] Using popular products fallback (excluding similar)');
      let popularProducts = await Product.find({
        _id: { $ne: productId, $nin: Array.from(similarIds) },
        isActive: true,
        stock: { $gt: 0 },
        categories: { $nin: product.categories || [] }
      })
        .limit(limit)
        .sort({ averageRating: -1, totalReviews: -1 })
        .populate('categories', 'name slug')
        .lean();
      
      console.log('[SearchService] Popular fallback found:', popularProducts.length, 'products');
      
      // If still no results, relax category constraint but still exclude similar
      if (popularProducts.length === 0) {
        console.log('[SearchService] Relaxing category constraint for complementary');
        popularProducts = await Product.find({
          _id: { $ne: productId, $nin: Array.from(similarIds) },
          isActive: true,
          stock: { $gt: 0 }
        })
          .limit(limit)
          .sort({ averageRating: -1, totalReviews: -1 })
          .populate('categories', 'name slug')
          .lean();
        
        console.log('[SearchService] Relaxed fallback found:', popularProducts.length, 'products');
      }
      
      // If STILL no results, allow showing similar products (better than empty)
      if (popularProducts.length === 0) {
        console.log('[SearchService] No exclusive complementary found, showing any available products');
        popularProducts = await Product.find({
          _id: { $ne: productId },
          isActive: true,
          stock: { $gt: 0 }
        })
          .limit(limit)
          .sort({ averageRating: -1, totalReviews: -1 })
          .populate('categories', 'name slug')
          .lean();
        
        console.log('[SearchService] Final fallback found:', popularProducts.length, 'products');
      }
      
      return popularProducts;
    } catch (error) {
      console.error('[SearchService] getComplementaryProducts failed:', error);
      return [];
    }
  }

  /**
   * Get related categories for complementary matching
   * Returns categories that are commonly purchased together
   */
  static async getRelatedCategories(categoryIds) {
    // Common complementary category mappings
    const categoryMap = {
      'exterior': ['cleaning', 'maintenance', 'tools'],
      'interior': ['cleaning', 'accessories', 'electronics'],
      'suspension': ['tools', 'maintenance', 'performance'],
      'performance': ['maintenance', 'tools', 'lubricants'],
      'body-kit': ['paint', 'tools', 'maintenance'],
      'lighting': ['electrical', 'tools'],
      'wheels': ['maintenance', 'tools', 'accessories'],
    };
    
    const related = new Set();
    
    for (const catId of categoryIds) {
      // Try to match category slug or name
      try {
        const Category = mongoose.model('Category');
        const category = await Category.findById(catId).select('slug name').lean();
        
        if (category) {
          const slug = (category.slug || category.name || '').toLowerCase();
          
          for (const [key, values] of Object.entries(categoryMap)) {
            if (slug.includes(key)) {
              values.forEach(v => related.add(v));
            }
          }
        }
      } catch (err) {
        // Ignore errors for individual categories
      }
    }
    
    // Convert category names/slugs to IDs
    if (related.size > 0) {
      try {
        const Category = mongoose.model('Category');
        const relatedCategories = await Category.find({
          $or: [
            { slug: { $in: Array.from(related) } },
            { name: { $regex: Array.from(related).join('|'), $options: 'i' } }
          ]
        }).select('_id').lean();
        
        return relatedCategories.map(c => c._id);
      } catch (err) {
        console.warn('[SearchService] Failed to resolve related category IDs:', err.message);
      }
    }
    
    return [];
  }
}
export default SearchService;
