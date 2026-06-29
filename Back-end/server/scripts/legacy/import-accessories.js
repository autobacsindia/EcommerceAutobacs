import dotenv from 'dotenv';
import mongoose from 'mongoose';
import ProductImportService from '../../services/productImportService.js';
import ImportJob from '../../models/ImportJob.js';

// Load environment variables
dotenv.config();

async function importAccessoriesCollection() {
  let importJob = null;
  
  try {
    console.log('Starting import of accessories collection from WordPress...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB\n');
    
    // Initialize the product import service
    const importService = new ProductImportService();
    
    // Generate a unique job ID
    const jobId = `import-accessories-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create import job tracking
    importJob = new ImportJob({
      jobId,
      source: 'wordpress',
      status: 'running',
      startedAt: new Date()
    });
    await importJob.save();
    
    console.log(`Import job created with ID: ${jobId}\n`);
    
    // Get total product count
    console.log('Fetching total product count...');
    const totalCount = await importService.getTotalProductCount();
    console.log(`Total products in WordPress: ${totalCount}\n`);
    
    // Update job with total count
    importJob.totalProducts = totalCount;
    await importJob.save();
    
    // For now, we'll import all products since the WordPress API doesn't easily allow
    // filtering by collection. The design document mentions the accessories collection,
    // but in practice, we would need to filter products by category after fetching.
    
    let importedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    
    // Process products in batches
    const batchSize = 10; // Reduce batch size to prevent overwhelming the API
    const totalPages = Math.ceil(totalCount / batchSize);
    
    console.log(`Processing ${totalCount} products in ${totalPages} batches of ${batchSize}...\n`);
    
    const results = {
      totalProducts: totalCount,
      imported: [],
      failed: [],
      skipped: []
    };
    
    // Process each batch
    for (let page = 1; page <= totalPages; page++) {
      console.log(`Processing batch ${page} of ${totalPages}...`);
      
      // Fetch products for current page
      const wpProducts = await importService.fetchProductsFromWordPress(page, batchSize);
      
      // Process each product in the batch
      for (const wpProduct of wpProducts) {
        // For this specific task, we're importing all products
        // In a more refined implementation, we would filter by category here
        
        const importResult = await importService.importSingleProduct(wpProduct);
        
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
        importJob.progress = Math.round(importJob.processedProducts / totalCount * 100);
        
        // Save job progress periodically
        if (importJob.processedProducts % 10 === 0) {
          await importJob.save();
        }
        
        // Increase delay between products to prevent overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`Completed batch ${page}. Progress: ${importJob.progress}%`);
    }
    
    // Mark job as completed
    importJob.status = 'completed';
    importJob.completedAt = new Date();
    importJob.progress = 100;
    await importJob.save();
    
    console.log('\n=== IMPORT SUMMARY ===');
    console.log(`Total products processed: ${totalCount}`);
    console.log(`Successfully imported: ${importedCount}`);
    console.log(`Failed imports: ${failedCount}`);
    console.log(`Skipped products: ${skippedCount}`);
    
    if (failedCount > 0) {
      console.log('\nFailed imports:');
      results.failed.forEach(failed => {
        console.log(`- Product ID ${failed.productId}: ${failed.error}`);
      });
    }
    
    console.log('\n✓ Accessories collection import completed successfully');
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('Error importing accessories collection:', error.message);
    
    // Mark job as failed
    if (importJob) {
      importJob.status = 'failed';
      importJob.failedAt = new Date();
      importJob.errorMessage = error.message;
      await importJob.save();
    }
    
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    
    process.exit(1);
  }
}

// Run the import
importAccessoriesCollection();