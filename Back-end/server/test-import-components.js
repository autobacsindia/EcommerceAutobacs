import categoryMappingService from './services/categoryMappingService.js';
import importMonitoringService from './services/importMonitoringService.js';

/**
 * Test the import components
 */
async function testComponents() {
  console.log('🧪 Testing Import Components...\n');
  
  try {
    // Test 1: Category Mapping Service
    console.log('1. Testing Category Mapping Service...');
    
    // Initialize the service
    await categoryMappingService.initialize();
    const stats = categoryMappingService.getStatistics();
    console.log(`   📊 Initialized with ${stats.totalCategories} categories`);
    
    // Test finding categories
    const testCategories = ['Accessories', 'Exterior', 'Performance', 'Lighting', 'NonExistent'];
    
    for (const categoryName of testCategories) {
      const category = categoryMappingService.findCategory(categoryName);
      if (category) {
        console.log(`   ✅ Found category: ${categoryName} → ${category.name} (${category._id})`);
      } else {
        console.log(`   ❌ Category not found: ${categoryName}`);
      }
    }
    
    // Test 2: Import Monitoring Service
    console.log('\n2. Testing Import Monitoring Service...');
    
    // Load existing metrics
    importMonitoringService.loadMetrics();
    console.log('   📂 Loaded existing metrics');
    
    // Start a test import
    const testImportId = 'test-import-' + Date.now();
    importMonitoringService.startImport(testImportId, {
      batchSize: 10,
      delayBetweenBatches: 100
    });
    console.log(`   🚀 Started test import: ${testImportId}`);
    
    // Record some progress
    importMonitoringService.recordProgress({
      processed: 50,
      created: 30,
      updated: 20,
      failures: 0
    });
    console.log('   📈 Recorded progress: 50 products (30 created, 20 updated)');
    
    // Record an error
    importMonitoringService.recordError('Test error message', {
      productId: 'test-product-123'
    });
    console.log('   ⚠️  Recorded test error');
    
    // Complete the import
    importMonitoringService.completeImport({
      success: true,
      created: 30,
      updated: 20,
      failed: 1,
      duration: 5000
    });
    console.log('   ✅ Completed test import');
    
    // Save metrics
    importMonitoringService.saveMetrics();
    console.log('   💾 Saved metrics to file');
    
    // Get metrics
    const metrics = importMonitoringService.getMetrics();
    console.log(`   📊 Current metrics: ${metrics.totalImports} total imports`);
    
    console.log('\n✅ All component tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Component test failed:', error.message);
    process.exit(1);
  }
}

// Run the tests
testComponents().catch(error => {
  console.error('❌ Test error:', error.message);
  process.exit(1);
});