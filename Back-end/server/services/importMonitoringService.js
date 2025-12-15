import fs from 'fs';
import path from 'path';

class ImportMonitoringService {
  constructor() {
    this.metrics = {
      totalImports: 0,
      totalProductsProcessed: 0,
      totalProductsCreated: 0,
      totalProductsUpdated: 0,
      totalFailures: 0,
      averageProcessingTime: 0,
      errorRates: []
    };
    
    this.currentImport = null;
    this.importHistory = [];
    this.alerts = [];
  }

  /**
   * Start monitoring an import process
   * @param {string} importId - Unique identifier for this import
   * @param {Object} config - Import configuration
   */
  startImport(importId, config = {}) {
    this.currentImport = {
      id: importId,
      startTime: new Date(),
      config: config,
      productsProcessed: 0,
      productsCreated: 0,
      productsUpdated: 0,
      failures: 0,
      status: 'running'
    };
    
    console.log(`📊 Starting import monitoring: ${importId}`);
  }

  /**
   * Record progress during import
   * @param {Object} progress - Progress information
   */
  recordProgress(progress) {
    if (!this.currentImport) {
      console.warn('⚠️  No active import to record progress for');
      return;
    }
    
    // Update current import metrics
    this.currentImport.productsProcessed += progress.processed || 0;
    this.currentImport.productsCreated += progress.created || 0;
    this.currentImport.productsUpdated += progress.updated || 0;
    this.currentImport.failures += progress.failures || 0;
    
    // Update overall metrics
    this.metrics.totalProductsProcessed += progress.processed || 0;
    this.metrics.totalProductsCreated += progress.created || 0;
    this.metrics.totalProductsUpdated += progress.updated || 0;
    this.metrics.totalFailures += progress.failures || 0;
    
    // Check for alerts
    this.checkAlerts();
  }

  /**
   * Complete an import process
   * @param {Object} results - Final import results
   */
  completeImport(results = {}) {
    if (!this.currentImport) {
      console.warn('⚠️  No active import to complete');
      return;
    }
    
    const endTime = new Date();
    const duration = endTime - this.currentImport.startTime;
    
    // Update current import with final results
    this.currentImport.endTime = endTime;
    this.currentImport.duration = duration;
    this.currentImport.status = results.success ? 'completed' : 'failed';
    this.currentImport.results = results;
    
    // Calculate processing speed
    const productsPerMinute = (this.currentImport.productsProcessed / (duration / 60000)).toFixed(2);
    
    // Update metrics
    this.metrics.totalImports++;
    this.metrics.averageProcessingTime = this.calculateAverageProcessingTime(duration);
    
    // Add to history
    this.importHistory.push({...this.currentImport});
    
    // Log completion
    console.log(`✅ Import completed: ${this.currentImport.id}`);
    console.log(`   📊 Products processed: ${this.currentImport.productsProcessed}`);
    console.log(`   ➕ Created: ${this.currentImport.productsCreated}`);
    console.log(`   🔄 Updated: ${this.currentImport.productsUpdated}`);
    console.log(`   ❌ Failed: ${this.currentImport.failures}`);
    console.log(`   ⏱️  Duration: ${(duration / 1000).toFixed(2)} seconds`);
    console.log(`   🚀 Speed: ${productsPerMinute} products/minute`);
    
    // Reset current import
    this.currentImport = null;
  }

  /**
   * Record an error during import
   * @param {string} error - Error message
   * @param {Object} context - Error context
   */
  recordError(error, context = {}) {
    if (!this.currentImport) {
      console.warn('⚠️  No active import to record error for');
      return;
    }
    
    const errorRecord = {
      timestamp: new Date(),
      error: error,
      context: context,
      importId: this.currentImport.id
    };
    
    // Add to current import
    if (!this.currentImport.errors) {
      this.currentImport.errors = [];
    }
    this.currentImport.errors.push(errorRecord);
    this.currentImport.failures++;
    
    // Update overall metrics
    this.metrics.totalFailures++;
    
    // Log error
    console.error(`❌ Import error in ${this.currentImport.id}:`, error);
    
    // Check for alerts
    this.checkAlerts();
  }

