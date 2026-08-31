import mongoose from "mongoose";
import Product from "../models/Product.js";
import Vehicle from "../models/Vehicle.js";
import categoryRepository from "../repositories/categoryRepository.js";
import elasticsearchService from "./elasticsearchService.js";
import atlasSearchService from "./atlasSearchService.js";
import categoryMappingService from "./categoryMappingService.js";
import { expand as expandSynonyms, contentTokens } from "../config/searchSynonyms.js";
import { STOCK_STATUS } from "../utils/stockStatus.js";

/**
 * Last observed Elasticsearch availability, so an outage is reported on the
 * TRANSITION rather than once per request.
 *
 * The silent case this closes: when isConnected() is false the service skips ES
 * entirely and every public search runs the Mongo fallback — a full-collection
 * regex scan plus an unbounded countDocuments — with nothing written to the log.
 * The ES/Mongo divergence warning cannot cover this, by design: it only fires when
 * ES was actually consulted and came back empty. So a total ES outage was the one
 * failure mode that produced maximum database load and zero evidence.
 *
 * Logging the transition (not every request) keeps a multi-hour outage to two
 * lines instead of one per page view, and still tells you exactly when it started
 * and when it recovered. `null` = not yet observed.
 */
let lastEsAvailability = null;

/**
 * Which search engine backs this deployment.
 *
 * `atlas` = MongoDB Atlas Search, `elastic` (default) = Elasticsearch. Both
 * implement the same six-method contract, so everything below — the fallback
 * ladder, the subtree expansion, the path metrics — is engine-agnostic and is
 * deliberately left untouched by the migration.
 *
 * Resolved per call rather than captured at import time, so the engine can be
 * flipped by an environment variable ALONE. That matters operationally: if Atlas
 * Search misbehaves in production the rollback is a Railway variable change and a
 * restart, not a revert-and-redeploy, and it stays available for as long as both
 * engines are provisioned. It also lets a test exercise both paths in one file.
 */
export function getSearchEngine() {
  return process.env.SEARCH_ENGINE === 'atlas' ? atlasSearchService : elasticsearchService;
}

/** Human-readable engine name, so an outage log names the thing that is actually down. */
function engineLabel() {
  return process.env.SEARCH_ENGINE === 'atlas' ? 'Atlas Search' : 'Elasticsearch';
}

/**
 * How often each search path is actually taken.
 *
 * Phase-A instrumentation for the pagination rework: the MongoDB fallback runs a
 * full-collection regex scan plus an unbounded countDocuments, so it is the only
 * reason to consider replacing them. After the category-slug fix that path should be
 * rare — and rewriting `skip`/`countDocuments` is a frontend-contract change that
 * should not be paid for on a hunch. Measure first, then decide.
 *
 * `esServed` is the healthy path. Everything under `fallback` reaches MongoDB, and
 * the reason distinguishes an outage from an index gap from a genuine miss.
 * `adminMongo` is expected and not a fault: admin listings must see inactive
 * products, which Elasticsearch does not index.
 */
const searchPathMetrics = {
  esServed: 0,
  esServedZero: 0,        // ES answered "nothing" from a POPULATED index — trusted, no Mongo
  fallbackEsZeroHit: 0,   // ES found nothing AND the index looks empty/unknown — Mongo consulted
  fallbackEsDown: 0,      // ES unreachable — the expensive, silent case
  fallbackEsError: 0,     // ES threw mid-query
  adminMongo: 0,          // includeInactive: Mongo by design
};

/** Snapshot of the search-path counters (admin monitor / tests). */
export function getSearchPathMetrics() {
  const total = Object.values(searchPathMetrics).reduce((a, b) => a + b, 0);
  const fallback = searchPathMetrics.fallbackEsZeroHit
    + searchPathMetrics.fallbackEsDown
    + searchPathMetrics.fallbackEsError;
  return {
    ...searchPathMetrics,
    total,
    // The number that decides whether the pagination rework is worth doing.
    mongoFallbackRate: total > 0 ? `${((fallback / total) * 100).toFixed(2)}%` : '0%',
  };
}

/** Test seam. */
export function __resetSearchPathMetrics() {
  for (const k of Object.keys(searchPathMetrics)) searchPathMetrics[k] = 0;
}

