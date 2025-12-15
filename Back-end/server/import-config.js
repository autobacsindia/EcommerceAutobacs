// Import configuration settings
export const IMPORT_CONFIG = {
  // Batch processing settings
  BATCH_SIZE: parseInt(process.env.IMPORT_BATCH_SIZE) || 50,
  DELAY_BETWEEN_BATCHES: parseInt(process.env.IMPORT_DELAY_BETWEEN_BATCHES) || 1000,
  
  // Retry settings
  RETRY_LIMIT: 3,
  RETRY_DELAY: 1000,
  
  // WordPress API settings
  WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL || 'https://autobacsindia.com',
  WORDPRESS_API_VERSION: process.env.WORDPRESS_API_VERSION || 'wc/v3',
  
  // Database settings
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/autobacs',
  
  // Import behavior
  DEFAULT_IMPORT_MODE: 'incremental', // 'full' or 'incremental'
  ENABLE_CATEGORY_CREATION: true,
  ENABLE_BRAND_EXTRACTION: true,
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ENABLE_DETAILED_LOGGING: process.env.ENABLE_DETAILED_LOGGING === 'true',
  
  // Scheduling
  DEFAULT_SCHEDULE: '0 2 * * *', // Daily at 2:00 AM
};

// Category mapping rules
export const CATEGORY_MAPPING_RULES = {
  // Direct mappings
  exact: {
    'Accessories': 'accessories',
    'Exterior': 'exterior',
    'Interior': 'interior',
    'Performance': 'performance',
    'Suspension': 'suspension',
    'Lighting': 'lighting',
    'Body Kits': 'body-kits',
    'Protection Kit': 'protection-kit',
    'Roof Top': 'roof-top',
    'Portable Fridge': 'portable-fridge',
    'Winch': 'winch',
    'X-JACK': 'x-jack'
  },
  
  // Pattern-based mappings
  patterns: [
    { pattern: /light/i, category: 'lighting' },
    { pattern: /perform/i, category: 'performance' },
    { pattern: /suspens/i, category: 'suspension' },
    { pattern: /exterior/i, category: 'exterior' },
    { pattern: /interior/i, category: 'interior' },
    { pattern: /access/i, category: 'accessories' },
    { pattern: /body/i, category: 'body-kits' },
    { pattern: /protect/i, category: 'protection-kit' },
    { pattern: /roof/i, category: 'roof-top' }
  ]
};

// Field mapping configuration
export const FIELD_MAPPING = {
  // WordPress field -> Our field
  'name': 'name',
  'description': 'description',
  'short_description': 'shortDescription',
  'price': 'price',
  'regular_price': 'price',
  'sale_price': 'originalPrice',
  'sku': 'sku',
  'stock_quantity': 'stock',
  'status': 'isActive',
  'featured': 'isFeatured',
  'permalink': 'externalUrl',
  'id': 'externalId'
};

// Error handling configuration
export const ERROR_HANDLING = {
  // Retry strategies
  retryStrategies: {
    network: { maxRetries: 3, delay: 1000 },
    timeout: { maxRetries: 2, delay: 2000 },
    server: { maxRetries: 1, delay: 5000 }
  },
  
  // Error categories
  categories: {
    TRANSIENT: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'],
    PERMANENT: ['EACCES', 'EPERM'],
    RECOVERABLE: ['EINVAL', 'ERANGE']
  }
};

// Monitoring configuration
export const MONITORING_CONFIG = {
  // Metrics collection
  collectMetrics: true,
  metricsInterval: 60000, // 1 minute
  
  // Alerting thresholds
  alertThresholds: {
    errorRate: 0.05, // 5% error rate
    processingSpeed: 10, // products per minute
    memoryUsage: 0.8 // 80% memory usage
  },
  
  // Log retention
  logRetentionDays: 30
};

export default {
  IMPORT_CONFIG,
  CATEGORY_MAPPING_RULES,
  FIELD_MAPPING,
  ERROR_HANDLING,
  MONITORING_CONFIG
};