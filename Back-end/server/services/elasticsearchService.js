import { Client } from '@elastic/elasticsearch';
import Product from '../models/Product.js';
import { expand as expandSynonyms, contentTokens } from '../config/searchSynonyms.js';

class ElasticsearchService {
  constructor() {
    // Check if Elasticsearch is enabled
    this.enabled = process.env.ELASTICSEARCH_ENABLED === 'true';
    this.connectionStatus = {
      available: false,
      lastChecked: null,
      lastError: null,
      cacheTimeout: 30000 // 30 seconds cache
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      failures: 0,
      threshold: 5,
      resetTimeout: 60000, // 1 minute
      state: 'closed' // closed, open, half-open
    };
    
    if (!this.enabled) {
      if (process.env.NODE_ENV !== 'test') {
        console.log('ℹ Elasticsearch is disabled. Using MongoDB for search operations.');
        console.log('  To enable: Set ELASTICSEARCH_ENABLED=true in .env file');
      }
      this.client = null;
      return;
    }
    
    // Validate configuration
    const node = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';
    const username = process.env.ELASTICSEARCH_USERNAME || 'elastic';
    const password = process.env.ELASTICSEARCH_PASSWORD || 'changeme';
    const retryTimeout = parseInt(process.env.ELASTICSEARCH_RETRY_TIMEOUT || '5000');
    
    // Initialize Elasticsearch client
    try {
      this.client = new Client({
        node: node,
        auth: {
          username: username,
          password: password
        },
        requestTimeout: retryTimeout,
        maxRetries: 3
      });
      
      if (process.env.NODE_ENV !== 'test') {
        console.log('ℹ Elasticsearch client initialized');
        console.log(`  Node: ${node}`);
        console.log(`  Timeout: ${retryTimeout}ms`);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('✗ Failed to initialize Elasticsearch client:', error.message);
      }
      this.client = null;
      this.enabled = false;
    }
    
    // Index name is env-driven so a non-prod tier (e.g. staging on `develop`)
    // can point at the same ES deployment without clobbering the prod `products`
    // index. Defaults to `products` for backward compatibility.
    this.indexName = process.env.ELASTICSEARCH_INDEX || 'products';
  }

  /**
   * Check if Elasticsearch is connected
   */
  async isConnected() {
    // If Elasticsearch is disabled, return false immediately
    if (!this.enabled || !this.client) {
      return false;
    }
    
    // Check circuit breaker state
    if (this.circuitBreaker.state === 'open') {
      // Check if it's time to try half-open
      const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceLastFailure < this.circuitBreaker.resetTimeout) {
        return false;
      }
      // Try half-open state
      this.circuitBreaker.state = 'half-open';
    }
    
    // Use cached status if available and fresh
    const now = Date.now();
    if (this.connectionStatus.lastChecked && 
        (now - this.connectionStatus.lastChecked) < this.connectionStatus.cacheTimeout) {
      return this.connectionStatus.available;
    }
    
    // Perform actual connection check
    try {
      // ES client v8 resolves to the response body directly (no `.statusCode`
      // unless called with { meta: true }). A resolved info() carrying cluster
      // identity means the node is reachable and authenticated.
      const info = await this.client.info();
      const isAvailable = !!(info && (info.cluster_name || info.version));
      
      // Update connection status
      this.connectionStatus.available = isAvailable;
      this.connectionStatus.lastChecked = now;
      this.connectionStatus.lastError = null;
      
      // Reset circuit breaker on success
      if (isAvailable) {
        if (this.circuitBreaker.state === 'half-open') {
          console.log('✓ Elasticsearch connection restored');
        }
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.state = 'closed';
      }
      
      return isAvailable;
    } catch (error) {
      // Update connection status
      this.connectionStatus.available = false;
      this.connectionStatus.lastChecked = now;
      this.connectionStatus.lastError = error.message;
      
      // Update circuit breaker
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailureTime = now;
      
      if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
        if (this.circuitBreaker.state !== 'open') {
          console.warn('⚠ Elasticsearch connection failed multiple times. Opening circuit breaker.');
          console.warn(`  Error: ${error.message}`);
          console.warn('  Falling back to MongoDB for search operations.');
        }
        this.circuitBreaker.state = 'open';
      } else if (this.circuitBreaker.failures === 1) {
        // Only log on first failure to avoid spam
        console.warn('⚠ Elasticsearch connection unavailable. Falling back to MongoDB.');
      }
      
