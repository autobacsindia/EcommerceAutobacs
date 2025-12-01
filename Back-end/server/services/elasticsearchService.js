import { Client } from '@elastic/elasticsearch';
import Product from '../models/Product.js';

class ElasticsearchService {
  constructor() {
    // Initialize Elasticsearch client
    this.client = new Client({
      node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
      auth: {
        username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
        password: process.env.ELASTICSEARCH_PASSWORD || 'changeme'
      }
    });
    
    this.indexName = 'products';
  }

  /**
   * Check if Elasticsearch is connected
   */
  async isConnected() {
    try {
      const info = await this.client.info();
      return info.statusCode === 200;
    } catch (error) {
      console.error('Elasticsearch connection error:', error);
      return false;
    }
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
                stock: { type: 'integer' },
                sku: { type: 'keyword' },
                isActive: { type: 'boolean' },
                isFeatured: { type: 'boolean' },
                averageRating: { type: 'float' },
                totalReviews: { type: 'integer' },
                tags: { type: 'keyword' },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' }
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
   * Index a single product
   */
  async indexProduct(product) {
    try {
      const body = {
        productId: product._id.toString(),
        name: product.name,
        description: product.description,
        shortDescription: product.shortDescription,
        category: product.category,
        brand: product.brand,
        price: product.price,
        originalPrice: product.originalPrice,
        stock: product.stock,
        sku: product.sku,
        isActive: product.isActive,
        isFeatured: product.isFeatured,
        averageRating: product.averageRating,
        totalReviews: product.totalReviews,
        tags: product.tags,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      };

      await this.client.index({
        index: this.indexName,
        id: product._id.toString(),
        body
      });
    } catch (error) {
      console.error('Error indexing product:', error);
      throw error;
    }
  }

  /**
   * Index all products from MongoDB
   */
  async indexAllProducts() {
    try {
      // Fetch all active products from MongoDB
      const products = await Product.find({ isActive: true })
        .populate('category', 'name slug')
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
   * Delete a product from the index
   */
  async deleteProduct(productId) {
    try {
      await this.client.delete({
        index: this.indexName,
        id: productId.toString()
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
   * Search products with faceted filtering
   */
  async searchProducts(params) {
    const {
      q,
      page = 1,
      limit = 12,
      category,
      brand,
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
        query: {
          bool: {
            must: [],
            filter: []
          }
        },
        aggs: {
          categories: {
            terms: { field: 'category.name.keyword' }
          },
          brands: {
            terms: { field: 'brand.keyword' }
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
      if (q) {
        searchBody.query.bool.must.push({
          multi_match: {
            query: q,
            fields: ['name^3', 'description', 'brand', 'tags'],
            fuzziness: 'AUTO'
          }
        });
      } else {
        // Match all if no query
        searchBody.query.bool.must.push({ match_all: {} });
      }

      // Add filters
      if (category) {
        const categories = Array.isArray(category) ? category : category.split(',');
        searchBody.query.bool.filter.push({
          terms: { 'category.name.keyword': categories }
        });
      }

      if (brand) {
        const brands = Array.isArray(brand) ? brand : brand.split(',');
        searchBody.query.bool.filter.push({
          terms: { 'brand.keyword': brands }
        });
      }

      if (minPrice || maxPrice) {
        const range = {};
        if (minPrice) range.gte = Number(minPrice);
        if (maxPrice) range.lte = Number(maxPrice);
        searchBody.query.bool.filter.push({
          range: { price: range }
        });
      }

      if (inStock === 'true') {
        searchBody.query.bool.filter.push({
          range: { stock: { gt: 0 } }
        });
      }

      if (rating) {
        const ratings = Array.isArray(rating) ? rating : rating.split(',').map(Number);
        const validRatings = ratings.filter(r => !isNaN(r));
        if (validRatings.length > 0) {
          const maxRating = Math.max(...validRatings);
          searchBody.query.bool.filter.push({
            range: { averageRating: { gte: maxRating } }
          });
        }
      }

      // Add sorting
      const sortOptions = {};
      if (q && sortBy === 'createdAt') {
        // If searching and no specific sort requested, sort by relevance
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

      // Process results
      const products = result.hits.hits.map(hit => ({
        ...hit._source,
        _id: hit._id,
        _score: hit._score
      }));

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
    try {
      // First, get product and brand suggestions
      const productBrandResult = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            multi_match: {
              query: query,
              fields: ['name^2', 'brand'],
              fuzziness: 'AUTO',
              operator: 'and'
            }
          },
          _source: ['name', 'brand', 'category.name'],
          size: limit * 2
        }
      });

      // Then, get category suggestions
      const categoryResult = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            multi_match: {
              query: query,
              fields: ['category.name^3'], // Higher boost for categories
              fuzziness: 'AUTO',
              operator: 'and'
            }
          },
          _source: ['category.name'],
          size: limit
        }
      });

      // Get spelling corrections
      const correctionResult = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            multi_match: {
              query: query,
              fields: ['name', 'brand', 'category.name'],
              fuzziness: 'AUTO:4,7', // More aggressive fuzziness for corrections
              operator: 'or'
            }
          },
          suggest: {
            text: query,
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
          suggestions.push({
            id: `product-${hit._id}`,
            text: source.name,
            type: 'product',
            category: source.category ? source.category.name : null
          });
        }

        // Add brand suggestion
        if (source.brand && !seenBrands.has(source.brand.toLowerCase())) {
          seenBrands.add(source.brand.toLowerCase());
          suggestions.push({
            id: `brand-${source.brand.toLowerCase().replace(/\s+/g, '-')}`,
            text: source.brand,
            type: 'brand'
          });
        }
      });

      // Process category suggestions
      categoryResult.hits.hits.forEach(hit => {
        const source = hit._source;
        
        if (source.category && source.category.name && !seenCategories.has(source.category.name.toLowerCase())) {
          seenCategories.add(source.category.name.toLowerCase());
          suggestions.push({
            id: `category-${source.category.name.toLowerCase().replace(/\s+/g, '-')}`,
            text: source.category.name,
            type: 'category'
          });
        }
      });

      // Extract spelling corrections
      const corrections = [];
      if (correctionResult.suggest) {
        // Process name suggestions
        if (correctionResult.suggest.name_suggest && correctionResult.suggest.name_suggest.length > 0) {
          correctionResult.suggest.name_suggest[0].options.forEach(option => {
            if (option.text && option.text.toLowerCase() !== query.toLowerCase()) {
              corrections.push({
                original: query,
                suggested: option.text,
                confidence: option.score
              });
            }
          });
        }
        
        // Process brand suggestions
        if (correctionResult.suggest.brand_suggest && correctionResult.suggest.brand_suggest.length > 0) {
          correctionResult.suggest.brand_suggest[0].options.forEach(option => {
            if (option.text && option.text.toLowerCase() !== query.toLowerCase()) {
              corrections.push({
                original: query,
                suggested: option.text,
                confidence: option.score
              });
            }
          });
        }
      }

      // Limit to requested number of suggestions
      return {
        suggestions: suggestions.slice(0, limit),
        corrections: corrections.slice(0, 3) // Limit corrections to 3
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