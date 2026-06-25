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
        const esResult = await elasticsearchService.searchProducts(esParams);
        // Empty-index guard: ES does NOT throw when the index is missing/wiped —
        // it just returns zero hits. Without this, an index outage would surface
        // to users as "no products" instead of transparently falling back to
        // Mongo. If ES yields any hits we trust it; otherwise we drop through to
        // the Mongo path (when Mongo is also empty the answer is identical, so
        // the only cost is a second query on genuinely-empty searches).
        if (esResult?.products?.length > 0) {
          return esResult;
        }
        console.warn('[SearchService] Elasticsearch returned 0 results; falling back to MongoDB');
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

  // Fields the recommendation controllers serialize for the product cards.
  static RECO_FIELDS = 'name slug price originalPrice images averageRating totalReviews brand categories shortDescription description stock isActive compatibleVehicles';

  /**
   * Get products similar to the specified product.
   *
   * Relevance is computed from STRUCTURED signals — never a random fill. A product
   * is only a candidate if it shares at least one real signal with the source:
   * a category, a compatible vehicle (fitment), the brand, or the same product
   * type (derived from the name, which stands in for category where the migrated
   * catalog still has a generic catch-all category). Candidates are then scored:
   *   shared categories  (×5, strongest)
   *   shared fitment     (×3)
   *   same brand         (+2)
   *   same product type  (+2, name-derived)
   *   same vehicle kw    (+2, name-derived)
   *   price within ±30%  (+1, tiebreaker)
   * If nothing shares a signal, returns [] (the section then hides) rather than
   * surfacing unrelated products.
   */
  static async getSimilarProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId)
        .select('name price brand categories compatibleVehicles')
        .lean();

      if (!product) {
        console.warn('[SearchService] Product not found:', productId);
        return [];
      }

      const categoryIds = (product.categories || []).map(c => c.toString());
      const vehicleIds  = (product.compatibleVehicles || []).map(v => v.toString());
      const brand       = product.brand || null;
      const price       = product.price || 0;

      const vehicleKw  = SearchService.extractVehicleKeyword(product.name);
      const typeSlug   = SearchService.extractProductTypeSlug(product.name);
      const typeRegex  = typeSlug ? SearchService.getProductTypeRegex(typeSlug) : null;
      const typeRe     = typeRegex ? new RegExp(typeRegex, 'i') : null;

      // Candidate pool — must match at least one real signal (no random fill).
      const or = [];
      if (categoryIds.length) or.push({ categories: { $in: product.categories } });
      if (vehicleIds.length)  or.push({ compatibleVehicles: { $in: product.compatibleVehicles } });
      if (brand)              or.push({ brand });
      if (typeRegex)          or.push({ name: { $regex: typeRegex, $options: 'i' } });
      if (or.length === 0) return [];

      const candidates = await Product.find({ _id: { $ne: productId }, isActive: true, $or: or })
        .select(SearchService.RECO_FIELDS)
        .limit(60)
        .populate('categories', 'name slug')
        .lean()
        .maxTimeMS(2000);

      const scored = candidates.map((c) => {
        let score = 0;
        const cCats = (c.categories || []).map(x => (x._id || x).toString());
        score += cCats.filter(id => categoryIds.includes(id)).length * 5;
        const cVeh = (c.compatibleVehicles || []).map(x => x.toString());
        score += cVeh.filter(id => vehicleIds.includes(id)).length * 3;
        if (brand && c.brand === brand) score += 2;
        if (typeRe && typeRe.test(c.name)) score += 2;
        if (vehicleKw && (c.name || '').toLowerCase().includes(vehicleKw)) score += 2;
        if (price > 0 && c.price >= price * 0.7 && c.price <= price * 1.3) score += 1;
        return { c, score };
      }).filter(s => s.score > 0);

      scored.sort((a, b) =>
        b.score - a.score ||
        (b.c.averageRating || 0) - (a.c.averageRating || 0) ||
        (b.c.totalReviews || 0) - (a.c.totalReviews || 0) ||
        Math.abs((a.c.price || 0) - price) - Math.abs((b.c.price || 0) - price)
      );

      console.log('[SearchService] Similar for:', product.name, '| candidates:', candidates.length, '| scored:', scored.length);
      return scored.slice(0, limit).map(s => s.c);
    } catch (error) {
      console.error('[SearchService] getSimilarProducts failed:', error);
      return [];
    }
  }

  /**
   * Get complementary products (Frequently Bought Together) — items that go WITH
   * the product, not items like it. Priority order, each requiring a real signal:
   *   1. Admin-curated complementaryProducts.
   *   2. Installation-ecosystem name match (e.g. bonnet bracket → LED lights),
   *      restricted to a DIFFERENT product type.
   *   3. Same-fitment / same-category products of a DIFFERENT product type.
   * The "similar" set is excluded so complementary never duplicates similar. There
   * is NO random last resort — an empty result hides the section.
   */
  static async getComplementaryProducts(productId, limit = 4) {
    try {
      const product = await Product.findById(productId)
        .select('complementaryProducts name categories compatibleVehicles')
        .populate('complementaryProducts')
        .lean();

      if (!product) {
        console.warn('[SearchService] Product not found for complementary:', productId);
        return [];
      }

      console.log('[SearchService] Complementary for:', product.name);

      // Exclude the similar set so complementary results are genuinely different.
      const similarProducts = await this.getSimilarProducts(productId, 20);
      const similarIds = new Set(similarProducts.map(p => p._id.toString()));
      const excluded   = [new mongoose.Types.ObjectId(productId), ...similarProducts.map(p => p._id)];
      const currentType = SearchService.extractProductTypeSlug(product.name);
      const find = (filter) => Product.find(filter)
        .sort({ averageRating: -1, totalReviews: -1 })
        .limit(limit * 3)
        .select(SearchService.RECO_FIELDS)
        .populate('categories', 'name slug')
        .lean()
        .maxTimeMS(2000);
      const differentType = (docs) => (currentType
        ? docs.filter(p => SearchService.extractProductTypeSlug(p.name) !== currentType)
        : docs);

      // Priority 1: admin-curated.
      if (product.complementaryProducts?.length > 0) {
        const curated = product.complementaryProducts
          .filter(p => p && p.isActive && !similarIds.has(p._id.toString()))
          .slice(0, limit);
        if (curated.length > 0) {
          console.log('[SearchService] Returning', curated.length, 'curated complementary products');
          return curated;
        }
      }

      // Priority 2: installation-ecosystem name match (different product type).
      const complementRegex = SearchService.getComplementaryNameRegex(product.name);
      if (complementRegex) {
        const docs = await find({ _id: { $nin: excluded }, isActive: true, name: { $regex: complementRegex, $options: 'i' } });
        const filtered = differentType(docs);
        console.log('[SearchService] Ecosystem match:', docs.length, '→ different-type:', filtered.length);
        if (filtered.length > 0) return filtered.slice(0, limit);
      }

      // Priority 3: same-fitment / same-category items of a DIFFERENT product type.
      const or = [];
      if ((product.compatibleVehicles || []).length) or.push({ compatibleVehicles: { $in: product.compatibleVehicles } });
      if ((product.categories || []).length)         or.push({ categories: { $in: product.categories } });
      if (or.length > 0) {
        const docs = await find({ _id: { $nin: excluded }, isActive: true, $or: or });
        const filtered = differentType(docs);
        console.log('[SearchService] Fitment/category complement:', docs.length, '→ different-type:', filtered.length);
        if (filtered.length > 0) return filtered.slice(0, limit);
      }

      // No random last resort — nothing genuinely complementary found.
      return [];
    } catch (error) {
      console.error('[SearchService] getComplementaryProducts failed:', error);
      return [];
    }
  }
}
export default SearchService;
