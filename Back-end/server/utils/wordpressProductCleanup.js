import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import { sanitizeProductDescriptions } from './htmlSanitizer.js';
import { categorizeProducts } from './productCategorizer.js';

// Load environment variables
dotenv.config();

/**
 * Clean up WordPress imported products by removing HTML tags and categorizing them
 * @param {number} batchSize - Number of products to process in each batch
 * @returns {Object} Cleanup summary
 */
async function cleanupWordPressProducts(batchSize = 50) {
  try {
    console.log('Starting WordPress product cleanup...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Find products that need cleanup (likely have HTML in descriptions)
    // We'll look for products with HTML tags in their descriptions
    const productsNeedingCleanup = await Product.find({
      description: { $regex: /<[^>]*>/ }
    }).limit(1000); // Limit to prevent memory issues
    
    console.log(`Found ${productsNeedingCleanup.length} products needing cleanup`);
    
    if (productsNeedingCleanup.length === 0) {
      console.log('No products need cleanup');
      await mongoose.connection.close();
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
        }
        
        console.log(`Batch ${Math.floor(i/batchSize) + 1} completed. Updated ${bulkOps.length} products.`);
        
        // Add a small delay to prevent overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error processing batch ${Math.floor(i/batchSize) + 1}:`, error.message);
        errorCount += batch.length;
      }
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
    
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
    console.error('Error during WordPress product cleanup:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    return { success: false, error: error.message };
  }
}

/**
 * CLI entry point
 */
if (require.main === module) {
  const batchSize = process.argv[2] ? parseInt(process.argv[2]) : 50;
  cleanupWordPressProducts(batchSize)
    .then(result => {
      console.log('Cleanup completed:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

export { cleanupWordPressProducts };
export default { cleanupWordPressProducts };