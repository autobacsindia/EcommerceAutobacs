import Product from "../models/Product.js";

class SearchService {
  /**
   * Search products with filters and pagination
   * @param {Object} params - Search parameters
   * @returns {Object} Search results with products and pagination info
   */
  static async searchProducts(params) {
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

    if (category) query.category = category;
    if (brand) query.brand = brand;
    
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
    
    // Rating filtering
    if (rating) {
      query.averageRating = { $gte: Number(rating) };
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
      .populate('category', 'name slug')
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
   * @returns {Array} Array of search suggestions
   */
  static async getSearchSuggestions(query, limit = 10) {
    if (!query || query.length < 2) {
      return [];
    }

    // Find products matching the query in name or brand
    const products = await Product.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } }
      ],
      isActive: true
    })
    .select('name brand')
    .limit(limit);

    // Extract unique suggestions
    const suggestions = new Set();
    products.forEach(product => {
      suggestions.add(product.name);
      if (product.brand) {
        suggestions.add(product.brand);
      }
    });

    return Array.from(suggestions).slice(0, limit);
  }
}

export default SearchService;