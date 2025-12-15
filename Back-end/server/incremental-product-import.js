import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from './models/Product.js';
import Category from './models/Category.js';
import fs from 'fs';
import path from 'path';
import categoryMappingService from './services/categoryMappingService.js';
import importMonitoringService from './services/importMonitoringService.js';

// Load environment variables
dotenv.config();

// Import configuration
const CONFIG = {
  batchSize: parseInt(process.env.IMPORT_BATCH_SIZE) || 50,
  delayBetweenBatches: parseInt(process.env.IMPORT_DELAY_BETWEEN_BATCHES) || 1000,
  retryLimit: 3,
  retryDelay: 1000
};

// Import metadata file path
const METADATA_FILE = path.join(process.cwd(), 'import-metadata.json');

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

// Load import metadata
function loadMetadata() {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const data = fs.readFileSync(METADATA_FILE, 'utf8');
      return JSON.parse(data);
    }
    return { lastImportTimestamp: null, totalImports: 0, totalProductsImported: 0 };
  } catch (error) {
    console.warn('⚠️  Could not load metadata, starting fresh:', error.message);
    return { lastImportTimestamp: null, totalImports: 0, totalProductsImported: 0 };
  }
}

// Save import metadata
function saveMetadata(metadata) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
    console.log('💾 Import metadata saved');
  } catch (error) {
    console.error('❌ Failed to save metadata:', error.message);
  }
}

// Get products from WordPress API
async function fetchWordPressProducts(sinceDate = null, page = 1) {
  try {
    console.log(`🔄 Fetching products from WordPress (page ${page})...`);
    
    const params = {
      per_page: CONFIG.batchSize,
      page: page,
      status: 'publish'
    };
    
    // Add date filter if provided
    if (sinceDate) {
      params.modified_after = sinceDate.toISOString();
      console.log(`📅 Filtering products modified after: ${sinceDate.toISOString()}`);
    }
    
    const response = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
      auth: {
        username: process.env.WORDPRESS_API_KEY,
        password: process.env.WORDPRESS_API_SECRET
      },
      params: params,
      timeout: 30000
    });
    
    const totalPages = parseInt(response.headers['x-wp-totalpages']) || 1;
    const totalProducts = parseInt(response.headers['x-wp-total']) || response.data.length;
    
    console.log(`📊 Retrieved ${response.data.length} products (page ${page} of ${totalPages})`);
    
    return {
      products: response.data,
      totalPages: totalPages,
      totalProducts: totalProducts,
      currentPage: page
    };
  } catch (error) {
    console.error('❌ Error fetching products from WordPress:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// Transform WordPress product to our product model
async function transformProduct(wpProduct, categoryMap) {
  try {
    // Handle categories - automatically create missing categories
    let categoryId = null;
    
    if (wpProduct.categories && wpProduct.categories.length > 0) {
      // Try to match the first category
      const primaryCategory = wpProduct.categories[0];
      let matchedCategory = categoryMap.findCategory(primaryCategory.name);
      
      if (matchedCategory) {
        categoryId = matchedCategory._id;
        console.log(`   📂 Assigned to existing category: ${matchedCategory.name}`);
      } else {
        console.log(`   ⚠️  Category "${primaryCategory.name}" not found, creating it...`);
        // Create the missing category
        const newCategory = await categoryMap.createCategory(primaryCategory.name);
        categoryId = newCategory._id;
        console.log(`   ➕ Created and assigned to new category: ${newCategory.name}`);
      }
      
      // For debugging, let's also create all categories in the product
      for (const category of wpProduct.categories) {
        const existingCategory = categoryMap.findCategory(category.name);
        if (!existingCategory) {
          console.log(`   ➕ Auto-creating missing category: ${category.name}`);
          await categoryMap.createCategory(category.name);
        }
      }
    } else {
      // No categories in WordPress product, use default "Other" category
      const otherCategory = categoryMap.findCategory('Other');
      if (otherCategory) {
        categoryId = otherCategory._id;
        console.log(`   📂 Assigned to default category: ${otherCategory.name}`);
      } else {
        // If no "Other" category, try to find any available category
        const categories = await Category.find({}).limit(1);
        if (categories.length > 0) {
          categoryId = categories[0]._id;
          console.log(`   📂 Assigned to fallback category: ${categories[0].name}`);
        } else {
          console.error(`   ❌ No categories available in database!`);
          throw new Error('No categories available in database');
        }
      }
    }
    
    // Extract brand information
    let brand = 'Unknown';
    if (wpProduct.attributes) {
      const brandAttribute = wpProduct.attributes.find(attr => 
        attr.name.toLowerCase() === 'brand' || attr.name.toLowerCase() === 'brands'
      );
      
      if (brandAttribute && brandAttribute.options && brandAttribute.options.length > 0) {
        brand = Array.isArray(brandAttribute.options) 
          ? brandAttribute.options[0] 
          : brandAttribute.options;
      }
    }
    
    // Transform images - convert from WordPress format to our format
    let images = [];
    if (wpProduct.images && Array.isArray(wpProduct.images)) {
      images = wpProduct.images.map((img, index) => ({
        url: img.src || img.url || '',
        alt: img.alt || img.name || wpProduct.name || '',
        isPrimary: index === 0
      })).filter(img => img.url); // Filter out images without URLs
    }
    
    // Transform product data
    const productData = {
      name: wpProduct.name || 'Untitled Product',
      description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '').trim() : '',
      shortDescription: wpProduct.short_description 
        ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) 
        : (wpProduct.name ? wpProduct.name.substring(0, 200) : ''),
      price: parseFloat(wpProduct.price || wpProduct.regular_price) || 0,
      originalPrice: parseFloat(wpProduct.sale_price) || null,
      sku: wpProduct.sku || `WP-${wpProduct.id}`,
      stock: parseInt(wpProduct.stock_quantity) || 0,
      brand: brand,
      category: categoryId,
      images: images,
      isActive: wpProduct.status === 'publish',
      isFeatured: wpProduct.featured || false,
      externalId: wpProduct.id.toString(),
      externalUrl: wpProduct.permalink,
      tags: wpProduct.tags ? wpProduct.tags.map(tag => tag.name) : [],
      specifications: wpProduct.attributes ? wpProduct.attributes.map(attr => ({
        name: attr.name,
        value: Array.isArray(attr.options) ? attr.options.join(', ') : attr.options
      })) : []
    };
    
    return productData;
  } catch (error) {
    console.error('❌ Error transforming product:', error.message);
    throw error;
  }
}

