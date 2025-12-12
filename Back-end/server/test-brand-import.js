import dotenv from 'dotenv';
import BrandProductImportService from './services/brandProductImportService.js';

// Load environment variables
dotenv.config();

async function testBrandImport() {
  try {
    console.log('Testing Profender brand product import...');
    
    const importService = new BrandProductImportService();
    
    // Generate a unique job ID
    const jobId = `test-import-brand-Profender-${Date.now()}`;
    
    // Start import process for Profender brand
    console.log('Starting import for Profender brand...');
    const importResult = await importService.importBrandProducts(jobId, 'Profender', null, (progress) => {
      console.log(`Import progress for Profender: ${progress.progress}% (${progress.imported}/${progress.totalProducts})`);
    });
    
    if (importResult.success) {
      console.log('✅ Profender products imported successfully!');
      console.log(`Summary: ${JSON.stringify(importResult.summary, null, 2)}`);
    } else {
      console.error('❌ Failed to import Profender products:', importResult.error);
    }
    
    return importResult;
  } catch (error) {
    console.error('❌ Error importing Profender products:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
}

// Run the test
testBrandImport();