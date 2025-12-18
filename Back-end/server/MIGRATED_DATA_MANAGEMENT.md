# Migrated Data Management

This document explains how to manage the migrated product and category data in the Autobacs system.

## Overview

The WordPress/WooCommerce product and category data has been successfully migrated to the Autobacs MongoDB database:
- ✅ 1085 products successfully migrated
- ✅ 418 categories successfully migrated
- ✅ Proper referential integrity maintained between products and categories

## Available Scripts

### 1. Clear Products and Categories
Removes all existing products and categories from the database:

```bash
npm run clear-products-and-categories
```

### 2. Verify Migrated Data
Checks that the migrated data is properly imported and verifies referential integrity:

```bash
npm run verify-migrated-data
```

## Database Structure

### Products Collection
- Model: `Product` (./models/Product.js)
- Fields: name, description, price, categories, images, etc.
- Referenced collections: Category

### Categories Collection
- Model: `Category` (./models/Category.js)
- Fields: name, slug, description, parent (for hierarchy)
- Referenced by: Product

## Data Verification Process

The verification script checks:
1. Total product count (should be ≥ 1085)
2. Total category count (should be ≥ 418)
3. Sample products with their categories
4. Sample categories
5. Referential integrity between products and categories

## Best Practices

1. **Always verify data** after migration using `npm run verify-migrated-data`
2. **Backup database** before clearing existing data
3. **Use clear-products-and-categories** only when intentionally removing all products/categories
4. **Check referential integrity** to ensure products properly link to categories

## Troubleshooting

### No Products Showing
- Run `npm run verify-migrated-data` to check if products exist
- Check MongoDB connection string in `.env` file
- Verify database permissions

### Missing Categories
- Run `npm run verify-migrated-data` to check category count
- Check if categories were properly migrated with products

### Referential Integrity Issues
- Products may reference non-existent categories
- Run verification script to identify orphaned references