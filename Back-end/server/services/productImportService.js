import axios from 'axios';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import ImportJob from '../models/ImportJob.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';

class ProductImportService {
  constructor() {
    this.wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
    this.wordpressApiKey = process.env.WORDPRESS_API_KEY;
    this.wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    this.wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    this.importBatchSize = parseInt(process.env.IMPORT_BATCH_SIZE) || 50;
    this.delayBetweenBatches = parseInt(process.env.IMPORT_DELAY_BETWEEN_BATCHES) || 1000;
    
    // Validate required configuration
    if (!this.wordpressSiteUrl || !this.wordpressApiKey || !this.wordpressApiSecret) {
      throw new Error('Missing required WordPress API configuration');
    }
  }

  /**
   * Fetch products from WordPress REST API
   * @param {number} page - Page number
   * @param {number} perPage - Number of products per page
   * @returns {Array} Array of products from WordPress
   */
  async fetchProductsFromWordPress(page = 1, perPage = this.importBatchSize) {
    try {
      const url = `${this.wordpressSiteUrl}/wp-json/${this.wordpressApiVersion}/products`;
      
      const response = await axios.get(url, {
        auth: {
          username: this.wordpressApiKey,
          password: this.wordpressApiSecret
        },
        params: {
          page,
          per_page: perPage,
          status: 'publish' // Only import published products
        }
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch products from WordPress: ${error.message}`);
    }
  }

  /**
   * Get total number of products in WordPress
   * @returns {number} Total product count
   */
  async getTotalProductCount() {
    try {
      const url = `${this.wordpressSiteUrl}/wp-json/${this.wordpressApiVersion}/products`;
      
      const response = await axios.get(url, {
        auth: {
          username: this.wordpressApiKey,
          password: this.wordpressApiSecret
        },
        params: {
          per_page: 1
        }
      });
      
      // Get total count from headers
      const totalCount = response.headers['x-wp-total'] || response.data.length;
      return parseInt(totalCount);
    } catch (error) {
      throw new Error(`Failed to get product count from WordPress: ${error.message}`);
    }
  }

  /**
   * Transform WordPress product data to match our Product model
   * @param {Object} wpProduct - Product data from WordPress
   * @returns {Object} Transformed product data
   */
  transformProductData(wpProduct) {
    // Map basic fields
    const transformedProduct = {
      name: wpProduct.name,
      description: wpProduct.description,
      shortDescription: wpProduct.short_description || wpProduct.name,
      price: parseFloat(wpProduct.regular_price) || 0,
      originalPrice: wpProduct.sale_price && parseFloat(wpProduct.sale_price) > 0 
        ? parseFloat(wpProduct.regular_price) 
        : undefined,
      sku: wpProduct.sku || undefined,
      stock: parseInt(wpProduct.stock_quantity) || 0,
      brand: this.extractBrandFromProduct(wpProduct),
      isActive: wpProduct.status === 'publish',
      isFeatured: wpProduct.featured || false,
      tags: wpProduct.tags ? wpProduct.tags.map(tag => tag.name) : [],
      features: wpProduct.features || []
    };

    // Handle images
    if (wpProduct.images && Array.isArray(wpProduct.images)) {
      transformedProduct.images = wpProduct.images.map((img, index) => ({
        url: img.src,
        alt: img.alt || img.name || `Product image ${index + 1}`,
        isPrimary: index === 0
      }));
    }

    // Handle specifications/attributes
    if (wpProduct.attributes && Array.isArray(wpProduct.attributes)) {
      transformedProduct.specifications = wpProduct.attributes.map(attr => ({
        key: attr.name,
        value: Array.isArray(attr.options) ? attr.options.join(', ') : attr.options
      }));
    }

    return transformedProduct;
  }

  /**
   * Extract brand information from WordPress product
   * @param {Object} wpProduct - Product data from WordPress
   * @returns {string} Brand name
   */
  extractBrandFromProduct(wpProduct) {
    if (wpProduct.attributes && Array.isArray(wpProduct.attributes)) {
      const brandAttribute = wpProduct.attributes.find(attr => 
        attr.name.toLowerCase() === 'brand' || attr.name.toLowerCase() === 'manufacturer'
      );
      
      if (brandAttribute && brandAttribute.options && brandAttribute.options.length > 0) {
        return Array.isArray(brandAttribute.options) 
          ? brandAttribute.options[0] 
          : brandAttribute.options;
      }
    }
    
    // Fallback to product name parsing or return undefined
    return undefined;
  }

  /**
   * Find or create category based on WordPress category data
   * @param {Object} wpCategory - Category data from WordPress
   * @returns {ObjectId} Category ID
   */
  async findOrCreateCategory(wpCategory) {
    try {
      // Try to find existing category by name
      let category = await Category.findOne({ 
        name: wpCategory.name 
      });
      
      // If not found, create new category
      if (!category) {
        category = new Category({
          name: wpCategory.name,
          slug: wpCategory.slug,
          description: wpCategory.description || `Category for ${wpCategory.name}`
        });
        await category.save();
      }
      
      return category._id;
    } catch (error) {
      throw new Error(`Failed to find or create category: ${error.message}`);
    }
  }

  /**
   * Import a single product
   * @param {Object} wpProduct - Product data from WordPress
   * @returns {Object} Import result
   */
  async importSingleProduct(wpProduct) {
    try {
      // Transform WordPress product data to our format
      const productData = this.transformProductData(wpProduct);
      
      // Handle category mapping
      if (wpProduct.categories && wpProduct.categories.length > 0) {
        // Use the first category for now (can be enhanced to handle multiple categories)
        const categoryId = await this.findOrCreateCategory(wpProduct.categories[0]);
        productData.category = categoryId;
      }
      
      // Check if product already exists (by SKU)
      let existingProduct = null;
      if (productData.sku) {
        existingProduct = await Product.findOne({ sku: productData.sku });
      }
      
      let savedProduct;
      
      if (existingProduct) {
        // Update existing product
        savedProduct = await Product.findByIdAndUpdate(
          existingProduct._id,
          productData,
          { new: true, runValidators: true }
        );
      } else {
        // Create new product
        const product = new Product(productData);
        savedProduct = await product.save();
      }
      
      return {
        success: true,
        product: savedProduct,
        isNew: !existingProduct,
        productId: savedProduct._id
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        productId: wpProduct.id
      };
    }
  }

  /**
   * Import all products from WordPress
   * @param {String} jobId - ID of the import job for tracking
   * @param {ObjectId} initiatedBy - User ID who initiated the import
   * @param {Function} progressCallback - Callback function to report progress
   * @returns {Object} Import summary
   */
  async importAllProducts(jobId, initiatedBy, progressCallback = null) {
    let importJob = null;
    
    try {
      // Create or update import job tracking
      importJob = await ImportJob.findOne({ jobId });
      
      if (!importJob) {
        importJob = new ImportJob({
          jobId,
          initiatedBy,
          source: 'wordpress',
          status: 'running',
          startedAt: new Date()
        });
      } else {
        importJob.status = 'running';
        importJob.startedAt = new Date();
      }
      
      await importJob.save();
      
      const totalProducts = await this.getTotalProductCount();
      const totalPages = Math.ceil(totalProducts / this.importBatchSize);
      
      // Update job with total count
      importJob.totalProducts = totalProducts;
      await importJob.save();
      
      let importedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      
      const results = {
        totalProducts,
        imported: [],
        failed: [],
        skipped: []
      };
      
      // Process products in batches
      for (let page = 1; page <= totalPages; page++) {
        // Fetch products for current page
        const wpProducts = await this.fetchProductsFromWordPress(page, this.importBatchSize);
        
        // Process each product in the batch
        for (const wpProduct of wpProducts) {
          const importResult = await this.importSingleProduct(wpProduct);
          
          if (importResult.success) {
            results.imported.push(importResult);
            importedCount++;
          } else {
            results.failed.push(importResult);
            failedCount++;
          }
          
          // Update job progress
          importJob.processedProducts = importedCount + failedCount + skippedCount;
          importJob.importedProducts = importedCount;
          importJob.failedProducts = failedCount;
          importJob.skippedProducts = skippedCount;
          importJob.progress = Math.round(importJob.processedProducts / totalProducts * 100);
          
          // Report progress if callback provided
          if (progressCallback) {
            progressCallback({
              progress: importJob.progress,
              imported: importedCount,
              failed: failedCount,
              skipped: skippedCount,
              currentPage: page,
              totalPages
            });
          }
          
          // Save job progress periodically
          if (importJob.processedProducts % 10 === 0) {
            await importJob.save();
          }
        }
        
        // Delay between batches to avoid overwhelming the API
        if (page < totalPages) {
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
        }
      }
      
      // Mark job as completed
      importJob.status = 'completed';
      importJob.completedAt = new Date();
      importJob.progress = 100;
      await importJob.save();
      
      return {
        success: true,
        jobId: importJob.jobId,
        summary: {
          totalProducts,
          imported: importedCount,
          failed: failedCount,
          skipped: skippedCount
        },
        details: results
      };
    } catch (error) {
      // Mark job as failed
      if (importJob) {
        importJob.status = 'failed';
        importJob.failedAt = new Date();
        importJob.errorMessage = error.message;
        await importJob.save();
      }
      
      return {
        success: false,
        jobId: importJob ? importJob.jobId : null,
        error: error.message
      };
    }
  }
}

export default ProductImportService;