import importMonitoringService from '../../services/importMonitoringService.js';
import fs from 'fs';
import path from 'path';

/**
 * Load and display import metrics
 */
async function viewDashboard() {
  console.log('📈 Import Monitoring Dashboard\n');
  
  // Load metrics from file
  importMonitoringService.loadMetrics();
  
  // Get current metrics
  const metrics = importMonitoringService.getMetrics();
  
  // Display overall statistics
  console.log('📊 Overall Statistics:');
  console.log(`   Total Imports: ${metrics.totalImports}`);
  console.log(`   Total Products Processed: ${metrics.totalProductsProcessed}`);
  console.log(`   Products Created: ${metrics.totalProductsCreated}`);
  console.log(`   Products Updated: ${metrics.totalProductsUpdated}`);
  console.log(`   Total Failures: ${metrics.totalFailures}`);
  console.log(`   Average Processing Time: ${(metrics.averageProcessingTime / 1000).toFixed(2)} seconds`);
  
  // Display current import status
  if (metrics.currentImport) {
    console.log('\n🔄 Current Import:');
    console.log(`   ID: ${metrics.currentImport.id}`);
    console.log(`   Status: ${metrics.currentImport.status}`);
    console.log(`   Started: ${metrics.currentImport.startTime}`);
    console.log(`   Products Processed: ${metrics.currentImport.productsProcessed}`);
    console.log(`   Created: ${metrics.currentImport.productsCreated}`);
    console.log(`   Updated: ${metrics.currentImport.productsUpdated}`);
    console.log(`   Failures: ${metrics.currentImport.failures}`);
    
    if (metrics.currentImport.errors && metrics.currentImport.errors.length > 0) {
      console.log(`   Recent Errors: ${metrics.currentImport.errors.length}`);
      metrics.currentImport.errors.slice(-3).forEach((error, index) => {
        console.log(`     ${index + 1}. ${error.timestamp}: ${error.error}`);
      });
    }
  } else {
    console.log('\n⏸️  No active import');
  }
  
  // Display recent alerts
  if (metrics.recentAlerts && metrics.recentAlerts.length > 0) {
    console.log('\n🚨 Recent Alerts:');
    metrics.recentAlerts.slice(0, 5).forEach((alert, index) => {
      console.log(`   ${index + 1}. ${alert.timestamp} - ${alert.type}`);
      console.log(`      Data: ${JSON.stringify(alert.data)}`);
    });
  } else {
    console.log('\n✅ No recent alerts');
  }
  
  // Display import history
  console.log('\n📜 Recent Import History:');
  const history = importMonitoringService.getImportHistory(5);
  if (history.length > 0) {
    history.forEach((importRecord, index) => {
      console.log(`   ${index + 1}. ${importRecord.id}`);
      console.log(`      Status: ${importRecord.status}`);
      console.log(`      Started: ${importRecord.startTime}`);
      console.log(`      Duration: ${(importRecord.duration / 1000).toFixed(2)} seconds`);
      console.log(`      Products: ${importRecord.productsProcessed || 0}`);
      console.log(`      Created: ${importRecord.productsCreated || 0}`);
      console.log(`      Updated: ${importRecord.productsUpdated || 0}`);
      console.log(`      Failures: ${importRecord.failures || 0}`);
      console.log('');
    });
  } else {
    console.log('   No import history available');
  }
  
  // Display configuration info
  console.log('⚙️  Configuration:');
  console.log(`   Batch Size: ${process.env.IMPORT_BATCH_SIZE || 50}`);
  console.log(`   Delay Between Batches: ${process.env.IMPORT_DELAY_BETWEEN_BATCHES || 1000}ms`);
  console.log(`   Metadata File: ${path.join(process.cwd(), 'import-metadata.json')}`);
  console.log(`   Metrics File: ${path.join(process.cwd(), 'import-metrics.json')}`);
}

// Run the dashboard
viewDashboard().catch(error => {
  console.error('❌ Dashboard error:', error.message);
  process.exit(1);
});