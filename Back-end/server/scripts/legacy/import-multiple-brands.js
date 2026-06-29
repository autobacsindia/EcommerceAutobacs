import dotenv from 'dotenv';
import mongoose from 'mongoose';
import BrandProductImportService from '../../services/brandProductImportService.js';
import User from '../../models/User.js';
import Product from '../../models/Product.js';

dotenv.config();

async function importMultipleBrands(brandNames) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Create import service
    const importService = new BrandProductImportService();
    
    // Get or create admin user
    let adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      // Create a default admin user if none exists
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.default.hash('default_password', 10);
      
      adminUser = await User.create({
        name: 'System Admin',
        email: 'admin@autobacs.com',
        passwordHash: hashedPassword,
        role: 'admin'
      });
    }
    const userId = adminUser._id;
    
    // Import each brand
    for (const brandName of brandNames) {
      console.log(`\n--- Starting import for brand: ${brandName} ---`);
      
      try {
        // Clear existing products for this brand
        const deletedCount = await Product.deleteMany({ 
          brand: { $regex: new RegExp(brandName, 'i') } 
        });
        console.log(`Cleared ${deletedCount.deletedCount} existing ${brandName} products`);
        
        // Generate a unique job ID
        const jobId = `import-brand-${brandName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Start import process
        const importResult = await importService.importBrandProducts(jobId, brandName, userId, (progress) => {
          console.log(`Import progress for ${brandName}: ${progress.progress}%`);
        });
        
        if (importResult.success) {
          console.log(`✅ ${brandName} import completed successfully!`);
          console.log(`  Total products: ${importResult.summary.totalProducts}`);
          console.log(`  Imported: ${importResult.summary.imported}`);
          console.log(`  Failed: ${importResult.summary.failed}`);
          console.log(`  Skipped: ${importResult.summary.skipped}`);
        } else {
          console.log(`❌ ${brandName} import failed!`);
          console.log(`  Error: ${importResult.error}`);
        }
      } catch (error) {
        console.error(`❌ Error importing ${brandName}:`, error.message);
      }
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error importing multiple brands:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// List of brands to import
const brandsToImport = [
  'Profender',
  'Bushranger', 
  'Ironman 4x4',
  'Dr Nano',
  'Lightforce',
  'Option4WD'
];

// Execute the import
importMultipleBrands(brandsToImport).catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});