  /**
   * Check if any alerts should be triggered
   */
  checkAlerts() {
    if (!this.currentImport) {
      return;
    }
    
    // Error rate alert
    const errorRate = this.currentImport.failures / Math.max(this.currentImport.productsProcessed, 1);
    if (errorRate > 0.05) { // 5% error rate threshold
      this.triggerAlert('HIGH_ERROR_RATE', {
        errorRate: (errorRate * 100).toFixed(2),
        threshold: 5,
        productsProcessed: this.currentImport.productsProcessed,
        failures: this.currentImport.failures
      });
    }
    
    // Slow processing alert
    if (this.currentImport.productsProcessed > 10) {
      const currentTime = new Date();
      const duration = currentTime - this.currentImport.startTime;
      const productsPerMinute = this.currentImport.productsProcessed / (duration / 60000);
      
      if (productsPerMinute < 5) { // Less than 5 products per minute
        this.triggerAlert('SLOW_PROCESSING', {
          productsPerMinute: productsPerMinute.toFixed(2),
          threshold: 5,
          productsProcessed: this.currentImport.productsProcessed
        });
      }
    }
  }

  /**
   * Trigger an alert
   * @param {string} type - Alert type
   * @param {Object} data - Alert data
   */
  triggerAlert(type, data) {
    const alert = {
      id: Date.now().toString(),
      timestamp: new Date(),
      type: type,
      data: data,
      importId: this.currentImport ? this.currentImport.id : null
    };
    
    this.alerts.push(alert);
    
    // Log alert
    console.warn(`🚨 ALERT: ${type}`, JSON.stringify(data, null, 2));
    
    // TODO: Implement actual alerting (email, Slack, etc.)
  }

  /**
   * Get current metrics
   * @returns {Object} Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      currentImport: this.currentImport,
      recentAlerts: this.alerts.slice(-10) // Last 10 alerts
    };
  }

  /**
   * Get import history
   * @param {number} limit - Number of recent imports to return
   * @returns {Array} Import history
   */
  getImportHistory(limit = 10) {
    return this.importHistory.slice(-limit).reverse();
  }

  /**
   * Calculate average processing time
   * @param {number} newDuration - Duration of latest import
   * @returns {number} Average processing time
   */
  calculateAverageProcessingTime(newDuration) {
    if (this.importHistory.length === 0) {
      return newDuration;
    }
    
    const totalDuration = this.importHistory.reduce((sum, importRecord) => 
      sum + (importRecord.duration || 0), 0) + newDuration;
    return totalDuration / (this.importHistory.length + 1);
  }

  /**
   * Save metrics to file
   */
  saveMetrics() {
    try {
      const metricsFile = path.join(process.cwd(), 'import-metrics.json');
      const data = {
        metrics: this.metrics,
        importHistory: this.importHistory.slice(-100), // Keep last 100 imports
        alerts: this.alerts.slice(-50) // Keep last 50 alerts
      };
      
      fs.writeFileSync(metricsFile, JSON.stringify(data, null, 2));
      console.log('💾 Import metrics saved to file');
    } catch (error) {
      console.error('❌ Failed to save metrics:', error.message);
    }
  }

  /**
   * Load metrics from file
   */
  loadMetrics() {
    try {
      const metricsFile = path.join(process.cwd(), 'import-metrics.json');
      if (fs.existsSync(metricsFile)) {
        const data = fs.readFileSync(metricsFile, 'utf8');
        const parsed = JSON.parse(data);
        
        this.metrics = parsed.metrics || this.metrics;
        this.importHistory = parsed.importHistory || this.importHistory;
        this.alerts = parsed.alerts || this.alerts;
        
        console.log('📂 Import metrics loaded from file');
      }
    } catch (error) {
      console.warn('⚠️  Could not load metrics:', error.message);
    }
  }
}

// Export singleton instance
export default new ImportMonitoringService();