      return false;
    }
  }

  /**
   * Close the Elasticsearch client
   */
  async shutdown() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connectionStatus.available = false;
    }
  }

  /**
   * Test initial connection at startup
   */
  async testConnection() {
    if (!this.enabled || !this.client) {
      return {
        connected: false,
        enabled: this.enabled,
        message: 'Elasticsearch is disabled'
      };
    }
    
    try {
      const info = await this.client.info();

      if (info && (info.cluster_name || info.version)) {
        console.log('✓ Elasticsearch connection successful');
        console.log(`  Cluster: ${info.cluster_name}`);
        console.log(`  Version: ${info.version.number}`);
        
        this.connectionStatus.available = true;
        this.connectionStatus.lastChecked = Date.now();
        
        return {
          connected: true,
          enabled: true,
          clusterName: info.cluster_name,
          version: info.version.number
        };
      }
    } catch (error) {
      console.warn('⚠ Elasticsearch connection failed at startup');
      console.warn(`  Error: ${error.message}`);
      console.warn('  The application will use MongoDB for search operations.');
      console.warn('  To fix: Ensure Elasticsearch is running and accessible.');
      
      this.connectionStatus.available = false;
      this.connectionStatus.lastChecked = Date.now();
      this.connectionStatus.lastError = error.message;
      
      return {
        connected: false,
        enabled: true,
        error: error.message
      };
    }
  }

  /**
   * Get connection status information
   */
  getConnectionStatus() {
    return {
      enabled: this.enabled,
      available: this.connectionStatus.available,
      lastChecked: this.connectionStatus.lastChecked,
      lastError: this.connectionStatus.lastError,
      circuitBreakerState: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures
    };
  }

  /**
   * Create the products index with proper mapping
   */
  async createIndex() {
    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      
      if (!exists) {
        await this.client.indices.create({
          index: this.indexName,
          body: {
            mappings: {
              properties: {
                productId: { type: 'keyword' },
                name: { 
                  type: 'text',
                  analyzer: 'standard',
                  fields: {
                    keyword: { type: 'keyword' }
                  }
                },
                description: { type: 'text', analyzer: 'standard' },
                shortDescription: { type: 'text', analyzer: 'standard' },
                category: { 
                  type: 'object',
                  properties: {
                    id: { type: 'keyword' },
                    name: { type: 'keyword' },
                    slug: { type: 'keyword' }
                  }
                },
                brand: { type: 'keyword' },
                price: { type: 'float' },
                originalPrice: { type: 'float' },
                stock: { type: 'keyword' },
                sku: { type: 'keyword' },
                isActive: { type: 'boolean' },
                isFeatured: { type: 'boolean' },
                isFastMoving: { type: 'boolean' },
                averageRating: { type: 'float' },
                totalReviews: { type: 'integer' },
                tags: { type: 'keyword' },
                slug: { type: 'keyword' },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
                vehicle_makes: {
                  type: 'keyword',
                  fields: {
                    text: { type: 'text', analyzer: 'standard' }
                  }
                },
                vehicle_models: {
                  type: 'keyword',
                  fields: {
                    text: { type: 'text', analyzer: 'standard' }
                  }
                }
              }
            }
          }
        });
        console.log(`Created Elasticsearch index: ${this.indexName}`);
      }
    } catch (error) {
      console.error('Error creating Elasticsearch index:', error);
      throw error;
    }
  }

  /**
   * Normalize a product's `images` field into the canonical array shape the
   * frontend/API contract expects: [{ url, alt, isPrimary }]. Accepts the
   * Mongoose array form, a legacy single-string URL, or null/undefined.
   * Returns [] when there is no usable image. Pure + side-effect free so it can
   * be reused at both index time and read time.
   */
  static normalizeImages(images, productName = '') {
    if (Array.isArray(images)) {
      return images
        .filter(img => img && (typeof img === 'string' ? img : img.url))
        .map(img =>
          typeof img === 'string'
            ? { url: img, alt: productName, isPrimary: false }
            : { url: img.url, alt: img.alt || productName, isPrimary: !!img.isPrimary }
        );
    }
    if (typeof images === 'string' && images.trim() !== '') {
      return [{ url: images, alt: productName, isPrimary: true }];
    }
    return [];
  }

  /**
   * Index a single product.
   * @param {Object} product
   * @param {{refresh?: boolean|'wait_for'}} [opts] - Pass `refresh: 'wait_for'`
   *   (used by the search-sync worker) so the call resolves only once the doc is
   *   visible to search — the caller can then safely bust the product cache
   *   without re-caching a result that predates this write. Left `false` for
   *   bulk reindex (`indexAllProducts`), which refreshes once at the end.
   */
  async indexProduct(product, { refresh = false } = {}) {
    if (!this.enabled || !this.client) {
      return;
    }

    try {
      // Extract vehicle info if available
      let vehicleMakes = [];
      let vehicleModels = [];
      
      if (product.compatibleVehicles && Array.isArray(product.compatibleVehicles)) {
        product.compatibleVehicles.forEach(v => {
          if (v && v.make) vehicleMakes.push(v.make);
          if (v && v.model) vehicleModels.push(v.model);
        });
        
        // Remove duplicates
        vehicleMakes = [...new Set(vehicleMakes)];
        vehicleModels = [...new Set(vehicleModels)];
      }

      // Handle image extraction safely. We index BOTH the full `images` array
      // (so list/search responses match the API contract the frontend cards
      // expect) and a denormalized `primaryImage` string (used by the
      // lightweight autocomplete/suggest endpoints).
      const images = ElasticsearchService.normalizeImages(product.images, product.name);
      const primaryImage = images.length > 0
        ? (images.find(img => img.isPrimary) || images[0]).url
        : null;

      // Prepare body for Elasticsearch
      const body = {
        name: product.name,
        slug: product.slug,
        description: product.description,
        shortDescription: product.shortDescription,
        categories: Array.isArray(product.categories) ? product.categories.map(c => 
          typeof c === 'object' ? { name: c.name, slug: c.slug } : c
        ) : [],
        brand: product.brand,
        price: product.price,
        originalPrice: product.originalPrice,
        stock: product.stock,
        sku: product.sku,
        isActive: product.isActive,
        isFeatured: product.isFeatured,
        isFastMoving: product.isFastMoving || false,
        averageRating: product.averageRating,
        totalReviews: product.totalReviews || 0,
        tags: product.tags,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        vehicle_makes: vehicleMakes,
        vehicle_models: vehicleModels,
        images,
        primaryImage: primaryImage
      };

      await this.client.index({
        index: this.indexName,
        id: product._id.toString(),
        document: body,
        ...(refresh ? { refresh } : {})
      });
    } catch (error) {
      console.error('Error indexing product:', error);
      // Don't throw error to prevent blocking main flow
    }
  }

  /**
   * Index all products from MongoDB
   */
  async indexAllProducts() {
    try {
      // Fetch all active products from MongoDB with necessary populations
      const products = await Product.find({ isActive: true })
        .populate('categories', 'name slug')
        .populate('compatibleVehicles', 'make model')
        .lean();

      // Index each product
      for (const product of products) {
        await this.indexProduct(product);
      }

      // Refresh the index
      await this.client.indices.refresh({ index: this.indexName });
      
      console.log(`Indexed ${products.length} products`);
      return products.length;
    } catch (error) {
      console.error('Error indexing all products:', error);
      throw error;
    }
  }

  /**
   * Delete a product from the index.
   * @param {string} productId
   * @param {{refresh?: boolean|'wait_for'}} [opts] - See indexProduct: the worker
   *   passes `refresh: 'wait_for'` so the removal is visible before the cache is
   *   busted.
   */
  async deleteProduct(productId, { refresh = false } = {}) {
    try {
      await this.client.delete({
        index: this.indexName,
        id: productId.toString(),
        ...(refresh ? { refresh } : {})
      });
    } catch (error) {
      // Ignore if product doesn't exist
      if (error.meta && error.meta.statusCode !== 404) {
        console.error('Error deleting product from index:', error);
        throw error;
      }
    }
  }

  /**
   * Sanitize a user-supplied search string before passing to Elasticsearch.
   *
   * multi_match treats input as literal text (not Query DSL), so full special-
   * character escaping is not required. However, two vectors still need closing:
   *
   * 1. Length — fuzziness: AUTO computes Levenshtein distances per token per shard.
   *    A 10 000-char input causes O(n²) work across every shard simultaneously.
   *    Cap at 200 chars, which comfortably covers real product search intent.
   *
   * 2. Control characters — null bytes and ASCII control chars (0x00-0x1F) can
   *    cause JSON parse errors inside the ES cluster and produce unpredictable
   *    query behaviour.
   */
  sanitizeQuery(input, maxLength = 200) {
    if (typeof input !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLength).trim();
  }

  /**
   * Search products with faceted filtering
   */
  async searchProducts(params) {
    const {
      q,
      page = 1,
      limit = 12,
      category,
      brand,
      vehicleType, // Mapping "Vehicle Type" request to vehicle make
      minPrice,
      maxPrice,
      inStock,
      rating,
      sortBy = 'createdAt',
      order = 'desc'
    } = params;

    try {
      // Build the search query
      const searchBody = {
        // CRITICAL: Timeout prevents long-running queries from killing cluster
        timeout: '2s',
        // CRITICAL: terminate_after limits documents evaluated per shard
        terminate_after: 10000,
        query: {
          function_score: {
            query: {
              bool: {
                must: [],
                filter: []
              }
            },
            functions: [
              // Boost fast moving products
              {
                filter: { term: { isFastMoving: true } },
                weight: 2
              },
              // Boost by popularity (total reviews)
              {
                field_value_factor: {
                  field: "totalReviews",
                  factor: 0.1,
                  modifier: "log1p",
                  missing: 0
                }
              },
              // Boost by rating
              {
                field_value_factor: {
                  field: "averageRating",
                  factor: 0.5,
                  missing: 0
                }
              }
            ],
            score_mode: "sum",
            // ADDITIVE, not multiplicative. With multiply, any product whose
            // popularity functions summed to 0 (no reviews + 0 rating — most of the
            // migrated catalog) had its text relevance multiplied to 0, flattening
            // ranking so the exact-name match never surfaced. `sum` keeps text
            // relevance (incl. the phrase boosts below) dominant and treats
            // rating/popularity as an additive nudge.
            boost_mode: "sum"
          }
        },
        aggs: {
          categories: {
            // Products are indexed under `categories` (plural) and filtered on
            // `categories.name.keyword`; the facet MUST use the same field or its
            // buckets come back empty (the old `category.name.keyword` never
            // existed on the document).
            terms: { field: 'categories.name.keyword' }
          },
          brands: {
            terms: { field: 'brand.keyword' }
          },
          vehicle_types: {
            terms: { field: 'vehicle_makes.keyword' }
          },
          price_ranges: {
            range: {
              field: 'price',
              ranges: [
                { to: 50 },
                { from: 50, to: 100 },
                { from: 100, to: 200 },
                { from: 200, to: 500 },
                { from: 500 }
              ]
            }
          },
          rating_ranges: {
            range: {
              field: 'averageRating',
              ranges: [
                { from: 4 },
                { from: 3, to: 4 },
                { from: 2, to: 3 },
                { from: 1, to: 2 },
                { to: 1 }
              ]
            }
          },
          availability: {
            terms: { field: 'isActive' }
          }
        },
        from: (page - 1) * limit,
        size: limit
      };

      // Add text search if query provided
      const safeQ = q ? this.sanitizeQuery(q) : null;
      if (safeQ) {
        // Precision-first matching that mirrors the MongoDB fallback path so the
        // two engines return the same intuitive result set. The set of RETURNED
        // docs is decided by a single required `bool` (minimum_should_match: 1
        // over the recall lanes); the outer `should` below only RANKS.
        //
        // The query is first reduced to CONTENT tokens — filler words ("for",
        // "with"…) are dropped — so "tailgate spoiler for hilux" is matched as
        // [tailgate, spoiler, hilux]. A product qualifies via ANY recall lane:
        //
        //  1. best_fields — a single high-signal field (name/brand/sku/tags/vehicle)
        //     contains MOST of the tokens. `minimum_should_match:'2<70%'` means
        //     ≤2 tokens → ALL required, >2 tokens → 70% required. This is what
        //     stops the OR-explosion into the whole catalog while tolerating one
        //     missing/typo'd word on longer queries. `prefix_length:2` keeps the
        //     first two chars exact so short fuzzy tokens ("led") don't match
        //     "red"/"bed"; `AUTO:5,8` keeps sub-5-char tokens exact ("thor"≠"thar").
        //  2. cross_fields — EVERY token is present somewhere across the combined
        //     high-signal fields (`operator:'and'`). Lets a query legitimately span
        //     fields, e.g. "spoiler"(name) + "hilux"(vehicle_models), while still
        //     requiring all tokens. (cross_fields can't fuzzy-match, hence lane 1.)
        //  3. CATEGORY-name recall — the product's category NAME matches the whole
        //     query. Makes a broad "brakes" return the Brakes category members.
        //
        // SYNONYMS (spoiler↔bumper, lights↔lamp…) are only expanded for a SINGLE
        // content token — i.e. a broad category-style search. For a specific
        // multi-word query they are the bug: "spoiler" pulled in every bumper and
        // returned 151 results. There, literal intent must win, so no expansion.
        //
        // `description` is DELIBERATELY excluded from every recall lane: long,
        // SEO-stuffed descriptions share common words across nearly the whole
        // catalog. It survives only as a `should` ranking boost.
        const tokens = contentTokens(safeQ);
        const cleanedQuery = tokens.length ? tokens.join(' ') : safeQ;
        const isSingleToken = tokens.length <= 1;

        const HIGH_SIGNAL = ['name^3', 'brand^2', 'sku^2', 'vehicle_models.text^3', 'vehicle_makes.text^2', 'tags^1.5'];

        const recall = [
          {
            multi_match: {
              query: cleanedQuery,
              fields: HIGH_SIGNAL,
              type: 'best_fields',
              operator: 'or',
              // ≤2 tokens → all required; >2 tokens → 70% (tolerates one miss/typo).
              minimum_should_match: '2<70%',
              fuzziness: 'AUTO:5,8',
              prefix_length: 2
            }
          },
          {
            multi_match: {
              query: cleanedQuery,
              fields: ['name^3', 'brand^2', 'sku^2', 'vehicle_models.text^2', 'vehicle_makes.text^2', 'tags'],
              type: 'cross_fields',
              operator: 'and'
            }
          },
          {
            match: {
              'categories.name': { query: cleanedQuery, operator: 'and', boost: 2.0 }
            }
          }
        ];

        // Broaden ONLY single-token, category-style queries with synonyms.
        if (isSingleToken) {
          const synonyms = expandSynonyms(cleanedQuery).slice(1); // drop the literal
          for (const s of synonyms) {
            recall.push({ match: { name: { query: s, operator: 'and' } } });
            recall.push({ match: { 'categories.name': { query: s, operator: 'and', boost: 1.5 } } });
          }
        }

        searchBody.query.function_score.query.bool.must.push({
          bool: { should: recall, minimum_should_match: 1 }
        });
        // Boost products whose vehicle_model matches the query term
        searchBody.query.function_score.functions.push({
          filter: { match: { 'vehicle_models.text': cleanedQuery } },
          weight: 2.0
        });
        // Ranking-only signals (do NOT widen the match set): an exact / near-exact
        // phrase match on the name is heavily boosted so the product literally
        // named like the query ranks first; description survives as a weak recall.
        searchBody.query.function_score.query.bool.should = [
          { match_phrase: { name: { query: cleanedQuery, slop: 2, boost: 10 } } },
          { match_phrase: { 'vehicle_models.text': { query: cleanedQuery, boost: 3 } } },
          { match_phrase_prefix: { name: { query: cleanedQuery, boost: 1.0 } } },
          { match: { description: { query: cleanedQuery, boost: 0.3 } } }
        ];
      } else {
        // Match all if no query
        searchBody.query.function_score.query.bool.must.push({ match_all: {} });
      }

      // Add filters
      if (category) {
        const categories = Array.isArray(category) ? category : category.split(',');
        searchBody.query.function_score.query.bool.filter.push({
          terms: { 'categories.name.keyword': categories }
        });
      }

      if (brand) {
        const brands = Array.isArray(brand) ? brand : brand.split(',');
        searchBody.query.function_score.query.bool.filter.push({
          terms: { 'brand.keyword': brands }
        });
      }

      if (vehicleType) {
        const types = Array.isArray(vehicleType) ? vehicleType : vehicleType.split(',');
        searchBody.query.function_score.query.bool.filter.push({
          terms: { 'vehicle_makes.keyword': types }
        });
      }

      if (minPrice || maxPrice) {
        const range = {};
        if (minPrice) range.gte = Number(minPrice);
        if (maxPrice) range.lte = Number(maxPrice);
        searchBody.query.function_score.query.bool.filter.push({
          range: { price: range }
        });
      }

      if (inStock === 'true') {
        // "In stock only" means actually on hand — excludes out AND backorder.
        searchBody.query.function_score.query.bool.filter.push({
          bool: { must_not: { terms: { stock: ['out', 'backorder'] } } }
        });
      }

      if (rating) {
        const ratings = Array.isArray(rating) ? rating : rating.split(',').map(Number);
        const validRatings = ratings.filter(r => !isNaN(r));
        if (validRatings.length > 0) {
          const maxRating = Math.max(...validRatings);
          searchBody.query.function_score.query.bool.filter.push({
            range: { averageRating: { gte: maxRating } }
          });
        }
      }

      // Add sorting
      const sortOptions = {};
      if (q && sortBy === 'createdAt') {
        // If searching and no specific sort requested, sort by relevance (score)
        sortOptions._score = { order: 'desc' };
      } else {
        // Otherwise use requested sort
        sortOptions[sortBy] = { order: order === 'asc' ? 'asc' : 'desc' };
      }
      
      searchBody.sort = [sortOptions];

      // Execute search
      const result = await this.client.search({
        index: this.indexName,
        body: searchBody
      });

      // Process results. Guarantee every product carries an `images` array so
      // the response matches the API/UI contract regardless of when the doc was
      // indexed. Older docs predate the `images` field and only have the
      // denormalized `primaryImage`, so fall back to that — this keeps product
      // cards rendering correctly before a full reindex has run.
      const products = result.hits.hits.map(hit => {
        const source = hit._source;
        const images = Array.isArray(source.images) && source.images.length > 0
          ? source.images
          : ElasticsearchService.normalizeImages(source.primaryImage, source.name);
        return {
          ...source,
          images,
          _id: hit._id,
          _score: hit._score
        };
      });

      // Process aggregations for facets
      const facets = {
        categories: result.aggregations.categories.buckets.map(bucket => ({
          name: bucket.key,
          count: bucket.doc_count
        })),
        brands: result.aggregations.brands.buckets.map(bucket => ({
          name: bucket.key,
          count: bucket.doc_count
        })),
        vehicleTypes: result.aggregations.vehicle_types.buckets.map(bucket => ({
          name: bucket.key,
          count: bucket.doc_count
        })),
        priceRanges: result.aggregations.price_ranges.buckets.map(bucket => ({
          from: bucket.from,
          to: bucket.to,
          count: bucket.doc_count
        })),
        ratingRanges: result.aggregations.rating_ranges.buckets.map(bucket => ({
          from: bucket.from,
          to: bucket.to,
          count: bucket.doc_count
        })),
        availability: result.aggregations.availability.buckets.map(bucket => ({
          name: bucket.key,
          count: bucket.doc_count
        }))
      };

      return {
        products,
        pagination: {
          total: result.hits.total.value,
          pages: Math.ceil(result.hits.total.value / limit),
          currentPage: Number(page),
          hasNext: Number(page) < Math.ceil(result.hits.total.value / limit),
          hasPrev: Number(page) > 1
        },
        facets
      };
    } catch (error) {
      console.error('Error searching products:', error);
      throw error;
    }
  }

  /**
   * Get search suggestions
   */
  async getSearchSuggestions(query, limit = 10) {
    const safeQuery = this.sanitizeQuery(query);
    if (!safeQuery) return { suggestions: [], corrections: [] };

    try {
      // First, get product and brand suggestions (include vehicle fields for model-based queries)
      const productBrandResult = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            multi_match: {
              query: safeQuery,
              fields: [
                'name^3',
                'brand^2',
                'vehicle_models.text^3',
                'vehicle_makes.text^2',
                'tags^1.5'
              ],
              // Match the results query (AUTO:5,8): short brand/model tokens are
              // exact so autocomplete for "thor" doesn't surface Thar products.
              fuzziness: 'AUTO:5,8',
              operator: 'and'
            }
          },
          _source: ['name', 'brand', 'slug', 'categories', 'primaryImage'],
          size: limit * 2
        }
      });

      // Then, get category suggestions
      const categoryResult = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            multi_match: {
              query: safeQuery,
              fields: ['categories.name^3'], // Higher boost for categories
              fuzziness: 'AUTO:5,8',
              operator: 'and'
            }
          },
          _source: ['categories.name'],
          size: limit
        }
      });

      // Get spelling corrections
      const correctionResult = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            multi_match: {
              query: safeQuery,
              fields: ['name', 'brand', 'categories.name'],
              fuzziness: 'AUTO:4,7', // More aggressive fuzziness for corrections
              operator: 'or'
            }
          },
          suggest: {
            text: safeQuery,
            name_suggest: {
              phrase: {
                field: "name",
                size: 1,
                gram_size: 2,
                direct_generator: [{
                  field: "name",
                  suggest_mode: "always"
                }],
                highlight: {
                  pre_tag: "<em>",
                  post_tag: "</em>"
                }
              }
            },
            brand_suggest: {
              phrase: {
                field: "brand",
                size: 1,
                gram_size: 2,
                direct_generator: [{
                  field: "brand",
                  suggest_mode: "always"
                }],
                highlight: {
                  pre_tag: "<em>",
                  post_tag: "</em>"
                }
              }
            }
          },
          _source: ['name', 'brand'],
          size: 0 // We only need suggestions, not actual documents
        }
      });

      // Extract unique suggestions
      const suggestions = [];
      const seenNames = new Set();
      const seenBrands = new Set();
      const seenCategories = new Set();

      // Process product and brand suggestions
      productBrandResult.hits.hits.forEach(hit => {
        const source = hit._source;
        
        // Add product name suggestion
        if (source.name && !seenNames.has(source.name.toLowerCase())) {
          seenNames.add(source.name.toLowerCase());
          
          const categoryName = source.categories && source.categories.length > 0 
            ? source.categories[0].name 
            : null;

          suggestions.push({
            id: `product-${hit._id}`,
            slug: source.slug || undefined,
            text: source.name,
            type: 'product',
            category: categoryName,
            imageUrl: source.primaryImage || null,
            value: source.slug || hit._id
          });
        }

        // Add brand suggestion
        if (source.brand && !seenBrands.has(source.brand.toLowerCase())) {
          seenBrands.add(source.brand.toLowerCase());
          suggestions.push({
            id: `brand-${source.brand.toLowerCase().replace(/\s+/g, '-')}`,
            text: source.brand,
            type: 'brand',
            value: source.brand
          });
        }
      });

      // Process category suggestions
      categoryResult.hits.hits.forEach(hit => {
        const source = hit._source;
        
        if (source.categories && Array.isArray(source.categories)) {
          source.categories.forEach(cat => {
            if (cat.name && !seenCategories.has(cat.name.toLowerCase()) && cat.name.toLowerCase().includes(safeQuery.toLowerCase())) {
              seenCategories.add(cat.name.toLowerCase());
              suggestions.push({
                id: `category-${cat.name.toLowerCase().replace(/\s+/g, '-')}`,
                text: cat.name,
                type: 'category',
                value: cat.name
              });
            }
          });
        }
      });

      // Extract spelling corrections. The name and brand phrase-suggesters often
      // emit the SAME token (e.g. "profender"), so dedupe by the suggested text
      // (case-insensitive), keeping the highest-confidence occurrence, and drop
      // any suggestion that just echoes the query. A Map preserves first-seen
      // order while letting a later, higher-scoring duplicate win.
      const correctionMap = new Map();
      const collectCorrections = (options = []) => {
        for (const option of options) {
          if (!option.text) continue;
          const key = option.text.toLowerCase();
          if (key === safeQuery.toLowerCase()) continue; // echoes the query
          const existing = correctionMap.get(key);
          if (!existing || option.score > existing.confidence) {
            correctionMap.set(key, {
              original: query,
              suggested: option.text,
              confidence: option.score,
            });
          }
        }
      };
      if (correctionResult.suggest) {
        collectCorrections(correctionResult.suggest.name_suggest?.[0]?.options);
        collectCorrections(correctionResult.suggest.brand_suggest?.[0]?.options);
      }
      const corrections = Array.from(correctionMap.values())
        .sort((a, b) => b.confidence - a.confidence);

      // Limit to requested number of suggestions
      return {
        suggestions: suggestions.slice(0, limit),
        corrections: corrections.slice(0, 3),
        total: productBrandResult.hits.total?.value ?? 0
      };
    } catch (error) {
      console.error('Error getting search suggestions:', error);
      throw error;
    }
  }

  /**
   * Log search analytics
   */
  async logSearchQuery(query, userId = null) {
    try {
      const analyticsIndex = 'search_analytics';
      
      // Create analytics index if it doesn't exist
      const exists = await this.client.indices.exists({ index: analyticsIndex });
      if (!exists) {
        await this.client.indices.create({
          index: analyticsIndex,
          body: {
            mappings: {
              properties: {
                query: { type: 'text' },
                timestamp: { type: 'date' },
                userId: { type: 'keyword' },
                resultsCount: { type: 'integer' }
              }
            }
          }
        });
      }

      // Log the search query
      await this.client.index({
        index: analyticsIndex,
        body: {
          query: query || '',
          timestamp: new Date(),
          userId: userId || 'anonymous',
          resultsCount: 0 // Will be updated after search
        }
      });
    } catch (error) {
      console.error('Error logging search query:', error);
    }
  }

  /**
   * Get search analytics
   */
  async getSearchAnalytics(startDate, endDate) {
    try {
      const analyticsIndex = 'search_analytics';
      
      const result = await this.client.search({
        index: analyticsIndex,
        body: {
          query: {
            range: {
              timestamp: {
                gte: startDate,
                lte: endDate
              }
            }
          },
          aggs: {
            popular_terms: {
              terms: {
                field: 'query.keyword',
                size: 20
              }
            },
            searches_over_time: {
              date_histogram: {
                field: 'timestamp',
                calendar_interval: 'day'
              }
            }
          },
          size: 0
        }
      });

      return {
        popularTerms: result.aggregations.popular_terms.buckets.map(bucket => ({
          term: bucket.key,
          count: bucket.doc_count
        })),
        searchesOverTime: result.aggregations.searches_over_time.buckets.map(bucket => ({
          date: bucket.key_as_string,
          count: bucket.doc_count
        }))
      };
    } catch (error) {
      console.error('Error getting search analytics:', error);
      throw error;
    }
  }
}

export default new ElasticsearchService();