// Periodic summary, mirroring CacheService's metrics line so both land in the same
// log stream and can be graphed together. Every 200 searches rather than on a timer,
// so a quiet period never emits noise.
const SEARCH_METRICS_LOG_EVERY = 200;
let searchesSinceLog = 0;
function recordSearchPath(bucket) {
  searchPathMetrics[bucket] += 1;
  if (++searchesSinceLog >= SEARCH_METRICS_LOG_EVERY) {
    searchesSinceLog = 0;
    const m = getSearchPathMetrics();
    console.log(
      `[SearchService] Path metrics: mongoFallbackRate=${m.mongoFallbackRate} ` +
      `esServed=${m.esServed} zeroHit=${m.fallbackEsZeroHit} esDown=${m.fallbackEsDown} ` +
      `esError=${m.fallbackEsError} admin=${m.adminMongo} total=${m.total}`
    );
  }
}

/** Test seam: forget the observed state so a transition can be asserted cleanly. */
export function __resetEsAvailabilityTracker() {
  lastEsAvailability = null;
}

class SearchService {
  /**
   * Resolve a category identifier (or comma-separated list) to its whole subtree,
   * as BOTH ObjectIds and slugs.
   *
   * One walk, two projections, and that is the entire point. Mongo filters
   * products by category ObjectId; Elasticsearch has no ObjectId in its documents
   * and can only filter on `categories.slug.keyword`. Resolving them separately is
   * how they drifted: the URL carries a slug, the ES filter compared that slug
   * against the category DISPLAY NAME, and it matched nothing — "exterior" is
   * never equal to "Exterior", and "vehicles-parts" is never equal to
   * "Vehicles & Parts". ES returned 0, every category page fell through to the
   * Mongo fallback, and each one cost a full collection scan plus an unbounded
   * countDocuments. That is what drove the Atlas query-targeting alert.
   *
   * ES also has no notion of the hierarchy, so the descendants must be expanded
   * here and passed down as a flat list: the hub "Exterior" alone matches 68
   * directly-tagged products, while its 60-slug subtree matches 394 — the number
   * Mongo returns.
   *
   * @param {string|string[]} category  slug, id, or name (or a list of them)
   * @returns {Promise<{ids: string[], slugs: string[]}>} deduplicated, subtree-expanded
   */
  static async resolveCategorySubtree(category) {
    const identifiers = Array.isArray(category) ? category : String(category).split(',');
    const ids = new Set();
    const slugs = new Set();

    for (const raw of identifiers) {
      const catIdentifier = String(raw || '').trim();
      if (!catIdentifier) continue;

      if (!categoryMappingService.initialized) await categoryMappingService.initialize();
      const foundCategory = categoryMappingService.findCategory(catIdentifier);
      // Unknown identifier: keep passing it through as an id so the Mongo filter
      // behaves exactly as it did before (matching nothing) rather than silently
      // widening to the entire catalogue.
      const seedId = foundCategory ? foundCategory._id.toString() : catIdentifier;

      for (const id of await categoryMappingService.getAllCategoryIdsIncludingChildren(seedId)) {
        ids.add(id);
      }
      // Only resolvable categories contribute slugs. An unresolvable identifier has
      // no subtree to expand, and inventing one would let ES answer a filter Mongo
      // would reject.
      if (foundCategory) {
        for (const slug of await categoryMappingService.getAllCategorySlugsIncludingChildren(seedId)) {
          slugs.add(slug);
        }
      }
    }

    return { ids: Array.from(ids), slugs: Array.from(slugs) };
  }

