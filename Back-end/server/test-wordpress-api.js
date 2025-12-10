import dotenv from 'dotenv';
import ProductImportService from './services/productImportService.js';

// Load environment variables
dotenv.config();

async function testWordPressAPI() {
  try {
    console.log('Testing WordPress API connectivity...\n');
    
    // Initialize the product import service
    const importService = new ProductImportService();
    
    // Test fetching total product count
    console.log('Fetching total product count...');
    const totalCount = await importService.getTotalProductCount();
    console.log(`Total products in WordPress: ${totalCount}\n`);
    
    // Test fetching first page of products
    console.log('Fetching first batch of products...');
    const products = await importService.fetchProductsFromWordPress(1, 5);
    console.log(`Retrieved ${products.length} products:\n`);
    
    // Display first product details
    if (products.length > 0) {
      console.log('First product details:');
      console.log(`- Name: ${products[0].name}`);
      console.log(`- SKU: ${products[0].sku || 'N/A'}`);
      console.log(`- Price: ${products[0].regular_price || 'N/A'}`);
      console.log(`- Stock: ${products[0].stock_quantity || 'N/A'}`);
      console.log(`- Categories: ${products[0].categories ? products[0].categories.map(c => c.name).join(', ') : 'None'}`);
    }
    
    console.log('\n✓ WordPress API test completed successfully');
    
  } catch (error) {
    console.error('Error testing WordPress API:', error.message);
    process.exit(1);
  }
}

// Run the test
testWordPressAPI();