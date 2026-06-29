# Brand Product Import Guide

This guide explains how to import brand-specific products from WordPress/WooCommerce to the Autobacs India e-commerce platform.

## Overview

The brand product import functionality allows you to selectively import products for specific brands (like Profender) from the WordPress/WooCommerce store. This is useful when you want to focus on particular brands rather than importing all products at once.

## Prerequisites

1. Ensure your MongoDB database is running
2. Make sure the backend server is properly configured with environment variables:
   - `WORDPRESS_SITE_URL` - Your WordPress site URL
   - `WORDPRESS_API_KEY` - WooCommerce REST API key
   - `WORDPRESS_API_SECRET` - WooCommerce REST API secret
   - `MONGO_URI` - MongoDB connection string
3. Verify you have admin access to initiate imports

## Available Import Methods

### 1. API Endpoint Import

Import products for a specific brand using the REST API:

```bash
POST /products/import/brand/:brandName
```

Example:
```bash
curl -X POST http://localhost:5000/api/products/import/brand/Profender \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

### 2. Command Line Script

Import products for a specific brand using the command line script:

```bash
cd Autobacs/Back-end/server
node import-brand-products.js Profender
```

## How It Works

1. The import service connects to your WordPress/WooCommerce store using the REST API
2. It filters products by the specified brand name using product attributes
3. For each product:
   - Extracts product details (name, description, price, images, etc.)
   - Extracts brand information from product attributes
   - Maps categories and creates them if they don't exist
   - Creates or updates products in the MongoDB database
4. Tracks import progress and provides summary statistics

## Brand Extraction

The system automatically extracts brand information from product attributes in WordPress/WooCommerce:

1. Looks for attributes named "brand" or "manufacturer"
2. Uses the first option value as the brand name
3. Associates products with the extracted brand name

For a product to be imported for the "Profender" brand, it must have:
- An attribute named "brand" or "manufacturer"
- With an option value of "Profender"

## Supported Brands

The system works with any brand that is properly tagged in your WordPress/WooCommerce products:

- Profender
- Bushranger
- Ironman
- Dr. Nano
- Lightforce
- Option
- And any other brand properly tagged in your product attributes

## Verification

After running the import, you can verify the products were created by:

1. Checking the MongoDB database directly
2. Accessing the products API endpoint: `GET /products?brand=Profender`
3. Visiting the brand page: `/brands/profender`
4. Viewing the console output from the script which shows import statistics

## Troubleshooting

### Connection Issues

If you encounter WordPress/WooCommerce connection errors:
1. Verify your `WORDPRESS_SITE_URL`, `WORDPRESS_API_KEY`, and `WORDPRESS_API_SECRET` in the `.env` file
2. Ensure WordPress/WooCommerce is running
3. Check that the API credentials are correct and have proper permissions
4. Verify that the WooCommerce REST API is enabled

### Brand Filtering Issues

If products aren't being filtered by brand correctly:
1. Check that products in WordPress/WooCommerce have the correct brand attributes
2. Verify that the attribute name is "brand" or "manufacturer"
3. Ensure the attribute option value matches exactly (case-sensitive) with the brand name you're importing

### Product Update Issues

If existing products aren't being updated:
1. Check that products have unique SKUs
2. Verify that the SKU field is populated in WordPress/WooCommerce
3. Ensure the product import service can find existing products by SKU

## Best Practices

1. **Test First**: Run imports with a small subset of products first
2. **Monitor Progress**: Watch the console output for progress updates
3. **Check Results**: Verify imported products appear correctly on brand pages
4. **Handle Failures**: Review failed products and address any issues
5. **Schedule Imports**: Consider scheduling regular imports to keep products up-to-date

## Example Usage

### Importing Profender Products via API

```bash
# Assuming you have an admin token
curl -X POST http://localhost:5000/api/products/import/brand/Profender \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json"
```

### Importing Profender Products via Command Line

```bash
cd Autobacs/Back-end/server
node import-brand-products.js Profender
```

Expected output:
```
Brand product import script initialized...
✓ Connected to MongoDB
Starting import for brand: Profender
Import progress for Profender: 25%
Import progress for Profender: 50%
Import progress for Profender: 75%
Import progress for Profender: 100%
✅ Import completed successfully!
Summary:
  Total products: 20
  Imported: 20
  Failed: 0
  Skipped: 0
  Job ID: import-brand-Profender-1702374894567-abc123

✓ Disconnected from MongoDB
```

## Integration with Brand Pages

Once imported, Profender products will automatically appear on:
- The Profender brand page: `/brands/profender`
- Product filtering: `/products?brand=Profender`
- Search results when searching for "Profender"

The brand association is handled automatically during the import process, so no additional configuration is needed.