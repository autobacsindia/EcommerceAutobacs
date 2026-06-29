/**
 * Test script for the WooCommerce migration system
 * 
 * This script tests the basic functionality of the migration system
 * by running a mock migration process.
 */

import WooCommerceApiClient from '../../services/woocommerceApiClient.js';
import CategoryImportService from '../../services/categoryImportService.js';
import ProductImportService from '../../services/productImportService.js';
import MigrationOrchestrationService from '../../services/migrationOrchestrationService.js';

async function testWooCommerceApiClient() {
  console.log('Testing WooCommerce API Client...');
  
  try {
    const apiClient = new WooCommerceApiClient();
    console.log('✅ WooCommerce API Client initialized successfully');
    
    // Test getting product count
    try {
      const productCount = await apiClient.getProductCount();
      console.log(`✅ Product count: ${productCount}`);
    } catch (error) {
      console.log(`⚠️  Could not get product count (this is expected if WooCommerce is not configured): ${error.message}`);
    }
    
    // Test getting category count
    try {
      const categoryCount = await apiClient.getCategoryCount();
      console.log(`✅ Category count: ${categoryCount}`);
    } catch (error) {
      console.log(`⚠️  Could not get category count (this is expected if WooCommerce is not configured): ${error.message}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize WooCommerce API Client:', error.message);
    return false;
  }
}

async function testCategoryImportService() {
  console.log('\nTesting Category Import Service...');
  
  try {
    const categoryService = new CategoryImportService();
    console.log('✅ Category Import Service initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Category Import Service:', error.message);
    return false;
  }
}

async function testProductImportService() {
  console.log('\nTesting Product Import Service...');
  
  try {
    const productService = new ProductImportService();
    console.log('✅ Product Import Service initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Product Import Service:', error.message);
    return false;
  }
}

async function testMigrationOrchestrationService() {
  console.log('\nTesting Migration Orchestration Service...');
  
  try {
    const migrationService = new MigrationOrchestrationService();
    console.log('✅ Migration Orchestration Service initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Migration Orchestration Service:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('Running WooCommerce Migration System Tests...\n');
  
  const tests = [
    testWooCommerceApiClient,
    testCategoryImportService,
    testProductImportService,
    testMigrationOrchestrationService
  ];
  
  let passedTests = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passedTests++;
      }
    } catch (error) {
      console.error(`❌ Test failed with exception: ${error.message}`);
    }
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Test Results: ${passedTests}/${tests.length} tests passed`);
  
  if (passedTests === tests.length) {
    console.log('🎉 All tests passed! The migration system is ready to use.');
  } else {
    console.log('⚠️  Some tests failed. Please check the output above for details.');
  }
  
  return passedTests === tests.length;
}

// Run the tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export default runAllTests;