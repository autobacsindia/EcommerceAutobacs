import mongoose from "mongoose";
import Product from "../models/Product.js";
import Vehicle from "../models/Vehicle.js";
import categoryRepository from "../repositories/categoryRepository.js";
import elasticsearchService from "./elasticsearchService.js";
import categoryMappingService from "./categoryMappingService.js";
import { expand as expandSynonyms } from "../config/searchSynonyms.js";
import { STOCK_STATUS } from "../utils/stockStatus.js";

class SearchService {
  /**
   * Build the MongoDB filter object from search/filter params. Shared by searchProducts
   * and getFacets so the two never drift. `exclude` lets a facet omit its own dimension
   * (e.g. the brand facet counts brands as if no brand were selected).
   * @param {Object} params
   * @param {{excludeBrand?: boolean, excludeCategory?: boolean}} [exclude]
   * @returns {Object} Mongo query
   */
  static async buildBaseQuery(params, { excludeBrand = false, excludeCategory = false } = {}) {
    const {
      category, brand, minPrice, maxPrice, search,
      vehicle, vehicleMake, vehicleModel,
      isFeatured, isFastMoving, inStock, rating,
    } = params;
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Cast id strings to ObjectId. find() auto-casts via the schema, but aggregate()
    // (used by getFacets) does NOT — so without this, facet counts with a category
    // filter match nothing.
    const toObjectId = (id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);

    const query = { isActive: true };

    // Categories (+ all descendants)
    if (category && !excludeCategory) {
      const categories = Array.isArray(category) ? category : category.split(',');
      if (categories.length > 0) {
        const allCategoryIds = [];
        for (const catIdentifier of categories) {
          if (!categoryMappingService.initialized) await categoryMappingService.initialize();
          const foundCategory = categoryMappingService.findCategory(catIdentifier);
          const seedId = foundCategory ? foundCategory._id.toString() : catIdentifier;
          const childCategoryIds = await categoryMappingService.getAllCategoryIdsIncludingChildren(seedId);
          allCategoryIds.push(...childCategoryIds);
        }
        if (allCategoryIds.length > 0) query.categories = { $in: allCategoryIds.map(toObjectId) };
      }
    }

    // Brands (case-insensitive, multiple)
    if (brand && !excludeBrand) {
      const brands = Array.isArray(brand) ? brand : brand.split(',');
      if (brands.length > 0) {
        query.brand = { $in: brands.map(b => new RegExp('^' + escapeRegex(b.trim()) + '$', 'i')) };
      }
    }

    // Price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Vehicle fitment — explicit id/list, or make/model resolved to vehicle ids.
    if (vehicle) {
      const ids = Array.isArray(vehicle) ? vehicle : String(vehicle).split(',').filter(Boolean);
      query.compatibleVehicles = ids.length > 1 ? { $in: ids } : ids[0];
    } else if (vehicleMake || vehicleModel) {
      const vq = {};
      if (vehicleMake)  vq.make  = new RegExp('^' + escapeRegex(String(vehicleMake).trim()) + '$', 'i');
      if (vehicleModel) vq.model = new RegExp('^' + escapeRegex(String(vehicleModel).trim()) + '$', 'i');
      const matched = await Vehicle.find(vq).select('_id').lean().maxTimeMS(2000);
      query.compatibleVehicles = { $in: matched.map((v) => v._id) };
    }

    if (isFeatured) query.isFeatured = isFeatured === 'true';
    if (isFastMoving) query.isFastMoving = isFastMoving === 'true';
    if (inStock === 'true') query.stock = { $ne: STOCK_STATUS.OUT };

    if (rating) {
      const ratings = Array.isArray(rating) ? rating : rating.split(',').map(Number);
      const validRatings = ratings.filter(r => !isNaN(r));
      if (validRatings.length > 0) query.averageRating = { $gte: Math.max(...validRatings) };
    }

    // Broad text search across product fields + the matching category branch (synonym-expanded).
    if (search) {
      const terms = expandSynonyms(search);
      const [literal, ...synonyms] = terms;
      const orConditions = [];
      // Whole-word match (\b…\b) so short tokens like "led" hit the word "LED" but not
      // substrings ("instal-led"). Precision strategy:
      //  - the LITERAL term the user typed matches high-signal fields (name/brand/tags/sku);
      //  - AUTO-EXPANDED synonyms match the NAME only — matching fuzzy synonyms against
      //    SEO-stuffed tags or long descriptions made "lights" return e.g. a bumper tagged
      //    "fog light bumper". Category-name recall is carried by the category branch below.
      const anchor = (t) => new RegExp('\\b' + escapeRegex(t) + '\\b', 'i');
      if (literal) {
        const lit = anchor(literal);
        orConditions.push({ name: lit }, { brand: lit }, { tags: lit }, { sku: lit });
      }
      for (const s of synonyms) orConditions.push({ name: anchor(s) });
      if (!categoryMappingService.initialized) await categoryMappingService.initialize();
      const matchedCategoryIds = new Set();
      for (const term of terms) {
        const foundCategory = categoryMappingService.findCategory(term);
        if (foundCategory) {
          const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren(foundCategory._id.toString());
          ids.forEach(id => matchedCategoryIds.add(id));
        }
      }
      if (matchedCategoryIds.size > 0) orConditions.push({ categories: { $in: Array.from(matchedCategoryIds).map(toObjectId) } });
      query.$or = orConditions;
    }

    return query;
  }

