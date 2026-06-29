import dotenv from 'dotenv';
import mongoose from 'mongoose';
import BrandProductImportService from '../../services/brandProductImportService.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    console.log('Starting Profender brand product import...');
    
    const importService = new BrandProductImportService();
    
    // Generate a unique job ID
    const jobId = `import-brand-Profender-${Date.now()}`;
    
    // Start import process for Profender brand
    console.log('Importing products for Profender brand...');
    const importResult = await importService.importBrandProducts(jobId, 'Profender', null, (progress) => {
      console.log(`Import progress: ${progress.progress}% (${progress.imported}/${progress.totalProducts} products)`);
    });
    
    if (importResult.success) {
      console.log('✅ Profender products imported successfully!');
      console.log(`Summary: ${JSON.stringify(importResult.summary, null, 2)}`);
    } else {
      console.error('❌ Failed to import Profender products:', importResult.error);
    }
    
    // Close the database connection
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error importing Profender products:', error.message);
    console.error(error.stack);
    
    // Close the database connection
    mongoose.connection.close();
  }
});