  /**
   * Build the MongoDB filter object from search/filter params. Shared by searchProducts
   * and getFacets so the two never drift. `exclude` lets a facet omit its own dimension
   * (e.g. the brand facet counts brands as if no brand were selected).
   * @param {Object} params
   * @param {{excludeBrand?: boolean, excludeCategory?: boolean}} [exclude]
   * @returns {Object} Mongo query
   */
  static async buildBaseQuery(params, { excludeBrand = false, excludeCategory = false, includeInactive = false } = {}) {
    const {
      category, brand, minPrice, maxPrice, search,
      vehicle, vehicleMake, vehicleModel,
      isFeatured, isFastMoving, inStock, rating, status, productType,
    } = params;
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Cast id strings to ObjectId. find() auto-casts via the schema, but aggregate()
    // (used by getFacets) does NOT — so without this, facet counts with a category
    // filter match nothing.
    const toObjectId = (id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);

    // Public callers see ONLY active products (hard default). Admin callers pass
    // `includeInactive` to manage drafts/disabled items too, and may narrow with an
    // explicit `status` (active|inactive). A public request can never set this — the
    // flag is supplied by the server (admin controller), not read from user query.
    const query = {};
    if (!includeInactive) {
      query.isActive = true;
    } else if (status === 'active') {
      query.isActive = true;
    } else if (status === 'inactive') {
      query.isActive = false;
    }

    // Product-type narrowing (admin filter: simple / variable / grouped).
    if (productType && ['simple', 'variable', 'grouped'].includes(productType)) {
      query.productType = productType;
    }

    // Categories (+ all descendants). Resolved through the shared helper so the
    // Mongo filter and the Elasticsearch filter cover the same subtree.
    if (category && !excludeCategory) {
      const { ids } = await SearchService.resolveCategorySubtree(category);
      if (ids.length > 0) query.categories = { $in: ids.map(toObjectId) };
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

    // Broad text search across product fields + the matching category branch.
    // Mirrors the Elasticsearch precision model (services/elasticsearchService.js)
    // so the fallback returns the same intuitive set. Whole-word match (\b…\b) so
    // short tokens like "led" hit the word "LED" but not substrings ("instal-led").
    if (search) {
      const anchor = (t) => new RegExp('\\b' + escapeRegex(t) + '\\b', 'i');
      const tokens = contentTokens(search);
      const isSingleToken = tokens.length <= 1;

      if (!categoryMappingService.initialized) await categoryMappingService.initialize();
      // Category-name recall. For a single (category-style) token we resolve the
      // whole synonym set to catch "lights"→Lighting; for a specific multi-word
      // query we only resolve the literal phrase (synonyms would over-recall).
      const catTerms = isSingleToken ? expandSynonyms(search) : [tokens.join(' ')];
      const matchedCategoryIds = new Set();
      for (const term of catTerms) {
        const foundCategory = categoryMappingService.findCategory(term);
        if (foundCategory) {
          const ids = await categoryMappingService.getAllCategoryIdsIncludingChildren(foundCategory._id.toString());
          ids.forEach(id => matchedCategoryIds.add(id));
        }
      }
      const categoryBranch = matchedCategoryIds.size > 0
        ? { categories: { $in: Array.from(matchedCategoryIds).map(toObjectId) } }
        : null;

      if (isSingleToken) {
        // Broad recall for a category-style search: literal on high-signal fields,
        // synonyms on the NAME only (fuzzy synonyms against SEO-stuffed tags/desc
        // over-recall), plus the category branch.
        const terms = expandSynonyms(search);
        const [literal, ...synonyms] = terms;
        const orConditions = [];
        if (literal) {
          const lit = anchor(literal);
          orConditions.push({ name: lit }, { brand: lit }, { tags: lit }, { sku: lit });
        }
        for (const s of synonyms) orConditions.push({ name: anchor(s) });
        if (categoryBranch) orConditions.push(categoryBranch);
        query.$or = orConditions;
      } else {
        // Precise recall for a specific multi-word query: EVERY token must appear
        // in some high-signal field (this is the ES cross_fields `operator:'and'`
        // parity — it's what stops "spoiler" from dragging in every bumper), OR the
        // query resolves to a category whose subtree we return.
        const perToken = tokens.map((t) => {
          const a = anchor(t);
          return { $or: [{ name: a }, { brand: a }, { tags: a }, { sku: a }] };
        });
        query.$or = categoryBranch
          ? [{ $and: perToken }, categoryBranch]
          : [{ $and: perToken }];
      }
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
        // Collect the DISTINCT product ids per category (not a raw $sum count):
        // the rollup below unions these up the tree so a hub badge counts each
        // product once even when it's tagged with several categories in the same
        // subtree. A plain sum double-counts multi-tagged products and inflates
        // the badge above the listing's distinct total (see rollUpCategoryCounts).
        { $group: { _id: '$categories', ids: { $addToSet: '$_id' } } },
      ]).option({ maxTimeMS: 3000 }),
    ]);

    // The aggregation yields DIRECT id sets (products tagged with each exact
    // category). But the sidebar renders top-level hubs, and selecting a hub
    // expands to its whole subtree in buildBaseQuery — so a hub's badge must
    // reflect the subtree, not the (usually zero) direct set. Union direct id
    // sets up the parent tree so each badge equals the distinct product total
    // the listing (countDocuments over the subtree) would return.
    const rolledCategories = SearchService.rollUpCategoryCounts(categoryAgg);

    return {
      brands: brandAgg.map(b => ({ name: b._id, count: b.count })),
      categories: rolledCategories,
    };
  }

  /**
   * Roll direct per-category product id sets up the category tree so every
   * ancestor's count includes its descendants — counting each product ONCE even
   * when it's tagged with several categories in the subtree. Uses the cached
   * parent→children index. This makes the sidebar badge equal the listing's
   * distinct total (countDocuments over the expanded subtree); a prior sum-based
   * rollup double-counted multi-tagged products (e.g. accessory read 132 vs 120).
   * @param {Array<{_id: any, ids: any[]}>} directAgg
   * @returns {Array<{categoryId: string, count: number}>} descending by count
   */
  static rollUpCategoryCounts(directAgg) {
    // Own (direct) distinct product ids per category, as string sets.
    const directIdsById = new Map(
      directAgg.map(c => [String(c._id), new Set((c.ids || []).map(String))])
    );

    if (!categoryMappingService.initialized) {
      // Cache not warm — fall back to raw direct counts rather than crashing.
      return Array.from(directIdsById.entries())
        .map(([categoryId, set]) => ({ categoryId, count: set.size }))
        .filter(c => c.count > 0)
        .sort((a, b) => b.count - a.count);
    }

    const childIndex = categoryMappingService.buildChildIndex(); // parentId -> [child]

    const memo = new Map();
    const inProgress = new Set();
    // Union of distinct product ids across this category and all descendants.
    const subtreeIds = (id) => {
      if (memo.has(id)) return memo.get(id);
      if (inProgress.has(id)) return new Set(); // cycle guard
      inProgress.add(id);
      const union = new Set(directIdsById.get(id) || []);
      for (const child of (childIndex.get(id) || [])) {
        for (const pid of subtreeIds(String(child._id))) union.add(pid);
      }
      inProgress.delete(id);
      memo.set(id, union);
      return union;
    };

    // Every category that has direct products OR is a parent of something needs
    // a rolled-up figure (a hub with no direct products still gets its subtree).
    const ids = new Set(directIdsById.keys());
    for (const parentId of childIndex.keys()) ids.add(parentId);

    return Array.from(ids)
      .map(id => ({ categoryId: id, count: subtreeIds(id).size }))
      .filter(c => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Search products with filters and pagination
   * @param {Object} params - Search parameters
   * @returns {Object} Search results with products and pagination info
   */
  static async searchProducts(params, { includeInactive = false } = {}) {
    // Elasticsearch indexes ONLY active products (see indexAllProducts), so an admin
    // list that must surface inactive/draft items skips ES and goes straight to Mongo
    // against the full collection. Public search keeps using ES when available.
    let esZeroHit = false; // ES was consulted, did not throw, and returned no hits

    // Availability is resolved into a variable (rather than inlined into the `if`)
    // so the transition can be reported. See lastEsAvailability above.
    const esAvailable = includeInactive ? null : await getSearchEngine().isConnected();
    if (esAvailable !== null && esAvailable !== lastEsAvailability) {
      if (esAvailable) {
        console.log(`[SearchService] ${engineLabel()} is available again; search is back on the index`);
      } else {
        console.error(
          `[SearchService] ${engineLabel()} UNAVAILABLE — every public search is now falling back ` +
          'to a full MongoDB scan. Expect elevated Atlas query targeting until it returns.'
        );
      }
      lastEsAvailability = esAvailable;
    }

    if (esAvailable) {
      try {
        const esParams = { ...params };
        if (!esParams.q && esParams.search) {
          esParams.q = esParams.search;
        }
        // Expand the category filter to its subtree SLUGS before handing it to ES.
        // ES documents carry `categories.slug`, never the ObjectId, and they carry
        // only the categories a product is directly tagged with — so the hierarchy
        // has to be flattened here or a hub filter matches almost nothing.
        // resolveCategorySubtree is the same walk the Mongo filter uses, which is
        // what stops the two engines answering the same URL differently.
        if (esParams.category) {
          // One walk, two projections — now literally serving two engines.
          // Elasticsearch can only filter on `categories.slug.keyword` because its
          // documents carry no ObjectId; Atlas Search indexes the real document and
          // filters on the ObjectIds MongoDB itself uses. Resolving both here, from
          // the SAME walk, is what stops the engines answering one URL differently —
          // resolving them separately is exactly how they drifted last time.
          const { ids, slugs } = await SearchService.resolveCategorySubtree(esParams.category);
          esParams.categorySlugs = slugs;
          esParams.categoryIds = ids;
        }
        const esResult = await getSearchEngine().searchProducts(esParams);
        // Empty-index guard: ES does NOT throw when the index is missing/wiped —
        // it just returns zero hits. Without this, an index outage would surface
        // to users as "no products" instead of transparently falling back to
        // Mongo. If ES yields any hits we trust it; otherwise we drop through to
        // the Mongo path (when Mongo is also empty the answer is identical, so
        // the only cost is a second query on genuinely-empty searches).
        if (esResult?.products?.length > 0) {
          recordSearchPath('esServed');
          return esResult;
        }
        // Zero hits from a POPULATED index means "we genuinely don't stock this",
        // and that answer is already correct — re-asking MongoDB cost a full
        // collection regex scan PLUS an unbounded countDocuments, i.e. two ~930-doc
        // scans to reprove an empty result. Atlas scored those shapes at
        // inefficiency 930, the worst remaining after the cart fix.
        //
        // The fallback still exists for the case it was actually written for: ES
        // does not throw on a missing/wiped index, it returns zero hits. So the
        // deciding question is not "did ES return nothing?" but "is the index
        // populated?". A populated index is trusted; anything else falls through.
        //
        // `null` (unknown — disabled, no client, or the count failed) counts as NOT
        // populated, so an ambiguous signal fails towards the expensive-but-correct
        // scan rather than towards showing an empty catalogue.
        const indexedDocs = await getSearchEngine().getIndexedDocumentCount();
        if (indexedDocs > 0) {
          recordSearchPath('esServedZero');
          return esResult;
        }

        console.error(
          `[SearchService] ${engineLabel()} returned 0 hits and the index reports ` +
          (indexedDocs === null ? 'an UNKNOWN document count' : `${indexedDocs} documents`) +
          ' — treating this as an index outage and falling back to MongoDB. ' +
          'Verify with reindex-products.'
        );
        esZeroHit = true;
        recordSearchPath('fallbackEsZeroHit');
      } catch (error) {
        recordSearchPath('fallbackEsError');
        console.error('Elasticsearch search failed, falling back to MongoDB:', error);
      }
    } else {
      // Either an admin listing (Mongo by design) or Elasticsearch is unreachable
      // (Mongo by accident, and expensively so). Counting them apart is the point.
      recordSearchPath(includeInactive ? 'adminMongo' : 'fallbackEsDown');
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
    const query = await SearchService.buildBaseQuery(params, { includeInactive });

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

      // ES/Mongo divergence — the actionable half of the empty-index guard above.
      // ES returning nothing is unremarkable on its own (most such searches are for
      // things we don't stock, and logging those buries the real signal in noise).
      // It matters only when Mongo then finds matches ES did not, which is exactly
      // what a missing, wiped, or drifted index looks like from the outside. Both
      // counts and the query are included so the line is alertable on its own.
      if (esZeroHit && total > 0) {
        console.warn(
          `[SearchService] ES/Mongo divergence: query=${JSON.stringify(search || '(filters only)')} ` +
          `es=0 mongo=${total} — Elasticsearch index may be stale or incomplete; ` +
          `verify with reindex-products`
        );
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
    if (await getSearchEngine().isConnected()) {
      try {
        return await getSearchEngine().getSearchSuggestions(query, limit);
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
    if (await getSearchEngine().isConnected()) {
      try {
        return await getSearchEngine().getSearchAnalytics(startDate, endDate);
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
      if (await getSearchEngine().isConnected()) {
        await getSearchEngine().logSearchQuery(term, userId);
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
  static RECO_FIELDS = 'name slug price originalPrice images averageRating totalReviews brand categories shortDescription description stock isActive compatibleVehicles productType priceMin priceMax';

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
   * Resolve the fitment tiers for a product's `compatibleVehicles`.
   *
   * Tier 2 = the very same Vehicle docs (same make AND model — "Mahindra Thar").
   * Tier 1 = any Vehicle sharing a make with them ("Mahindra", other models).
   *
   * Make matching is anchored + case-insensitive as a cheap guard, NOT to repair
   * existing data — as of 2026-08-04 prod holds 14 makes, all clean Title Case,
   * no casing or whitespace variants. But `Vehicle.make` is free text with only
   * `trim: true` (no enum, no normalization), so one admin typing "mahindra"
   * would silently empty the same-make tier. The collection is 28 docs, so the
   * collscan a case-insensitive regex forces costs nothing.
   *
   * @param {Array} vehicleRefs `product.compatibleVehicles`
   * @returns {Promise<{exact: Set<string>, sameMake: Set<string>, makes: string[]}>}
   */
  static async resolveFitmentTiers(vehicleRefs) {
    const exact = new Set((vehicleRefs || []).map(String));
    if (exact.size === 0) return { exact, sameMake: new Set(), makes: [] };

    const vehicles = await Vehicle.find({ _id: { $in: vehicleRefs } })
      .select('make')
      .lean()
      .maxTimeMS(2000);

    const makes = [...new Set(vehicles.map(v => v.make).filter(Boolean))];
    if (makes.length === 0) return { exact, sameMake: new Set(), makes: [] };

    const makePatterns = makes.map(m => new RegExp(`^${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
    const siblings = await Vehicle.find({ make: { $in: makePatterns } })
      .select('_id')
      .lean()
      .maxTimeMS(2000);

    // Same-make MINUS the exact vehicles, so the two tiers stay disjoint.
    const sameMake = new Set(siblings.map(v => String(v._id)).filter(id => !exact.has(id)));
    return { exact, sameMake, makes };
  }

  /**
   * Get complementary products (Frequently Bought Together) — items that go WITH
   * the product, not items like it. Candidates come from three sources, each
   * requiring a real signal:
   *   1. Admin-curated complementaryProducts.
   *   2. Installation-ecosystem name match (e.g. bonnet bracket → LED lights),
   *      restricted to a DIFFERENT product type.
   *   3. Same-fitment / same-make / same-category products of a DIFFERENT type.
   *
   * Within each source, results are ordered by vehicle fitment: exact make+model
   * first ("Mahindra Thar"), then same make ("Mahindra", other models), then the
   * rest. Sources are consumed in order and topped up until `limit` is filled, so
   * a curated pick always outranks an algorithmic one but never leaves the rail
   * short.
   *
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

      // Exclude the similar set so the two rails never show the same card.
      // Scoped to `limit` — i.e. exactly what the Similar rail renders — because
      // the similar score weights shared fitment heavily, so a wider exclusion
      // would drop the very same-make/model items this function ranks first,
      // for products the shopper never actually sees in the Similar rail.
      const similarProducts = await this.getSimilarProducts(productId, limit);
      const similarIds = new Set(similarProducts.map(p => p._id.toString()));
      const excluded   = [new mongoose.Types.ObjectId(productId), ...similarProducts.map(p => p._id)];
      const currentType = SearchService.extractProductTypeSlug(product.name);

      const { exact, sameMake } = await SearchService.resolveFitmentTiers(product.compatibleVehicles);
      const sameMakeIds = [...sameMake].map(id => new mongoose.Types.ObjectId(id));

      // 2 = same make+model, 1 = same make, 0 = no fitment overlap.
      const fitmentTier = (p) => {
        const ids = (p.compatibleVehicles || []).map(String);
        if (ids.some(id => exact.has(id))) return 2;
        if (ids.some(id => sameMake.has(id))) return 1;
        return 0;
      };
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

      const picked = [];
      const seen = new Set();
      const collect = (docs) => {
        for (const doc of docs) {
          const key = String(doc._id);
          if (picked.length >= limit) break;
          if (seen.has(key)) continue;
          seen.add(key);
          picked.push(doc);
        }
      };

      // EVERY source feeds one pool that is ranked globally by fitment first.
      // Ranking within each source instead lets whichever source runs earlier
      // fill the rail with tier-0 items — that is how a Thar page ended up
      // leading with Isuzu, Innova, Endeavour and Jimny parts.
      //
      // Source rank only breaks ties WITHIN a fitment tier, where it encodes
      // signal strength: an admin's explicit pick beats a real "bought with"
      // relationship, which beats bare fitment, which beats a shared category.
      //
      // Curation is deliberately NOT above fitment. Admin lists are inherited
      // from the WooCommerce import and routinely name parts for other vehicles;
      // a curated Isuzu shutter must never outrank a Thar part on a Thar page.
      // A curated pick still wins among items that fit equally well.
      const SOURCE = { CURATED: 0, ECOSYSTEM: 1, FITMENT: 2, CATEGORY: 3 };
      const pool = [];
      const pooled = new Set();
      const addToPool = (docs, source) => {
        for (const doc of docs) {
          const key = String(doc._id);
          if (seen.has(key) || pooled.has(key)) continue;
          pooled.add(key);
          pool.push({ doc, source, tier: fitmentTier(doc), i: pool.length });
        }
      };
      const slots = limit - picked.length;
      const poolTierCount = (minTier) => pool.reduce((n, x) => n + (x.tier >= minTier ? 1 : 0), 0);

      // Admin-curated. Exempt from the different-type filter — an admin naming a
      // same-type accessory means it, whereas the derived sources need that guard
      // to avoid recommending a near-duplicate of the product being viewed.
      if (product.complementaryProducts?.length > 0) {
        const curated = product.complementaryProducts
          .filter(p => p && p.isActive && !similarIds.has(p._id.toString()));
        console.log('[SearchService] Curated complementary:', curated.length);
        addToPool(curated, SOURCE.CURATED);
      }

      // Installation-ecosystem name match (e.g. bonnet bracket → LED lights).
      const complementRegex = SearchService.getComplementaryNameRegex(product.name);
      if (slots > 0 && complementRegex) {
        const docs = await find({ _id: { $nin: excluded }, isActive: true, name: { $regex: complementRegex, $options: 'i' } });
        const filtered = differentType(docs);
        console.log('[SearchService] Ecosystem match:', docs.length, '→ different-type:', filtered.length);
        addToPool(filtered, SOURCE.ECOSYSTEM);
      }

      // Fitment/category as separate queries rather than one $or: a single query
      // sorted by rating would let popular category-only items crowd exact-fitment
      // ones out of the `limit * 3` window before tiering ever saw them.
      //
      // The skip guards are safe because the tiers are ordered — a same-make doc
      // can never outrank a make+model one, and a category doc that DID fit would
      // already have been returned by one of the fitment queries.
      // Clauses are thunks: each guard must see the pool as the PREVIOUS queries
      // left it, so they cannot be evaluated up front.
      const poolQueries = [
        ['same make+model', SOURCE.FITMENT, () =>
          slots > 0 && (product.compatibleVehicles || []).length
            ? { compatibleVehicles: { $in: product.compatibleVehicles } } : null],
        ['same make', SOURCE.FITMENT, () =>
          slots > poolTierCount(2) && sameMakeIds.length
            ? { compatibleVehicles: { $in: sameMakeIds } } : null],
        ['same category', SOURCE.CATEGORY, () =>
          slots > poolTierCount(1) && (product.categories || []).length
            ? { categories: { $in: product.categories } } : null],
      ];
      for (const [label, source, buildClause] of poolQueries) {
        const clause = buildClause();
        if (!clause) continue;
        const docs = await find({ _id: { $nin: excluded }, isActive: true, ...clause });
        const filtered = differentType(docs);
        console.log(`[SearchService] Complement (${label}):`, docs.length, '→ different-type:', filtered.length);
        addToPool(filtered, source);
      }

      // Stable: equal (tier, source) keeps the DB's rating/reviews order.
      pool.sort((a, b) => b.tier - a.tier || a.source - b.source || a.i - b.i);
      collect(pool.map(x => x.doc));

      // No random last resort — nothing genuinely complementary found.
      return picked.slice(0, limit);
    } catch (error) {
      console.error('[SearchService] getComplementaryProducts failed:', error);
      return [];
    }
  }
}
export default SearchService;
