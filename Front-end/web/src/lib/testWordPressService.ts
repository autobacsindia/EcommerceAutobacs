/**
 * Test script for WordPress service
 * This script tests the WordPress service functions to ensure they handle
 * unconfigured APIs gracefully
 */

import { wordpressService } from '../services/wordpressService';

async function testWordPressService() {
  console.log('Testing WordPress Service...');
  
  try {
    // Test getAllVehicles
    console.log('Testing getAllVehicles...');
    const vehicles = await wordpressService.getAllVehicles();
    console.log(`✓ getAllVehicles returned ${vehicles.length} items`);
    
    // Test getProductsByVehicle
    console.log('Testing getProductsByVehicle...');
    const products = await wordpressService.getProductsByVehicle('test');
    console.log(`✓ getProductsByVehicle returned ${products.length} items`);
    
    // Test getProductCategories
    console.log('Testing getProductCategories...');
    const categories = await wordpressService.getProductCategories();
    console.log(`✓ getProductCategories returned ${categories.length} items`);
    
    console.log('All tests passed!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testWordPressService();
}

export default testWordPressService;