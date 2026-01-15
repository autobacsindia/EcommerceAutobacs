import axios from 'axios';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import ImportJob from '../models/ImportJob.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { removeHtmlTags, truncateString } from '../utils/productUtils.js';
import WooCommerceApiClient from './woocommerceApiClient.js';

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
    
    // Initialize WooCommerce API client
    this.apiClient = new WooCommerceApiClient();
  }

  /**
   * Fetch products from WordPress REST API
   * @param {number} page - Page number
   * @param {number} perPage - Number of products per page
   * @returns {Array} Array of products from WordPress
   */
  async fetchProductsFromWordPress(page = 1, perPage = this.importBatchSize) {
    try {
      return await this.apiClient.fetchProducts(page, perPage);
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
      return await this.apiClient.getProductCount();
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
      description: removeHtmlTags(wpProduct.description),
      shortDescription: truncateString(removeHtmlTags(wpProduct.short_description || wpProduct.name), 200),
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
      features: wpProduct.features || [],
      externalId: wpProduct.id.toString() // Store WooCommerce product ID
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
      // Try to find existing category by WooCommerce ID (stored in externalId)
      let category = await Category.findOne({ externalId: wpCategory.id });
      
      if (!category) {
        // Try to find existing category by name or slug
        category = await Category.findOne({ 
          $or: [
            { name: wpCategory.name },
            { slug: wpCategory.slug }
          ]
        });
      }
      
      // If not found, create new category
      if (!category) {
        // Ensure slug is unique by appending a counter if needed
        let slug = wpCategory.slug;
        let counter = 1;
        while (await Category.findOne({ slug: slug })) {
          slug = `${wpCategory.slug}-${counter}`;
          counter++;
        }
        
        category = new Category({
          name: wpCategory.name,
          slug: slug,
          description: wpCategory.description || `Category for ${wpCategory.name}`,
          externalId: wpCategory.id // Store WooCommerce ID for future reference
        });
        await category.save();
      } else {
        // Update existing category with latest data
        category.name = wpCategory.name;
        category.description = wpCategory.description || `Category for ${wpCategory.name}`;
        category.externalId = wpCategory.id;
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
      // Handle category mapping - support multiple categories
      if (wpProduct.categories && wpProduct.categories.length > 0) {
        const categoryIds = [];
        for (const wpCategory of wpProduct.categories) {
          const categoryId = await this.findOrCreateCategory(wpCategory);
          categoryIds.push(categoryId);
        }
        productData.categories = categoryIds;
      }
      
      // Check if product already exists (by external ID first, then SKU)
      let existingProduct = null;
      if (productData.externalId) {
        existingProduct = await Product.findOne({ externalId: productData.externalId });
      }
      
      // If not found by external ID, try SKU
      if (!existingProduct && productData.sku) {
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

  async findMissingWordPressProducts() {
    const totalProducts = await this.getTotalProductCount();
    const totalPages = Math.ceil(totalProducts / this.importBatchSize);
    const localProducts = await Product.find({}).select('externalId sku');
    const localExternalIds = new Set();
    const localSkus = new Set();
    for (const product of localProducts) {
      if (product.externalId) {
        localExternalIds.add(product.externalId.toString());
      }
      if (product.sku) {
        localSkus.add(product.sku);
      }
    }
    const missingProducts = [];
    for (let page = 1; page <= totalPages; page++) {
      const wpProducts = await this.fetchProductsFromWordPress(page, this.importBatchSize);
      for (const wpProduct of wpProducts) {
        const externalId = wpProduct.id ? wpProduct.id.toString() : null;
        const sku = wpProduct.sku || null;
        let exists = false;
        if (externalId && localExternalIds.has(externalId)) {
          exists = true;
        } else if (sku && localSkus.has(sku)) {
          exists = true;
        }
        if (!exists) {
          missingProducts.push({
            id: wpProduct.id,
            sku: wpProduct.sku,
            name: wpProduct.name,
            status: wpProduct.status,
            regular_price: wpProduct.regular_price,
            sale_price: wpProduct.sale_price
          });
        }
      }
    }
    return {
      totalWordPressProducts: totalProducts,
      totalLocalProducts: localProducts.length,
      missingCount: missingProducts.length,
      missingProducts
    };
  }

  async previewImport() {
    const totalProducts = await this.getTotalProductCount();
    const totalPages = Math.ceil(totalProducts / this.importBatchSize);
    const toCreate = [];
    const toUpdate = [];
    const failed = [];
    for (let page = 1; page <= totalPages; page++) {
      const wpProducts = await this.fetchProductsFromWordPress(page, this.importBatchSize);
      for (const wpProduct of wpProducts) {
        try {
          const productData = this.transformProductData(wpProduct);
          let existingProduct = null;
          if (productData.externalId) {
            existingProduct = await Product.findOne({ externalId: productData.externalId }).select('_id name sku');
          }
          if (!existingProduct && productData.sku) {
            existingProduct = await Product.findOne({ sku: productData.sku }).select('_id name sku');
          }
          if (existingProduct) {
            toUpdate.push({
              wpId: wpProduct.id,
              wpSku: wpProduct.sku,
              wpName: wpProduct.name,
              localProductId: existingProduct._id,
              localName: existingProduct.name,
              localSku: existingProduct.sku
            });
          } else {
            toCreate.push({
              wpId: wpProduct.id,
              sku: wpProduct.sku,
              name: wpProduct.name,
              status: wpProduct.status,
              regular_price: wpProduct.regular_price,
              sale_price: wpProduct.sale_price
            });
          }
        } catch (error) {
          failed.push({
            wpId: wpProduct.id,
            sku: wpProduct.sku,
            name: wpProduct.name,
            error: error.message
          });
        }
      }
    }
    return {
      totalWordPressProducts: totalProducts,
      toCreateCount: toCreate.length,
      toUpdateCount: toUpdate.length,
      failedCount: failed.length,
      toCreate,
      toUpdate,
      failed
    };
  }
}

export default ProductImportService;