// Save or update product in database
async function saveProduct(productData) {
  try {
    // Check if product already exists
    let product = await Product.findOne({ externalId: productData.externalId });
    
    if (product) {
      // Update existing product
      Object.assign(product, productData);
      await product.save();
      console.log(`   🔄 Updated existing product: ${product.name}`);
      return { action: 'updated', product: product };
    } else {
      // Create new product
      product = new Product(productData);
      await product.save();
      console.log(`   ➕ Created new product: ${product.name}`);
      return { action: 'created', product: product };
    }
  } catch (error) {
    console.error('❌ Error saving product:', error.message);
    throw error;
  }
}

// Process a batch of products
async function processBatch(products, categoryMap) {
  let results = { created: 0, updated: 0, failed: 0 };
  
  for (const wpProduct of products) {
    try {
      console.log(`\n📦 Processing: ${wpProduct.name || 'Untitled Product'} (ID: ${wpProduct.id})`);
      
      // Transform product
      const productData = await transformProduct(wpProduct, categoryMap);
      
      // Save product
      const result = await saveProduct(productData);
      
      if (result.action === 'created') {
        results.created++;
      } else if (result.action === 'updated') {
        results.updated++;
      }
    } catch (error) {
      console.error(`   ❌ Failed to process product ${wpProduct.id}:`, error.message);
      results.failed++;
    }
  }
  
  return results;
}

