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
   * Get products similar to the specified product.
   * Matching priority: same category + same vehicle + price range → category + price → category → brand → popular
   */
  static async getSimilarProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId)
        .select('categories brand tags name price compatibleVehicles')
        .lean();

      if (!product) {
        console.warn('[SearchService] Product not found:', productId);
        return [];
      }

      console.log('[SearchService] Finding similar products for:', product.name, {
        categories: product.categories?.length || 0,
        brand: product.brand || 'none',
        compatibleVehicles: product.compatibleVehicles?.length || 0,
        price: product.price
      });

      const baseQuery = { _id: { $ne: productId }, isActive: true, stock: { $gt: 0 } };
      const hasCategories = product.categories?.length > 0;
      const hasVehicles = product.compatibleVehicles?.length > 0;
      const priceMin = product.price * 0.7;
      const priceMax = product.price * 1.3;
      const priceFilter = { price: { $gte: priceMin, $lte: priceMax } };

      const collected = [];
      const seenIds = new Set();

      const addResults = (docs) => {
        for (const doc of docs) {
          const id = doc._id.toString();
          if (!seenIds.has(id)) {
            seenIds.add(id);
            collected.push(doc);
          }
        }
      };

      const remaining = () => limit - collected.length;
      const excludeIds = () => Array.from(seenIds);

      // Attempt 1: same category + same vehicle + price range
      if (hasCategories && hasVehicles && remaining() > 0) {
        const docs = await Product.find({
          ...baseQuery,
          categories: { $in: product.categories },
          compatibleVehicles: { $in: product.compatibleVehicles },
          ...priceFilter
        })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(remaining())
          .populate('categories', 'name slug')
          .lean();
        addResults(docs);
        console.log('[SearchService] Category+Vehicle+Price found:', docs.length);
      }

      // Attempt 2: same category + price range (drop vehicle requirement)
      if (hasCategories && remaining() > 0) {
        const docs = await Product.find({
          ...baseQuery,
          _id: { $ne: productId, $nin: excludeIds() },
          categories: { $in: product.categories },
          ...priceFilter
        })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(remaining())
          .populate('categories', 'name slug')
          .lean();
        addResults(docs);
        console.log('[SearchService] Category+Price found:', docs.length, '| total:', collected.length);
      }

      // Attempt 3: same category only (drop price range)
      if (hasCategories && remaining() > 0) {
        const docs = await Product.find({
          ...baseQuery,
          _id: { $ne: productId, $nin: excludeIds() },
          categories: { $in: product.categories }
        })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(remaining())
          .populate('categories', 'name slug')
          .lean();
        addResults(docs);
        console.log('[SearchService] Category-only found:', docs.length, '| total:', collected.length);
      }

      // Attempt 4: same brand
      if (product.brand && remaining() > 0) {
        const docs = await Product.find({
          ...baseQuery,
          _id: { $ne: productId, $nin: excludeIds() },
          brand: product.brand
        })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(remaining())
          .populate('categories', 'name slug')
          .lean();
        addResults(docs);
        console.log('[SearchService] Brand fallback found:', docs.length, '| total:', collected.length);
      }

      // Final fallback: popular products
      if (collected.length === 0) {
        const docs = await Product.find({ ...baseQuery })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(limit)
          .populate('categories', 'name slug')
          .lean();
        addResults(docs);
        console.log('[SearchService] Popular fallback found:', docs.length);
      }

      return collected.slice(0, limit);
    } catch (error) {
      console.error('[SearchService] getSimilarProducts failed:', error);
      return [];
    }
  }

  /**
   * Get complementary products for a product.
   * Uses manual curation first, then falls back to ecosystem keyword matching
   * (e.g. bonnet bracket → LED lights, wiring harness, switch).
   */
  static async getComplementaryProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId)
        .select('complementaryProducts categories name tags')
        .populate('complementaryProducts')
        .lean();

      if (!product) {
        console.warn('[SearchService] Product not found for complementary:', productId);
        return [];
      }

      console.log('[SearchService] Finding complementary products for:', product.name);

      // Exclude similar products so both sections never show the same items
      const similarProducts = await this.getSimilarProducts(productId, 20);
      const similarIds = new Set(similarProducts.map(p => p._id.toString()));
      const excludeIds = () => [productId, ...Array.from(similarIds)];

      console.log('[SearchService] Excluding', similarIds.size, 'similar products from complementary results');

      // Priority 1: manually curated complementary products
      if (product.complementaryProducts?.length > 0) {
        const complementary = product.complementaryProducts
          .filter(p => p && p.isActive && p.stock > 0 && !similarIds.has(p._id.toString()))
          .slice(0, limit);

        if (complementary.length > 0) {
          console.log('[SearchService] Returning', complementary.length, 'manual complementary products');
          return complementary;
        }
      }

      // Priority 2: ecosystem keyword matching (product name + tags → complementary categories)
      const ecosystemCategoryIds = await this.getProductEcosystemCategories(product);

      if (ecosystemCategoryIds.length > 0) {
        const complementary = await Product.find({
          _id: { $nin: excludeIds() },
          categories: { $in: ecosystemCategoryIds },
          isActive: true,
          stock: { $gt: 0 }
        })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(limit)
          .populate('categories', 'name slug')
          .lean();

        console.log('[SearchService] Ecosystem keyword matching found:', complementary.length, 'products');

        if (complementary.length > 0) {
          return complementary;
        }
      }

      // Priority 3: related category mapping (fallback)
      if (product.categories?.length > 0) {
        const relatedCategories = await this.getRelatedCategories(product.categories);

        if (relatedCategories.length > 0) {
          const complementary = await Product.find({
            _id: { $nin: excludeIds() },
            categories: { $in: relatedCategories },
            isActive: true,
            stock: { $gt: 0 }
          })
            .sort({ averageRating: -1, totalReviews: -1 })
            .limit(limit)
            .populate('categories', 'name slug')
            .lean();

          console.log('[SearchService] Related-category fallback found:', complementary.length, 'products');

          if (complementary.length > 0) {
            return complementary;
          }
        }
      }

      // Priority 4: popular products from different categories (excluding similar)
      let popularProducts = await Product.find({
        _id: { $nin: excludeIds() },
        isActive: true,
        stock: { $gt: 0 },
        categories: { $nin: product.categories || [] }
      })
        .sort({ averageRating: -1, totalReviews: -1 })
        .limit(limit)
        .populate('categories', 'name slug')
        .lean();

      if (popularProducts.length === 0) {
        popularProducts = await Product.find({
          _id: { $nin: excludeIds() },
          isActive: true,
          stock: { $gt: 0 }
        })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(limit)
          .populate('categories', 'name slug')
          .lean();
      }

      // Absolute last resort: show any available products rather than an empty section
      if (popularProducts.length === 0) {
        popularProducts = await Product.find({ _id: { $ne: productId }, isActive: true, stock: { $gt: 0 } })
          .sort({ averageRating: -1, totalReviews: -1 })
          .limit(limit)
          .populate('categories', 'name slug')
          .lean();
      }

      console.log('[SearchService] Popular fallback found:', popularProducts.length, 'products');
      return popularProducts;
    } catch (error) {
      console.error('[SearchService] getComplementaryProducts failed:', error);
      return [];
    }
  }

  /**
   * Derive complementary category slugs from a product's name and tags.
   * E.g. a "bonnet bracket" maps to lighting, wiring-harness, and switch categories.
   * Returns resolved MongoDB Category ObjectIds.
   */
  static async getProductEcosystemCategories(product) {
    // Keyword → complementary category slug mappings
    // Order matters — more specific entries should come first
    const ecosystemMap = [
      { keywords: ['bonnet', 'bracket', 'mount', 'mounting', 'holder', 'clamp', 'bar'], categories: ['lighting', 'electrical', 'wiring', 'switch'] },
      { keywords: ['led', 'headlight', 'fog', 'spotlight', 'driving light', 'work light', 'offroad light'], categories: ['wiring', 'switch', 'relay', 'electrical'] },
      { keywords: ['light', 'lamp', 'bulb', 'beam'], categories: ['wiring', 'switch', 'electrical'] },
      { keywords: ['wiring', 'harness', 'wire', 'cable', 'loom'], categories: ['switch', 'relay', 'lighting', 'electrical'] },
      { keywords: ['switch', 'relay', 'controller', 'dimmer'], categories: ['wiring', 'lighting', 'electrical'] },
      { keywords: ['horn', 'siren', 'alarm', 'buzzer'], categories: ['electrical', 'wiring', 'switch'] },
      { keywords: ['camera', 'dashcam', 'dash cam', 'dvr', 'recorder', 'cctv'], categories: ['electronics', 'accessories', 'mounting'] },
      { keywords: ['seat', 'seat cover', 'cushion', 'lumbar'], categories: ['interior', 'accessories', 'cleaning'] },
      { keywords: ['floor mat', 'mat', 'carpet', 'liner'], categories: ['interior', 'cleaning', 'accessories'] },
      { keywords: ['bumper', 'spoiler', 'body kit', 'skirt', 'diffuser', 'splitter'], categories: ['paint', 'tools', 'maintenance', 'exterior'] },
      { keywords: ['wheel', 'tyre', 'tire', 'rim', 'alloy'], categories: ['maintenance', 'cleaning', 'tools', 'accessories'] },
      { keywords: ['suspension', 'shock', 'absorber', 'spring', 'strut', 'coilover'], categories: ['tools', 'maintenance', 'performance'] },
      { keywords: ['exhaust', 'muffler', 'silencer', 'pipe', 'header'], categories: ['performance', 'tools', 'maintenance'] },
      { keywords: ['roof rack', 'rack', 'cargo', 'luggage carrier', 'crossbar'], categories: ['accessories', 'mounting', 'tools'] },
      { keywords: ['dash', 'dashboard', 'console', 'panel', 'cluster'], categories: ['electronics', 'accessories', 'interior'] },
      { keywords: ['air filter', 'intake', 'cold air'], categories: ['performance', 'maintenance', 'tools'] },
      { keywords: ['oil', 'lubricant', 'grease', 'fluid'], categories: ['maintenance', 'tools', 'performance'] },
      { keywords: ['cleaner', 'polish', 'wax', 'detailing', 'shampoo'], categories: ['maintenance', 'exterior', 'tools'] },
      { keywords: ['tool', 'socket', 'spanner', 'wrench', 'jack'], categories: ['maintenance', 'performance', 'accessories'] },
    ];

    const text = [product.name || '', ...(product.tags || [])].join(' ').toLowerCase();
    const matchedSlugs = new Set();

    for (const { keywords, categories } of ecosystemMap) {
      if (keywords.some(k => text.includes(k))) {
        categories.forEach(s => matchedSlugs.add(s));
      }
    }

    if (matchedSlugs.size === 0) return [];

    try {
      const Category = mongoose.model('Category');
      const resolved = await Category.find({
        $or: [
          { slug: { $in: Array.from(matchedSlugs) } },
          { name: { $regex: Array.from(matchedSlugs).join('|'), $options: 'i' } }
        ],
        // Exclude the product's own categories so results are truly complementary
        _id: { $nin: product.categories || [] }
      }).select('_id').lean();

      console.log('[SearchService] Ecosystem resolved', resolved.length, 'categories from', matchedSlugs.size, 'slugs');
      return resolved.map(c => c._id);
    } catch (err) {
      console.warn('[SearchService] Failed to resolve ecosystem category IDs:', err.message);
      return [];
    }
  }

  /**
   * Get related categories for complementary matching based on the product's own categories.
   */
  static async getRelatedCategories(categoryIds) {
    const categoryMap = {
      'exterior': ['cleaning', 'maintenance', 'tools'],
      'interior': ['cleaning', 'accessories', 'electronics'],
      'suspension': ['tools', 'maintenance', 'performance'],
      'performance': ['maintenance', 'tools', 'lubricants'],
      'body-kit': ['paint', 'tools', 'maintenance'],
      'lighting': ['electrical', 'wiring', 'switch', 'tools'],
      'wheels': ['maintenance', 'tools', 'accessories'],
      'electrical': ['wiring', 'switch', 'lighting', 'relay'],
    };

    const related = new Set();

    for (const catId of categoryIds) {
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
