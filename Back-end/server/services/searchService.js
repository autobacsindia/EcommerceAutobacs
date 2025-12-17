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
        return await elasticsearchService.searchProducts(params);
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
    
    // Support multiple brands
    if (brand) {
      const brands = Array.isArray(brand) ? brand : brand.split(',');
      if (brands.length > 0) {
        query.brand = { $in: brands };
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
    
    // Text search
    if (search) {
      query.$text = { $search: search };
    }

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Sorting
    const sortOptions = {};
    
    // When searching, default sort by relevance (text score)
    if (search && sortBy === 'createdAt') {
      // If searching and no specific sort requested, sort by relevance
      sortOptions.score = { $meta: 'textScore' };
    } else {
      // Otherwise use requested sort
      sortOptions[sortBy] = order === 'asc' ? 1 : -1;
    }

    // Execute query
    let productQuery = Product.find(query)
      .populate('categories', 'name slug')
      .populate('compatibleVehicles', 'make model year');
      
    // When searching, include text score for sorting
    if (search) {
      productQuery = productQuery.select({ score: { $meta: 'textScore' } });
    }
    
    productQuery = productQuery.sort(sortOptions);
    
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
          imageUrl: imageUrl
        });
      }

      // Add brand suggestion
      if (product.brand && !seenBrands.has(product.brand.toLowerCase())) {
        seenBrands.add(product.brand.toLowerCase());
        suggestions.push({
          id: `brand-${product.brand.toLowerCase().replace(/\s+/g, '-')}`,
          text: product.brand,
          type: 'brand'
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
          type: 'category'
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
}

export default SearchService;