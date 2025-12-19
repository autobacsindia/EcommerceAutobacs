# WooCommerce Data Migration System - User Guide

## Overview

This document provides instructions on how to use the newly implemented WooCommerce data migration system for the Autobacs e-commerce platform. The system allows you to import product and category data from a WordPress WooCommerce site into your Autobacs MongoDB database.

## System Components

The migration system consists of the following components:

1. **WooCommerce API Client** - Handles communication with the WooCommerce REST API
2. **Category Import Service** - Manages category data import and hierarchy
3. **Enhanced Product Import Service** - Imports products with improved category mapping
4. **Migration Orchestration Service** - Coordinates full migration processes
5. **API Endpoints** - RESTful endpoints for triggering migrations
6. **CLI Tool** - Command-line interface for manual migrations

## Prerequisites

Before using the migration system, ensure you have:

1. A WordPress site with WooCommerce installed
2. WooCommerce REST API credentials (consumer key and secret)
3. Properly configured environment variables in your `.env` file

## Configuration

Add the following to your `.env` file:

```env
# WooCommerce API Configuration
WORDPRESS_SITE_URL=https://your-wordpress-site.com
WORDPRESS_API_KEY=your_consumer_key
WORDPRESS_API_SECRET=your_consumer_secret
WORDPRESS_API_VERSION=wc/v3

# Import Settings
IMPORT_BATCH_SIZE=50
IMPORT_DELAY_BETWEEN_BATCHES=1000
```

## Usage Methods

### 1. API Endpoints

The system provides the following RESTful API endpoints:

#### Full Migration
```
POST /products/import/wordpress/full
```
Imports all categories and products from WooCommerce.

#### Category-Only Migration
```
POST /products/import/wordpress/categories
```
Imports only categories from WooCommerce.

#### Product-Only Migration (existing)
```
POST /products/import/wordpress
```
Imports only products from WooCommerce (existing endpoint enhanced).

#### Check Import Status
```
GET /products/import/status
```
Returns the status of recent import jobs.

#### Check Specific Job Status
```
GET /products/import/status/:jobId
```
Returns the status of a specific import job.

### 2. CLI Tool

The system includes a command-line interface for manual migrations:

#### Full Migration
```bash
npm run woocommerce-migration migrate-full
```

#### Category-Only Migration
```bash
npm run woocommerce-migration migrate-categories
```

#### Product-Only Migration
```bash
npm run woocommerce-migration migrate-products
```

#### Check Import Status
```bash
npm run woocommerce-migration status
```

## Features

### Enhanced Data Mapping

The system now properly maps:
- Product external IDs for accurate updates
- Category hierarchies with parent-child relationships
- Product-to-category associations
- Brand information from product attributes
- Image URLs with alt text

### Improved Error Handling

- Better error reporting and logging
- Automatic retry mechanisms for failed requests
- Graceful handling of data inconsistencies
- Detailed import job tracking

### Progress Tracking

- Real-time progress reporting
- Detailed import job status tracking
- Summary statistics for each migration

## Best Practices

1. **Initial Setup**: Run a full migration first to establish baseline data
2. **Incremental Updates**: Use product-only imports for regular updates
3. **Monitor Jobs**: Check import job status to ensure successful completion
4. **Handle Failures**: Review failed items and address issues before re-importing

## Troubleshooting

### Common Issues

1. **Authentication Errors**: Verify your WooCommerce API credentials
2. **Network Issues**: Check connectivity to your WordPress site
3. **Data Conflicts**: Review import job reports for duplicate or conflicting data

### Getting Help

Check the import job status endpoint for detailed error information. Each job includes:
- Error messages
- Progress statistics
- Timing information# WooCommerce Data Migration System - User Guide

## Overview

This document provides instructions on how to use the newly implemented WooCommerce data migration system for the Autobacs e-commerce platform. The system allows you to import product and category data from a WordPress WooCommerce site into your Autobacs MongoDB database.

## System Components

The migration system consists of the following components:

1. **WooCommerce API Client** - Handles communication with the WooCommerce REST API
2. **Category Import Service** - Manages category data import and hierarchy
3. **Enhanced Product Import Service** - Imports products with improved category mapping
4. **Migration Orchestration Service** - Coordinates full migration processes
5. **API Endpoints** - RESTful endpoints for triggering migrations
6. **CLI Tool** - Command-line interface for manual migrations

## Prerequisites

Before using the migration system, ensure you have:

1. A WordPress site with WooCommerce installed
2. WooCommerce REST API credentials (consumer key and secret)
3. Properly configured environment variables in your `.env` file

## Configuration

Add the following to your `.env` file:

```env
# WooCommerce API Configuration
WORDPRESS_SITE_URL=https://your-wordpress-site.com
WORDPRESS_API_KEY=your_consumer_key
WORDPRESS_API_SECRET=your_consumer_secret
WORDPRESS_API_VERSION=wc/v3

# Import Settings
IMPORT_BATCH_SIZE=50
IMPORT_DELAY_BETWEEN_BATCHES=1000
```

## Usage Methods

### 1. API Endpoints

The system provides the following RESTful API endpoints:

#### Full Migration
```
POST /products/import/wordpress/full
```
Imports all categories and products from WooCommerce.

#### Category-Only Migration
```
POST /products/import/wordpress/categories
```
Imports only categories from WooCommerce.

#### Product-Only Migration (existing)
```
POST /products/import/wordpress
```
Imports only products from WooCommerce (existing endpoint enhanced).

#### Check Import Status
```
GET /products/import/status
```
Returns the status of recent import jobs.

#### Check Specific Job Status
```
GET /products/import/status/:jobId
```
Returns the status of a specific import job.

### 2. CLI Tool

The system includes a command-line interface for manual migrations:

#### Full Migration
```bash
npm run woocommerce-migration migrate-full
```

#### Category-Only Migration
```bash
npm run woocommerce-migration migrate-categories
```

#### Product-Only Migration
```bash
npm run woocommerce-migration migrate-products
```

#### Check Import Status
```bash
npm run woocommerce-migration status
```

## Features

### Enhanced Data Mapping

The system now properly maps:
- Product external IDs for accurate updates
- Category hierarchies with parent-child relationships
- Product-to-category associations
- Brand information from product attributes
- Image URLs with alt text

### Improved Error Handling

- Better error reporting and logging
- Automatic retry mechanisms for failed requests
- Graceful handling of data inconsistencies
- Detailed import job tracking

### Progress Tracking

- Real-time progress reporting
- Detailed import job status tracking
- Summary statistics for each migration

## Best Practices

1. **Initial Setup**: Run a full migration first to establish baseline data
2. **Incremental Updates**: Use product-only imports for regular updates
3. **Monitor Jobs**: Check import job status to ensure successful completion
4. **Handle Failures**: Review failed items and address issues before re-importing

## Troubleshooting

### Common Issues

1. **Authentication Errors**: Verify your WooCommerce API credentials
2. **Network Issues**: Check connectivity to your WordPress site
3. **Data Conflicts**: Review import job reports for duplicate or conflicting data

### Getting Help

Check the import job status endpoint for detailed error information. Each job includes:
- Error messages
- Progress statistics
- Timing information