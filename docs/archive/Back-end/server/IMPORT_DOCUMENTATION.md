# Product Import from WordPress Documentation

## Overview
This document explains how to use the new product import functionality that allows importing products from a WordPress/WooCommerce site to the Autobacs e-commerce platform.

## Setup

### 1. WordPress API Configuration
To use the import functionality, you need to configure the WordPress API settings in the `.env` file:

```env
# WordPress API Configuration
WORDPRESS_SITE_URL=https://your-wordpress-site.com
WORDPRESS_API_KEY=your_consumer_key
WORDPRESS_API_SECRET=your_consumer_secret
WORDPRESS_API_VERSION=wc/v3

# Import Settings
IMPORT_BATCH_SIZE=50
IMPORT_DELAY_BETWEEN_BATCHES=1000
```

### 2. Generate WordPress API Keys
1. Log in to your WordPress admin panel
2. Go to WooCommerce → Settings → Advanced → REST API
3. Click "Add Key"
4. Set permissions to "Read/Write"
5. Copy the Consumer Key and Consumer Secret

## API Endpoints

### Manual Import
Trigger a manual import of all products from WordPress:

```
POST /products/import/wordpress
```

**Response:**
```json
{
  "success": true,
  "message": "Products imported successfully",
  "jobId": "import-1234567890-abc123",
  "summary": {
    "totalProducts": 150,
    "imported": 145,
    "failed": 5,
    "skipped": 0
  }
}
```

### Check Import Status
Get the status of a specific import job:

```
GET /products/import/status/:jobId
```

**Response:**
```json
{
  "success": true,
  "job": {
    "jobId": "import-1234567890-abc123",
    "status": "completed",
    "totalProducts": 150,
    "processedProducts": 150,
    "importedProducts": 145,
    "failedProducts": 5,
    "skippedProducts": 0,
    "progress": 100,
    "startedAt": "2025-11-20T10:00:00.000Z",
    "completedAt": "2025-11-20T10:05:00.000Z",
    "initiatedBy": "userId"
  }
}
```

### Schedule Import
Schedule recurring imports:

```
POST /products/import/schedule
```

**Body:**
```json
{
  "frequency": "daily",
  "time": "02:00"
}
```

### Get Scheduled Imports
Get all scheduled imports:

```
GET /products/import/schedule
```

## How It Works

### Data Mapping
The import service automatically maps WordPress/WooCommerce product fields to the Autobacs platform fields:

| WordPress/WooCommerce | Autobacs Platform |
|----------------------|-------------------|
| `name` | `name` |
| `description` | `description` |
| `short_description` | `shortDescription` |
| `regular_price` | `price` |
| `sale_price` | `originalPrice` |
| `sku` | `sku` |
| `stock_quantity` | `stock` |
| `images` | `images` |
| `categories` | `category` |
| `tags` | `tags` |
| `attributes` | `specifications` |
| `featured` | `isFeatured` |
| `status` | `isActive` |

### Conflict Resolution
The import service handles conflicts by:
1. Matching products by SKU
2. Updating existing products
3. Creating new products for unmatched items

### Error Handling
The import service includes comprehensive error handling:
- Network connectivity issues
- Authentication failures
- Data transformation errors
- Database write failures

## Testing
To test the import functionality:

1. Configure the WordPress API settings in `.env`
2. Run the test script:
   ```bash
   cd Back-end/server
   node test-import.js
   ```

## Monitoring
Import jobs are tracked in the database with detailed logging:
- Job ID and status
- Progress tracking
- Success/failure counts
- Timestamps for start/completion
- Error messages for failed imports

## Security
- WordPress API credentials are stored securely in environment variables
- Only admin users can trigger imports
- Rate limiting prevents abuse
- Input validation and sanitization

## Performance
- Batch processing of large product sets
- Configurable batch size and delay between batches
- Progress tracking for long-running imports
- Asynchronous processing