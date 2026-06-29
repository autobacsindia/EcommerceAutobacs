# Incremental Product Import System

This document explains how to use the incremental product import system for synchronizing products between WordPress and the Autobacs e-commerce platform.

## Overview

The incremental import system efficiently imports only the products that have changed since the last import, rather than re-importing the entire catalog. This reduces processing time, minimizes API usage, and decreases the load on both systems.

## System Components

### 1. Main Import Script
- **File**: `incremental-product-import.js`
- **Purpose**: Performs the actual product import process
- **Features**:
  - Fetches products modified since last import
  - Processes products in configurable batches
  - Maps WordPress categories to e-commerce categories
  - Handles errors with retry logic
  - Updates import metadata

### 2. Category Mapping Service
- **File**: `services/categoryMappingService.js`
- **Purpose**: Maps WordPress categories to e-commerce categories
- **Features**:
  - Fuzzy matching for category names
  - Pattern-based matching for common variations
  - Automatic category creation (when enabled)
  - Caching for improved performance

### 3. Import Monitoring Service
- **File**: `services/importMonitoringService.js`
- **Purpose**: Tracks import progress and performance
- **Features**:
  - Real-time progress tracking
  - Error rate monitoring
  - Performance metrics collection
  - Alerting for issues

### 4. Scheduled Import Setup
- **File**: `setup-scheduled-import.js`
- **Purpose**: Configures and manages scheduled imports
- **Features**:
  - Cron-based scheduling
  - Multiple import schedules
  - Manual trigger capability

### 5. Dashboard Viewer
- **File**: `view-import-dashboard.js`
- **Purpose**: Displays import metrics and status
- **Features**:
  - Overall statistics
  - Current import status
  - Recent alerts
  - Import history

## Configuration

### Environment Variables
The import system uses the following environment variables from `.env`:

```bash
# Import Settings
IMPORT_BATCH_SIZE=50
IMPORT_DELAY_BETWEEN_BATCHES=1000

# WordPress API Configuration
WORDPRESS_SITE_URL=https://autobacsindia.com/
WORDPRESS_API_KEY=your_key_here
WORDPRESS_API_SECRET=your_secret_here
WORDPRESS_API_VERSION=wc/v3
```

### Import Configuration
Additional configuration can be found in `import-config.js`:

```javascript
{
  // Batch processing settings
  BATCH_SIZE: 50,
  DELAY_BETWEEN_BATCHES: 1000,
  
  // Retry settings
  RETRY_LIMIT: 3,
  RETRY_DELAY: 1000,
  
  // Import behavior
  DEFAULT_IMPORT_MODE: 'incremental',
  ENABLE_CATEGORY_CREATION: true,
  ENABLE_BRAND_EXTRACTION: true
}
```

## Usage

### Running an Incremental Import

To run an incremental import immediately:

```bash
cd Autobacs/Back-end/server
node incremental-product-import.js
```

This will:
1. Check the last import timestamp
2. Fetch products modified since that time
3. Process products in batches
4. Update the last import timestamp
5. Generate a completion report

### Setting Up Scheduled Imports

To set up scheduled imports:

```bash
# Create default scheduled import (daily at 2:00 AM)
node setup-scheduled-import.js create

# List all scheduled imports
node setup-scheduled-import.js list

# Start the scheduler
node setup-scheduled-import.js start
```

### Viewing Import Metrics

To view import metrics and status:

```bash
node view-import-dashboard.js
```

This displays:
- Overall import statistics
- Current import status
- Recent alerts
- Import history
- Configuration information

## Category Mapping

The system uses sophisticated category mapping to ensure products are properly categorized:

### Direct Mappings
Exact matches between WordPress and e-commerce categories:
- "Accessories" → "accessories"
- "Exterior" → "exterior"
- "Interior" → "interior"
- etc.

### Pattern Matching
Handles common variations:
- Categories containing "light" → "lighting"
- Categories containing "perform" → "performance"
- Categories containing "suspens" → "suspension"

### Automatic Category Creation
When enabled, the system can automatically create new categories for WordPress categories that don't exist in the e-commerce platform.

## Error Handling

The system includes robust error handling:

### Retry Logic
- Network errors: Retry up to 3 times with exponential backoff
- Timeout errors: Retry up to 2 times
- Server errors: Retry once with longer delay

### Error Classification
- **Transient**: Connection issues, timeouts
- **Permanent**: Authentication failures, permission errors
- **Recoverable**: Data format issues, missing fields

### Monitoring and Alerts
- Tracks error rates during imports
- Generates alerts for high error rates (>5%)
- Monitors processing speed and alerts for slow performance

## Data Transformation

The system transforms WordPress product data to match the e-commerce platform schema:

### Field Mapping
- `name` → `name`
- `description` → `description`
- `price` → `price`
- `sku` → `sku`
- `stock_quantity` → `stock`
- etc.

### Brand Extraction
Extracts brand information from product attributes:
- Looks for "brand" or "brands" attribute
- Uses first option value as brand name

### Image Handling
- Preserves all product images
- Stores as array of image URLs

## Performance Optimization

### Batch Processing
- Processes products in configurable batches
- Delays between batches to avoid overwhelming APIs
- Adjustable batch size based on system performance

### Caching
- Caches category mappings for faster lookups
- Reduces database queries during import

### Efficient Change Detection
- Uses WordPress API's `modified_after` parameter
- Only fetches products that have actually changed

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify WordPress API credentials in `.env`
   - Check that API key has proper permissions

2. **Network Connectivity**
   - Ensure WordPress site is accessible
   - Check firewall settings

3. **Performance Issues**
   - Reduce batch size
   - Increase delay between batches
   - Check system resources

4. **Category Mapping Problems**
   - Review category mapping rules in `import-config.js`
   - Check for typos in category names

### Log Files
- Import process logs to console
- Error details logged with stack traces
- Metrics saved to `import-metrics.json`
- Metadata saved to `import-metadata.json`

## Maintenance

### Regular Tasks
1. **Monitor Import Success**
   - Check dashboard for errors
   - Review alert history
   - Verify product counts

2. **Review Performance**
   - Check processing speeds
   - Adjust batch sizes if needed
   - Monitor resource usage

3. **Update Category Mappings**
   - Add new mappings for WordPress categories
   - Review pattern matching rules
   - Clean up unused categories

### Backup Considerations
- Import metadata tracks last import timestamp
- Metrics provide historical performance data
- Regular database backups recommended

## Extending the System

### Adding New Category Mappings
1. Update `CATEGORY_MAPPING_RULES` in `import-config.js`
2. Add direct mappings for exact matches
3. Add pattern rules for common variations

### Custom Field Mapping
1. Modify `FIELD_MAPPING` in `import-config.js`
2. Add new WordPress field to e-commerce field mappings
3. Update product transformation logic if needed

### Additional Alert Types
1. Extend `checkAlerts()` in `importMonitoringService.js`
2. Add new threshold-based alerts
3. Implement custom alert logic

## Best Practices

1. **Start Small**
   - Begin with smaller batch sizes
   - Monitor performance closely
   - Gradually increase batch size

2. **Regular Monitoring**
   - Check import status daily
   - Review error rates
   - Address issues promptly

3. **Backup Strategy**
   - Maintain regular database backups
   - Preserve import metadata
   - Document configuration changes

4. **Performance Tuning**
   - Adjust batch sizes based on system capacity
   - Optimize delay times
   - Monitor resource usage

5. **Security**
   - Protect API credentials
   - Limit API key permissions
   - Regular credential rotation