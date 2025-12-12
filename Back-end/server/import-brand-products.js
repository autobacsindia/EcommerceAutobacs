import dotenv from 'dotenv';
import mongoose from 'mongoose';
import BrandProductImportService from './services/brandProductImportService.js';

dotenv.config();

console.log('Brand product import script initialized...');

async function importBrandProducts(brandName) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Create import service
    const importService = new BrandProductImportService();
    
    // Generate a unique job ID
    const jobId = `import-brand-${brandName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // For command line usage, we don't have a user ID, so we'll use a placeholder
    const userId = 'cli-import-user';
    
    console.log(`Starting import for brand: ${brandName}`);
    
    // Start import process
    const importResult = await importService.importBrandProducts(jobId, brandName, userId, (progress) => {
      console.log(`Import progress for ${brandName}: ${progress.progress}%`);
    });
    
    if (importResult.success) {
      console.log('✅ Import completed successfully!');
      console.log(`Summary:`);
      console.log(`  Total products: ${importResult.summary.totalProducts}`);
      console.log(`  Imported: ${importResult.summary.imported}`);
      console.log(`  Failed: ${importResult.summary.failed}`);
      console.log(`  Skipped: ${importResult.summary.skipped}`);
      console.log(`  Job ID: ${importResult.jobId}`);
    } else {
      console.log('❌ Import failed!');
      console.log(`Error: ${importResult.error}`);
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error importing brand products:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Get brand name from command line arguments
const brandName = process.argv[2];

if (!brandName) {
  console.log('Usage: node import-brand-products.js <brand-name>');
  console.log('Example: node import-brand-products.js Profender');
  process.exit(1);
}

importBrandProducts(brandName);