  /**
   * Facet counts for the filter sidebar. Returns per-brand and per-category product counts
   * for the current context. Each dimension excludes its OWN selection so the counts show
   * what you'd get by (de)selecting each value.
   * @returns {{ brands: Array<{name:string,count:number}>, categories: Array<{categoryId:string,count:number}> }}
   */
  static async getFacets(params) {
    const [brandQuery, categoryQuery] = await Promise.all([
      SearchService.buildBaseQuery(params, { excludeBrand: true }),
      SearchService.buildBaseQuery(params, { excludeCategory: true }),
    ]);

    const [brandAgg, categoryAgg] = await Promise.all([
      Product.aggregate([
        { $match: { ...brandQuery, brand: { $nin: [null, ''] } } },
        { $group: { _id: '$brand', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).option({ maxTimeMS: 3000 }),
      Product.aggregate([
        { $match: categoryQuery },
        { $unwind: '$categories' },
        { $group: { _id: '$categories', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).option({ maxTimeMS: 3000 }),
    ]);

    return {
      brands: brandAgg.map(b => ({ name: b._id, count: b.count })),
      categories: categoryAgg.map(c => ({ categoryId: String(c._id), count: c.count })),
    };
  }

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
    
    // Fallback to MongoDB implementation. Filter-building lives in buildBaseQuery;
    // here we only need the paging/sort/search bits.
    const {
      page = 1,
      limit = 12,
      search,
      sortBy = 'createdAt',
      order = 'desc'
    } = params;

    // Build the Mongo filter (shared with getFacets).
    const query = await SearchService.buildBaseQuery(params);

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Keep out-of-stock products visible but sink them below available ones. The stock
    // enum sorts alphabetically as 'in' < 'low' < 'out', so an ascending primary sort on
    // `stock` yields in-stock → low-stock → out-of-stock; the requested sort applies within
    // each tier.
    const sortOptions = { stock: 1 };
    sortOptions[sortBy] = order === 'asc' ? 1 : -1;

    try {
      const products = await Product.find(query)
        .populate('categories', 'name slug')
        .populate('compatibleVehicles', 'make model')
        .sort(sortOptions)
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .maxTimeMS(3000);

      const total = await Product.countDocuments(query).maxTimeMS(3000);

      return {
        products,
        pagination: {
          total,
          pages: Math.ceil(total / Number(limit)),
          currentPage: Number(page),
          hasNext: Number(page) < Math.ceil(total / Number(limit)),
          hasPrev: Number(page) > 1
        },
        searchMethod: search ? 'broad' : 'filter'
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
    .select('name slug brand categories images')
    .populate('categories', 'name')
    .limit(limit * 2)
    .lean()
    .maxTimeMS(2000);

    // Find categories matching the query
    const categories = await categoryRepository.find({
      name: { $regex: query, $options: 'i' },
      isActive: true
    }).limit(limit).lean().maxTimeMS(2000);

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
          id: product._id.toString(),
          slug: product.slug,
          text: product.name,
          type: 'product',
          category: product.categories && product.categories.length > 0 ? product.categories[0].name : null,
          imageUrl: imageUrl,
          value: product.slug // Use slug for navigation
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

    // Count total matching documents for the total field
    const total = await Product.countDocuments({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } }
      ],
      isActive: true
    }).maxTimeMS(1000).catch(() => 0);

    // Limit to requested number of suggestions
    return {
      suggestions: suggestions.slice(0, limit),
      corrections: [],
      total
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
  static async addToSearchHistory(term, _resultsCount = 0, userId = null) {
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
  static async getSearchHistory(_userId = null, _limit = 10) {
    // For now, we'll return an empty array since we're not persisting history on the server
    // In a more advanced implementation, we would query a search_history collection
    return [];
  }

  /**
   * Clear search history
   * @param {string} userId - User ID (optional)
   * @returns {Object} Success status
   */
  static async clearSearchHistory(_userId = null) {
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
      const find      = (filter, n) => Product.find(filter).sort({ averageRating: -1, totalReviews: -1 }).limit(n).maxTimeMS(2000).populate('categories', 'name slug').lean();

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
      const find            = (filter) => Product.find(filter).sort({ averageRating: -1, totalReviews: -1 }).limit(limit).maxTimeMS(2000).populate('categories', 'name slug').lean();

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
