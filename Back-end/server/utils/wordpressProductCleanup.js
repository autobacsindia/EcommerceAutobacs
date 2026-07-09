import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product, { enqueueProductSync } from '../models/Product.js';
import { sanitizeProductDescriptions } from './htmlSanitizer.js';
import { categorizeProducts } from './productCategorizer.js';

/**
 * Clean up WordPress imported products by removing HTML tags and categorizing them.
 *
 * IMPORTANT: this assumes an active Mongoose connection ALREADY exists and does
 * NOT open or close one. It runs both from the live server (admin route
 * POST /products/cleanup/wordpress, which shares the app's connection) and from
 * the CLI runner below. Managing the global connection here would tear down the
 * app's shared connection mid-request. For standalone use, call
 * runCleanupWordPressProductsCli(), which owns connection setup/teardown.
 *
 * @param {number} batchSize - Number of products to process in each batch
 * @returns {Object} Cleanup summary
 */
async function cleanupWordPressProducts(batchSize = 50) {
  try {
    console.log('Starting WordPress product cleanup...');

    // Find products that need cleanup (likely have HTML in descriptions)
    // We'll look for products with HTML tags in their descriptions
    const productsNeedingCleanup = await Product.find({
      description: { $regex: /<[^>]*>/ }
    }).limit(1000); // Limit to prevent memory issues
    
    console.log(`Found ${productsNeedingCleanup.length} products needing cleanup`);
    
    if (productsNeedingCleanup.length === 0) {
      console.log('No products need cleanup');
      return { success: true, message: 'No products need cleanup', processed: 0 };
    }
    
    // Process products in batches
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < productsNeedingCleanup.length; i += batchSize) {
      const batch = productsNeedingCleanup.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(productsNeedingCleanup.length/batchSize)}`);
      
      try {
        // Step 1: Sanitize HTML from descriptions
        const sanitizedProducts = sanitizeProductDescriptions(batch);
        
        // Step 2: Categorize products
        const categorizedProducts = await categorizeProducts(sanitizedProducts);
        
        // Step 3: Update products in database
        const bulkOps = categorizedProducts.map(product => ({
          updateOne: {
            filter: { _id: product._id },
            update: { 
              $set: { 
                description: product.description,
                ...(product.category ? { category: product.category } : {})
              }
            }
          }
        }));
        
        if (bulkOps.length > 0) {
          const result = await Product.bulkWrite(bulkOps);
          updatedCount += result.modifiedCount;
          processedCount += batch.length;

          // bulkWrite bypasses ALL Mongoose middleware (no save/updateMany hook
          // fires), so the schema's Elasticsearch-sync hooks never run for these
          // description/category edits. Re-index the affected products explicitly.
          // Every op filters by a known _id (the update never touches _id), so we
          // already hold the affected ids — no re-query needed. Enqueuing the full
          // batch (vs only result.modifiedCount) is safe: no-op edits re-index to
          // identical data and jobs dedup on productId.
          enqueueProductSync(bulkOps.map(op => op.updateOne.filter._id));
        }
        
        console.log(`Batch ${Math.floor(i/batchSize) + 1} completed. Updated ${bulkOps.length} products.`);
        
        // Add a small delay to prevent overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error processing batch ${Math.floor(i/batchSize) + 1}:`, error.message);
        errorCount += batch.length;
      }
    }
    
    const summary = {
      success: true,
      processed: processedCount,
      updated: updatedCount,
      errors: errorCount,
      message: `Processed ${processedCount} products, updated ${updatedCount}, errors: ${errorCount}`
    };
    
    console.log(summary.message);
    return summary;
  } catch (error) {
    console.error('Error during WordPress product cleanup:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Standalone CLI runner: owns the Mongoose connection lifecycle
 * (connect → cleanup → close). NEVER call this from the running server — the
 * close() step would drop the app's shared connection. The live server uses
 * cleanupWordPressProducts() directly, reusing the app's existing connection.
 *
 * @param {number} batchSize
 * @returns {Object} Cleanup summary
 */
async function runCleanupWordPressProductsCli(batchSize = 50) {
  dotenv.config();
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    console.log('✓ Connected to MongoDB');
    return await cleanupWordPressProducts(batchSize);
  } finally {
    // cleanupWordPressProducts never throws (it returns {success:false}), so a
    // connection opened above is always closed here — even on connect failure,
    // where readyState !== 1 makes this a safe no-op.
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('✓ Disconnected from MongoDB');
    }
  }
}

// CLI entry point - check if this file is being run directly
if (process.argv[1] && process.argv[1].endsWith('wordpressProductCleanup.js')) {
  const batchSize = process.argv[2] ? parseInt(process.argv[2]) : 50;
  runCleanupWordPressProductsCli(batchSize)
    .then(result => {
      console.log('Cleanup completed:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

export { cleanupWordPressProducts, runCleanupWordPressProductsCli };
export default { cleanupWordPressProducts, runCleanupWordPressProductsCli };