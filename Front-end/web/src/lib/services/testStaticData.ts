// Test script to verify static product data integration
import productService from '@/lib/services/productService';

async function testStaticDataIntegration() {
  console.log('=== Testing Static Product Data Integration ===\n');
  
  try {
    // Test 1: Load static products
    console.log('1. Loading static products...');
    const staticProducts = await productService.loadStaticProducts();
    console.log(`   Loaded ${staticProducts.length} products from static data`);
    
    if (staticProducts.length > 0) {
      console.log('   Sample product:', {
        id: staticProducts[0]._id,
        name: staticProducts[0].name,
        price: staticProducts[0].price,
        category: staticProducts[0].category,
        hasImages: Array.isArray(staticProducts[0].images) ? staticProducts[0].images.length : 0
      });
    }
    
    // Test 2: Get featured products
    console.log('\n2. Getting featured products...');
    const featuredProducts = await productService.getFeaturedProducts(3, true);
    console.log(`   Found ${featuredProducts.length} featured products`);
    
    // Test 3: Search products
    console.log('\n3. Searching products...');
    const searchResults = await productService.searchProducts('Toyota', {}, true);
    console.log(`   Found ${searchResults.total} products matching "Toyota"`);
    
    // Test 4: Get products by category
    console.log('\n4. Getting products by category...');
    // Get a category from the first product
    if (staticProducts.length > 0) {
      const categoryId = typeof staticProducts[0].category === 'object' 
        ? staticProducts[0].category._id 
        : staticProducts[0].category;
      const categoryProducts = await productService.getProductsByCategory(categoryId, 3, true);
      console.log(`   Found ${categoryProducts.length} products in category "${categoryId}"`);
    }
    
    // Test 5: Format product for display
    console.log('\n5. Formatting product for display...');
    if (staticProducts.length > 0) {
      const formattedProduct = productService.formatProductForDisplay(staticProducts[0]);
      console.log('   Formatted product sample:', {
        id: formattedProduct._id,
        name: formattedProduct.name,
        categoryName: typeof formattedProduct.category === 'object' 
          ? formattedProduct.category.name 
          : formattedProduct.category,
        hasImages: Array.isArray(formattedProduct.images) ? formattedProduct.images.length : 0
      });
    }
    
    console.log('\n=== All tests passed successfully! ===');
    return true;
    
  } catch (error) {
    console.error('Error during testing:', error);
    console.log('\n=== Test failed ===');
    return false;
  }
}

// Run the test if this file is executed directly
if (typeof window === 'undefined') {
  // This will run in Node.js environment
  testStaticDataIntegration()
    .then(success => {
      if (!success) {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

export default testStaticDataIntegration;