// Delay function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main import function
async function incrementalImport() {
  let metadata = loadMetadata();
  const startTime = new Date();
  const importId = `import-${startTime.getTime()}`;
  
  console.log('🚀 Starting incremental product import...');
  console.log(`📊 Last import timestamp: ${metadata.lastImportTimestamp || 'Never'}`);
  
  // Start monitoring
  importMonitoringService.startImport(importId, {
    batchSize: CONFIG.batchSize,
    delayBetweenBatches: CONFIG.delayBetweenBatches
  });
  
  try {
    // Connect to database
    await connectToDatabase();
    
    // Initialize category mapping service
    console.log('📂 Initializing category mapping service...');
    await categoryMappingService.initialize();
    const categoryStats = categoryMappingService.getStatistics();
    console.log(`📊 Loaded ${categoryStats.totalCategories} categories`);
    
    // Determine import date filter
    let sinceDate = null;
    if (metadata.lastImportTimestamp) {
      sinceDate = new Date(metadata.lastImportTimestamp);
      console.log(`🕒 Importing products modified since: ${sinceDate.toISOString()}`);
    } else {
      console.log('🆕 Performing full import (no previous import timestamp)');
    }
    
    // Fetch products
    let page = 1;
    let hasNextPage = true;
    let totalResults = { created: 0, updated: 0, failed: 0 };
    
    while (hasNextPage) {
      try {
        const { products, totalPages, currentPage } = await fetchWordPressProducts(sinceDate, page);
        
        if (products.length === 0) {
          console.log('🏁 No more products to import');
          break;
        }
        
        // Process batch
        console.log(`\n⚙️  Processing batch ${currentPage} of ${totalPages}...`);
        const batchResults = await processBatch(products, categoryMappingService);
        
        // Record progress
        importMonitoringService.recordProgress({
          processed: products.length,
          created: batchResults.created,
          updated: batchResults.updated,
          failures: batchResults.failed
        });
        
        // Update totals
        totalResults.created += batchResults.created;
        totalResults.updated += batchResults.updated;
        totalResults.failed += batchResults.failed;
        
        // Move to next page
        page++;
        hasNextPage = page <= totalPages;
        
        // Delay between batches
        if (hasNextPage) {
          console.log(`⏳ Waiting ${CONFIG.delayBetweenBatches}ms before next batch...`);
          await delay(CONFIG.delayBetweenBatches);
        }
      } catch (error) {
        console.error(`❌ Error processing page ${page}:`, error.message);
        throw error;
      }
    }
    
    // Update metadata
    const endTime = new Date();
    metadata.lastImportTimestamp = endTime.toISOString();
    metadata.totalImports = (metadata.totalImports || 0) + 1;
    metadata.totalProductsImported = (metadata.totalProductsImported || 0) + 
                                    totalResults.created + totalResults.updated;
    
    saveMetadata(metadata);
    
    // Complete monitoring
    importMonitoringService.completeImport({
      success: true,
      created: totalResults.created,
      updated: totalResults.updated,
      failed: totalResults.failed,
      duration: endTime - startTime
    });
    
    // Save metrics
    importMonitoringService.saveMetrics();
    
    // Print summary
    console.log('\n✅ Import completed successfully!');
    console.log(`📈 Summary:`);
    console.log(`   ➕ Created: ${totalResults.created} products`);
    console.log(`   🔄 Updated: ${totalResults.updated} products`);
    console.log(`   ❌ Failed: ${totalResults.failed} products`);
    console.log(`   🕒 Duration: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    console.log(`   📅 Next import will check changes since: ${metadata.lastImportTimestamp}`);
    
  } catch (error) {
    console.error('💥 Import failed:', error.message);
    
    // Record error in monitoring
    importMonitoringService.recordError(error.message, {
      timestamp: new Date()
    });
    
    // Complete monitoring with failure
    importMonitoringService.completeImport({
      success: false,
      error: error.message
    });
    
    // Save metrics
    importMonitoringService.saveMetrics();
    
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the import
incrementalImport();