import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import SearchService from './services/searchService.js';

dotenv.config();

async function testBrandFiltering() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Test brand filtering
    console.log('\nTesting brand filtering...');
    
    // Find products with specific brand
    const profenderProducts = await Product.find({ brand: 'Profender' });
    console.log(`Found ${profenderProducts.length} Profender products`);
    
    if (profenderProducts.length > 0) {
      console.log('Sample Profender product:', {
        name: profenderProducts[0].name,
        brand: profenderProducts[0].brand,
        price: profenderProducts[0].price
      });
    }
    
    // Find all unique brands in the database
    const allBrands = await Product.distinct('brand', { brand: { $exists: true, $ne: null } });
    console.log(`\nTotal unique brands in database: ${allBrands.length}`);
    console.log('Brands:', allBrands);
    
    // Test the search service filtering approach
    try {
      const searchParams = { brand: 'Profender' };
      const searchResults = await SearchService.searchProducts(searchParams);
      console.log(`\nSearch service results for Profender: ${searchResults.products.length} products`);
      
      if (searchResults.products.length > 0) {
        console.log('Sample search result:', {
          name: searchResults.products[0].name,
          brand: searchResults.products[0].brand,
          price: searchResults.products[0].price
        });
      }
    } catch (searchError) {
      console.log('Search service error:', searchError.message);
    }
    
    // Test with other brands if Profender is not available
    const allProducts = await Product.find({}).limit(5);
    console.log(`\nSample of all products: ${allProducts.length}`);
    allProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - Brand: ${product.brand || 'N/A'}`);
    });
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error testing brand filtering:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

testBrandFiltering();