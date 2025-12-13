// Example usage of ProductService
// This demonstrates how to integrate the new clean product data into your frontend

import productService from '@/lib/services/productService';

// Example 1: Fetch featured products using static data
async function loadFeaturedProducts() {
  try {
    console.log('Loading featured products from static data...');
    const featuredProducts = await productService.getFeaturedProducts(4, true);
    console.log(`Loaded ${featuredProducts.length} featured products`);
    return featuredProducts;
  } catch (error) {
    console.error('Error loading featured products:', error);
    return [];
  }
}

// Example 2: Search products using static data
async function searchProducts() {
  try {
    console.log('Searching products...');
    const result = await productService.searchProducts(
      'Toyota', 
      { 
        category: 'Exterior Accessories',
        minPrice: 5000,
        maxPrice: 50000,
        inStock: true
      },
      true // Use static data
    );
    console.log(`Found ${result.total} products matching search criteria`);
    return result.products;
  } catch (error) {
    console.error('Error searching products:', error);
    return [];
  }
}

// Example 3: Get products by category using static data
async function getProductsByCategory() {
  try {
    console.log('Getting products by category...');
    const products = await productService.getProductsByCategory('Exterior Accessories', 12, true);
    console.log(`Found ${products.length} products in category`);
    return products;
  } catch (error) {
    console.error('Error getting products by category:', error);
    return [];
  }
}

// Example 4: Get products by brand using static data
async function getProductsByBrand() {
  try {
    console.log('Getting products by brand...');
    const products = await productService.getProductsByBrand('Toyota', 12, true);
    console.log(`Found ${products.length} products for brand`);
    return products;
  } catch (error) {
    console.error('Error getting products by brand:', error);
    return [];
  }
}

// Example 5: Clear product cache/session
function clearProductSession() {
  console.log('Clearing product session...');
  productService.clearProductCache();
  console.log('Product session cleared');
}

// Example 6: Format product for display
async function formatProductExample() {
  try {
    const products = await productService.getFeaturedProducts(1, true);
    if (products.length > 0) {
      const formattedProduct = productService.formatProductForDisplay(products[0]);
      console.log('Formatted product:', formattedProduct);
      return formattedProduct;
    }
  } catch (error) {
    console.error('Error formatting product:', error);
  }
}

// Example 7: Fallback to API if static data fails
async function fallbackToAPI() {
  try {
    console.log('Attempting to load from static data...');
    const staticProducts = await productService.loadStaticProducts();
    
    if (staticProducts.length === 0) {
      console.log('No static data available, falling back to API...');
      const apiProducts = await productService.fetchProductsFromAPI({ limit: 4 });
      console.log(`Loaded ${apiProducts.products.length} products from API`);
      return apiProducts.products;
    } else {
      console.log(`Loaded ${staticProducts.length} products from static data`);
      return staticProducts;
    }
  } catch (error) {
    console.error('Error in fallback mechanism:', error);
    return [];
  }
}

// Run examples
async function runExamples() {
  console.log('=== ProductService Examples ===');
  
  // Load featured products
  await loadFeaturedProducts();
  
  // Search products
  await searchProducts();
  
  // Get products by category
  await getProductsByCategory();
  
  // Get products by brand
  await getProductsByBrand();
  
  // Format product example
  await formatProductExample();
  
  // Fallback to API
  await fallbackToAPI();
  
  // Clear session
  clearProductSession();
  
  console.log('=== Examples completed ===');
}

// Export functions for use in components
export {
  loadFeaturedProducts,
  searchProducts,
  getProductsByCategory,
  getProductsByBrand,
  clearProductSession,
  formatProductExample,
  fallbackToAPI,
  runExamples
};

// Default export
export default {
  loadFeaturedProducts,
  searchProducts,
  getProductsByCategory,
  getProductsByBrand,
  clearProductSession,
  formatProductExample,
  fallbackToAPI,
  runExamples
};