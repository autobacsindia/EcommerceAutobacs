// Synchronize local product database with live site product count
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import ProductImportService from '../../services/productImportService.js';

// Load environment variables
dotenv.config();

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Main synchronization function
const synchronizeProducts = async () => {
  await connectDB();
  
  try {
    console.log('🔍 Starting product synchronization...');
    
    // Create product import service instance
    const importService = new ProductImportService();
    
    // Get total product count from live site
    console.log('🌐 Fetching product count from live site...');
    const liveSiteProductCount = await importService.getTotalProductCount();
    console.log(`📊 Live site product count: ${liveSiteProductCount}`);
    
    // Get current active product count in local database
    const localActiveProductCount = await Product.countDocuments({ isActive: true });
    console.log(`📁 Local active product count: ${localActiveProductCount}`);
    
    // If counts match, no action needed
    if (localActiveProductCount === liveSiteProductCount) {
      console.log('✅ Product counts already match. No synchronization needed.');
      mongoose.connection.close();
      return;
    }
    
    console.log('🔄 Synchronizing products...');
    
    // Fetch all products from live site
    const totalProducts = liveSiteProductCount;
    const batchSize = importService.importBatchSize;
    const totalPages = Math.ceil(totalProducts / batchSize);
    
    console.log(`📦 Fetching ${totalProducts} products from live site in ${totalPages} batches...`);
    
    // Create a set to store live site product SKUs
    const liveSiteProductSKUs = new Set();
    const liveSiteProductNames = new Set();
    
    // Process products in batches
    for (let page = 1; page <= totalPages; page++) {
      console.log(`📥 Fetching batch ${page}/${totalPages}...`);
      const wpProducts = await importService.fetchProductsFromWordPress(page, batchSize);
      
      // Add product identifiers to sets
      for (const wpProduct of wpProducts) {
        if (wpProduct.sku) {
          liveSiteProductSKUs.add(wpProduct.sku);
        }
        liveSiteProductNames.add(wpProduct.name.toLowerCase().trim());
      }
      
      console.log(`   Added ${wpProducts.length} products to live site index`);
    }
    
    console.log(`📋 Indexed ${liveSiteProductSKUs.size} unique SKUs and ${liveSiteProductNames.size} product names from live site`);
    
    // Get all active products from local database
    console.log('📂 Fetching all active products from local database...');
    const localActiveProducts = await Product.find({ isActive: true }).select('name sku');
    console.log(`📊 Found ${localActiveProducts.length} active products in local database`);
    
    // Identify products to deactivate
    console.log('🔍 Comparing products to identify mismatches...');
    const productsToDeactivate = [];
    
    for (const localProduct of localActiveProducts) {
      let shouldKeep = false;
      
      // Check by SKU first (more reliable)
      if (localProduct.sku && liveSiteProductSKUs.has(localProduct.sku)) {
        shouldKeep = true;
      }
      // Fallback to name matching
      else if (localProduct.name && liveSiteProductNames.has(localProduct.name.toLowerCase().trim())) {
        shouldKeep = true;
      }
      
      if (!shouldKeep) {
        productsToDeactivate.push(localProduct);
      }
    }
    
    console.log(`🚫 Found ${productsToDeactivate.length} products to deactivate`);
    
    // Preview products to be deactivated (first 10)
    console.log('\n📋 Preview of products to be deactivated:');
    productsToDeactivate.slice(0, 10).forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} | SKU: ${product.sku || 'None'}`);
    });
    
    if (productsToDeactivate.length > 10) {
      console.log(`   ... and ${productsToDeactivate.length - 10} more`);
    }
    
    // Ask for confirmation before proceeding
    console.log('\n⚠️  Ready to deactivate these products. This is a dry run.');
    console.log('   To actually deactivate products, remove the dryRun flag.');
    
    // Check if this is a dry run
    const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
    
    if (dryRun) {
      console.log('📝 DRY RUN MODE: No actual changes will be made');
      console.log(`📊 Would deactivate ${productsToDeactivate.length} products`);
      console.log(`📊 Local database would have ${localActiveProductCount - productsToDeactivate.length} active products after synchronization`);
    } else {
      console.log('⚡ EXECUTING SYNCHRONIZATION...');
      
      // Deactivate mismatched products
      let deactivatedCount = 0;
      for (const product of productsToDeactivate) {
        try {
          await Product.findByIdAndUpdate(product._id, {
            isActive: false,
            $push: { 
              notes: `[Deactivated] Not present on live site as of ${new Date().toISOString()}`
            }
          });
          deactivatedCount++;
          
          // Log progress every 50 products
          if (deactivatedCount % 50 === 0) {
            console.log(`   Deactivated ${deactivatedCount}/${productsToDeactivate.length} products...`);
          }
        } catch (error) {
          console.error(`   ❌ Error deactivating product ${product.name}:`, error.message);
        }
      }
      
      console.log(`✅ Successfully deactivated ${deactivatedCount} products`);
      
      // Final verification
      const finalActiveCount = await Product.countDocuments({ isActive: true });
      console.log(`📊 Final active product count: ${finalActiveCount}`);
      
      if (finalActiveCount === liveSiteProductCount) {
        console.log('🎉 SUCCESS: Product counts now match between local database and live site!');
      } else {
        console.log(`⚠️  NOTICE: Product counts don't exactly match (${finalActiveCount} local vs ${liveSiteProductCount} live)`);
        console.log('   This may be due to products without SKUs or name variations');
      }
    }
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('💥 Error during synchronization:', error);
    mongoose.connection.close();
    process.exit(1);
  }
};

// Run the synchronization
synchronizeProducts();