import { wordpressService } from './src/services/wordpressService';

async function testAPI() {
  console.log('Testing WordPress API configuration...');
  
  try {
    // Test if API is configured
    const categories = await wordpressService.getProductCategories();
    console.log('Categories found:', categories.length);
    console.log('Sample categories:', categories.slice(0, 5));
    
    // Test fetching products for Toyota Hilux
    const productsResponse = await wordpressService.getProductsByVehicle('toyota-hilux', 1, 20);
    console.log('Products for Toyota Hilux:', productsResponse.products.length);
    console.log('Total products for Toyota Hilux:', productsResponse.total);
    console.log('Sample product:', productsResponse.products[0]?.name || 'No products found');
    
  } catch (error) {
    console.error('Error testing API:', error);
  }
}

testAPI();