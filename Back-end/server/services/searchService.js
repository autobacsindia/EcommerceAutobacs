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
      // Use MongoDB text search first
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

      // If text search returns no results, fallback to regex-based search
      if (search && products.length === 0) {
        console.log(`[SearchService] Text search returned 0 results for "${search}", trying regex fallback...`);
        
        // Remove text search query
        delete query.$text;
        
        // Build regex-based search across multiple fields
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [
          { name: searchRegex },
          { brand: searchRegex },
          { shortDescription: searchRegex },
          { description: searchRegex },
          { sku: searchRegex },
          { tags: searchRegex },
          { features: searchRegex },
          { 'specifications.key': searchRegex },
          { 'specifications.value': searchRegex }
        ];
        
        // Retry with regex search
        productQuery = Product.find(query)
          .populate('categories', 'name slug')
          .populate('compatibleVehicles', 'make model year')
          .sort({ name: 1 }); // Sort alphabetically for regex results
        
        const regexProducts = await productQuery
          .skip(skip)
          .limit(Number(limit));
        
        const regexTotal = await Product.countDocuments(query);
        
        console.log(`[SearchService] Regex fallback found ${regexTotal} results for "${search}"`);
        
        return {
          products: regexProducts,
          pagination: {
            total: regexTotal,
            pages: Math.ceil(regexTotal / Number(limit)),
            currentPage: Number(page),
            hasNext: Number(page) < Math.ceil(regexTotal / Number(limit)),
            hasPrev: Number(page) > 1
          },
          searchMethod: 'regex' // Indicate this was a regex search
        };
      }

      return {
        products,
        pagination: {
          total,
          pages: Math.ceil(total / Number(limit)),
          currentPage: Number(page),
          hasNext: Number(page) < Math.ceil(total / Number(limit)),
          hasPrev: Number(page) > 1
        },
        searchMethod: 'text' // Indicate this was a text search
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

  // ── Shared reference data ────────────────────────────────────────────────────

  // Longer/more-specific entries must come before shorter ones that are substrings.
  static VEHICLE_KEYWORDS = [
    'thar roxx', 'scorpio n', 'innova crysta', 'land cruiser', 'grand vitara',
    'xuv700', 'xuv 700', 'xuv400', 'xuv 400',
    'thar', 'scorpio', 'bolero', 'marazzo',
    'fortuner', 'hilux', 'innova', 'prado', 'rav4', 'rush', 'crysta',
    'endeavour', 'ecosport', 'ranger', 'bronco',
    'nexon', 'harrier', 'safari', 'altroz', 'punch', 'tiago',
    'creta', 'venue', 'alcazar', 'tucson',
    'brezza', 'jimny',
    'wrangler', 'gladiator',
    'pajero', 'outlander', 'montero', 'triton',
    'duster', 'kwid', 'triber', 'kiger',
  ];

  // Maps product-type keywords found in names to a canonical slug and regex for searching.
  // Ordered most-specific first.
  static PRODUCT_TYPES = [
    { slug: 'light-mount',      patterns: ['light mount', 'mount bracket', 'bonnet mount', 'pod mount', 'light bar bracket', 'bar bracket'] },
    { slug: 'wiring-harness',   patterns: ['wiring harness', 'wire harness', 'harness', 'wire loom', 'wiring kit'] },
    { slug: 'led-bar',          patterns: ['led bar', 'light bar', 'led light bar', 'led strip'] },
    { slug: 'auxiliary-light',  patterns: ['auxiliary light', 'driving light', 'pod light', 'led pod', 'spot light', 'work light', 'off road light', 'offroad light', 'led light', 'auxiliary'] },
    { slug: 'fog-light',        patterns: ['fog light', 'fog lamp'] },
    { slug: 'tail-light',       patterns: ['tail light', 'tail lamp', 'brake light', 'rear light', 'tail lamps'] },
    { slug: 'headlight',        patterns: ['headlight', 'head light', 'drl', 'projector light'] },
    { slug: 'switch',           patterns: ['switch panel', 'switch box', 'switch', 'relay'] },
    { slug: 'bonnet',           patterns: ['bonnet scoop', 'bonnet cover', 'bonnet vent', 'bonnet', 'hood'] },
    { slug: 'spoiler',          patterns: ['spoiler', 'trunk lip', 'boot lip', 'rear wing'] },
    { slug: 'bumper',           patterns: ['front bumper', 'rear bumper', 'bumper guard', 'bumper'] },
    { slug: 'grille',           patterns: ['grille', 'grill', 'front mesh', 'front grille'] },
    { slug: 'bull-bar',         patterns: ['bull bar', 'nudge bar', 'push bar', 'front bar'] },
    { slug: 'roll-bar',         patterns: ['roll bar', 'roll cage', 'sports bar', 'grab bar'] },
    { slug: 'roof-rack',        patterns: ['roof rack', 'roof rail', 'luggage carrier', 'crossbar', 'cross bar'] },
    { slug: 'canopy',           patterns: ['canopy', 'hardtop', 'truck cap', 'tonneau'] },
    { slug: 'fender',           patterns: ['fender flare', 'fender', 'wheel arch', 'overfender'] },
    { slug: 'diffuser',         patterns: ['diffuser', 'rear diffuser', 'lip diffuser'] },
    { slug: 'skirt',            patterns: ['side skirt', 'skirt', 'rocker panel'] },
    { slug: 'seat-cover',       patterns: ['seat cover', 'seat back', 'seat cushion', 'lumbar'] },
    { slug: 'floor-mat',        patterns: ['floor mat', 'carpet liner', 'boot mat', 'floor liner', 'mat'] },
    { slug: 'suspension',       patterns: ['suspension', 'shock absorber', 'lift kit', 'coilover', 'lowering spring', 'coil spring'] },
    { slug: 'exhaust',          patterns: ['exhaust', 'muffler', 'catback', 'cat back', 'downpipe'] },
    { slug: 'intake',           patterns: ['air intake', 'cold air intake', 'air filter', 'intake system'] },
    { slug: 'steering',         patterns: ['steering wheel', 'steering cover', 'steering knob'] },
    { slug: 'tailgate',         patterns: ['tailgate', 'tail gate', 'tailgate handle', 'tailgate step'] },
    { slug: 'cladding',         patterns: ['cladding', 'door cladding', 'side cladding', 'body cladding'] },
    { slug: 'camera',           patterns: ['dashcam', 'dash cam', 'dvr', 'recorder'] },
    { slug: 'android-screen',   patterns: ['android screen', 'head unit', 'multimedia', 'car stereo', 'android car'] },
    { slug: 'winch',            patterns: ['winch', 'recovery winch'] },
    { slug: 'bed-rack',         patterns: ['bed rack', 'tub rack', 'cargo rack', 'bed liner'] },
  ];

  // Trigger-keyword → complement-keyword mapping.
  // Determines what "Frequently Bought Together" shows: find products whose names
  // contain ANY of the complement terms.
  static INSTALLATION_ECOSYSTEM = [
    {
      trigger:    ['light mount', 'mount bracket', 'bonnet mount', 'pod mount', 'bar mount', 'holder', 'clamp'],
      complement: ['led', 'auxiliary', 'driving light', 'pod light', 'spot light', 'light bar', 'wiring harness', 'harness', 'switch', 'relay', 'fog light']
    },
    {
      trigger:    ['led bar', 'light bar', 'auxiliary light', 'driving light', 'pod light', 'spot light', 'work light', 'offroad light'],
      complement: ['wiring harness', 'harness', 'switch', 'relay', 'bracket', 'mount', 'bar mount', 'mount bracket']
    },
    {
      trigger:    ['wiring harness', 'wire harness', 'harness', 'wire loom'],
      complement: ['switch', 'relay', 'led', 'auxiliary', 'driving light', 'bracket', 'mount']
    },
    {
      trigger:    ['switch panel', 'switch box', 'switch', 'relay'],
      complement: ['wiring harness', 'harness', 'led', 'auxiliary', 'driving light', 'bracket']
    },
    {
      trigger:    ['bull bar', 'nudge bar', 'push bar', 'front bar'],
      complement: ['led', 'driving light', 'fog light', 'auxiliary', 'wiring harness', 'winch', 'recovery']
    },
    {
      trigger:    ['roof rack', 'roof rail', 'luggage carrier', 'crossbar', 'cross bar'],
      complement: ['led', 'light', 'bracket', 'mount', 'canopy', 'storage', 'portable', 'bag']
    },
    {
      trigger:    ['roll bar', 'roll cage', 'sports bar', 'grab bar'],
      complement: ['led', 'light', 'spotlight', 'storage', 'bag', 'mount', 'bracket']
    },
    {
      trigger:    ['canopy', 'hardtop', 'truck cap'],
      complement: ['rack', 'light', 'led', 'storage', 'bed liner', 'organizer', 'lock']
    },
    {
      trigger:    ['seat cover', 'seat back'],
      complement: ['floor mat', 'carpet', 'armrest', 'steering', 'organizer', 'storage']
    },
    {
      trigger:    ['floor mat', 'carpet liner', 'boot mat'],
      complement: ['seat cover', 'armrest', 'organizer', 'storage', 'cleaning']
    },
    {
      trigger:    ['spoiler', 'trunk lip', 'boot lip', 'rear wing'],
      complement: ['diffuser', 'skirt', 'fender', 'grille', 'bumper']
    },
    {
      trigger:    ['front bumper', 'bumper', 'front guard'],
      complement: ['fog light', 'led', 'driving light', 'grille', 'camera', 'winch', 'recovery']
    },
    {
      trigger:    ['winch', 'recovery winch'],
      complement: ['recovery board', 'snatch', 'rope', 'tow', 'bull bar', 'bumper']
    },
    {
      trigger:    ['suspension', 'lift kit', 'shock absorber', 'coilover'],
      complement: ['wheel', 'tyre', 'brake', 'spacer', 'fender flare']
    },
    {
      trigger:    ['android screen', 'head unit', 'multimedia', 'car stereo'],
      complement: ['camera', 'speaker', 'amplifier', 'subwoofer', 'cable', 'usb']
    },
    {
      trigger:    ['dashcam', 'dash cam', 'dvr'],
      complement: ['mount', 'bracket', 'cable', 'power', 'gps']
    },
    {
      trigger:    ['exhaust', 'muffler', 'catback'],
      complement: ['intake', 'air filter', 'performance', 'turbo', 'intercooler']
    },
    {
      trigger:    ['air intake', 'cold air intake', 'air filter'],
      complement: ['exhaust', 'turbo', 'intercooler', 'performance']
    },
  ];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  static extractVehicleKeyword(name) {
    const lower = name.toLowerCase();
    return SearchService.VEHICLE_KEYWORDS.find(v => lower.includes(v)) || null;
  }

  static extractProductTypeSlug(name) {
    const lower = name.toLowerCase();
    for (const { slug, patterns } of SearchService.PRODUCT_TYPES) {
      if (patterns.some(p => lower.includes(p))) return slug;
    }
    return null;
  }

  static getProductTypeRegex(typeSlug) {
    const entry = SearchService.PRODUCT_TYPES.find(t => t.slug === typeSlug);
    if (!entry) return null;
    // Escape special regex chars in each pattern
    const escaped = entry.patterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return escaped.join('|');
  }

  // Returns a MongoDB $regex string that matches products which complement the given product name.
  // Returns null if no ecosystem mapping applies.
  static getComplementaryNameRegex(productName) {
    const lower = productName.toLowerCase();
    for (const { trigger, complement } of SearchService.INSTALLATION_ECOSYSTEM) {
      if (trigger.some(t => lower.includes(t))) {
        const escaped = complement.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return escaped.join('|');
      }
    }
    return null;
  }

  // ── Core recommendation functions ────────────────────────────────────────────

  /**
   * Get products similar to the specified product.
   * Strategy (name-based, since most products share a generic "Autobacs India" category):
   *   1. Same vehicle + same product type
   *   2. Same vehicle + price range ±40%
   *   3. Same vehicle (all)
   *   4. Same product type + price range ±40%
   *   5. Same product type (all)
   *   6. Price range ±30% (last resort)
   */
  static async getSimilarProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId)
        .select('name price')
        .lean();

      if (!product) {
        console.warn('[SearchService] Product not found:', productId);
        return [];
      }

      const vehicle   = SearchService.extractVehicleKeyword(product.name);
      const typeSlug  = SearchService.extractProductTypeSlug(product.name);
      const typeRegex = typeSlug ? SearchService.getProductTypeRegex(typeSlug) : null;
      const priceMin  = product.price * 0.6;
      const priceMax  = product.price * 1.4;

      console.log('[SearchService] Similar for:', product.name, '| vehicle:', vehicle, '| type:', typeSlug);

      const collected = [];
      const seenIds   = new Set();
      const seen      = () => Array.from(seenIds);
      const add       = (docs) => { for (const d of docs) { const k = d._id.toString(); if (!seenIds.has(k)) { seenIds.add(k); collected.push(d); } } };
      const need      = () => limit - collected.length;
      const base      = { _id: { $ne: productId }, isActive: true };
      const excl      = (extra) => ({ ...base, _id: { $ne: productId, $nin: seen() }, ...extra });
      const find      = (filter, n) => Product.find(filter).sort({ averageRating: -1, totalReviews: -1 }).limit(n).populate('categories', 'name slug').lean();

      // 1. Same vehicle + same product type
      if (vehicle && typeRegex && need() > 0) {
        add(await find(excl({ name: { $regex: vehicle, $options: 'i' } }), need()).then(r => r.filter(p => new RegExp(typeRegex, 'i').test(p.name))));
      }

      // 2. Same vehicle + price range
      if (vehicle && need() > 0) {
        add(await find(excl({ name: { $regex: vehicle, $options: 'i' }, price: { $gte: priceMin, $lte: priceMax } }), need()));
      }

      // 3. Same vehicle (all prices)
      if (vehicle && need() > 0) {
        add(await find(excl({ name: { $regex: vehicle, $options: 'i' } }), need()));
      }

      // 4. Same product type + price range
      if (typeRegex && need() > 0) {
        add(await find(excl({ name: { $regex: typeRegex, $options: 'i' }, price: { $gte: priceMin, $lte: priceMax } }), need()));
      }

      // 5. Same product type (all prices)
      if (typeRegex && need() > 0) {
        add(await find(excl({ name: { $regex: typeRegex, $options: 'i' } }), need()));
      }

      // 6. Price range fallback
      if (collected.length === 0) {
        add(await find(excl({ price: { $gte: priceMin, $lte: priceMax } }), limit));
      }

      console.log('[SearchService] Similar products found:', collected.length);
      return collected.slice(0, limit);
    } catch (error) {
      console.error('[SearchService] getSimilarProducts failed:', error);
      return [];
    }
  }

  /**
   * Get complementary products (Frequently Bought Together).
   * Uses product name ecosystem mapping to find products installed alongside
   * the current one (e.g. bonnet bracket → LED lights, wiring harness, switch).
   */
  static async getComplementaryProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId)
        .select('complementaryProducts name')
        .populate('complementaryProducts')
        .lean();

      if (!product) {
        console.warn('[SearchService] Product not found for complementary:', productId);
        return [];
      }

      console.log('[SearchService] Complementary for:', product.name);

      // Get similar products to exclude them from complementary results
      const similarProducts = await this.getSimilarProducts(productId, 20);
      const similarIds      = new Set(similarProducts.map(p => p._id.toString()));
      const excluded        = () => [productId, ...Array.from(similarIds)];
      const find            = (filter) => Product.find(filter).sort({ averageRating: -1, totalReviews: -1 }).limit(limit).populate('categories', 'name slug').lean();

      // Priority 1: seeded complementary products (from seedComplementaryProducts.js)
      if (product.complementaryProducts?.length > 0) {
        const curated = product.complementaryProducts
          .filter(p => p && p.isActive && !similarIds.has(p._id.toString()))
          .slice(0, limit);
        if (curated.length > 0) {
          console.log('[SearchService] Returning', curated.length, 'curated complementary products');
          return curated;
        }
      }

      // Priority 2: name-based ecosystem matching (direct product-name regex)
      // This ensures we get products from DIFFERENT categories that work together
      const complementRegex = SearchService.getComplementaryNameRegex(product.name);
      if (complementRegex) {
        const docs = await find({ _id: { $nin: excluded() }, isActive: true, name: { $regex: complementRegex, $options: 'i' } });
        console.log('[SearchService] Ecosystem name matching found:', docs.length, 'products');
        if (docs.length > 0) {
          // Double-check: exclude any products that share the same product type as the current product
          const currentType = SearchService.extractProductTypeSlug(product.name);
          if (currentType) {
            const filtered = docs.filter(p => {
              const productType = SearchService.extractProductTypeSlug(p.name);
              return productType !== currentType; // Must be different product type
            });
            if (filtered.length > 0) {
              console.log('[SearchService] Filtered complementary (different type):', filtered.length);
              return filtered;
            }
          }
          return docs;
        }
      }

      // Priority 3: different-vehicle products (contextual discovery)
      // Ensure we get products for OTHER vehicles, not the same vehicle
      const vehicle = SearchService.extractVehicleKeyword(product.name);
      if (vehicle) {
        const docs = await find({ 
          _id: { $nin: excluded() }, 
          isActive: true, 
          name: { $not: new RegExp(vehicle, 'i') } // Exclude current vehicle
        });
        console.log('[SearchService] Different-vehicle fallback found:', docs.length);
        if (docs.length > 0) return docs;
      }

      // Last resort: any active products except similar ones
      const lastResort = await find({ _id: { $nin: excluded() }, isActive: true });
      console.log('[SearchService] Last resort fallback:', lastResort.length);
      return lastResort;
    } catch (error) {
      console.error('[SearchService] getComplementaryProducts failed:', error);
      return [];
    }
  }
}
export default SearchService;
