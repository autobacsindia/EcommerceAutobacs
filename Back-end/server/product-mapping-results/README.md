# Product Mapping Results

This directory contains the results and tools from the product mapping exercise between the live Autobacs India website and the local development environment.

## Contents

### Analysis Reports
- `PRODUCT_MAPPING_ANALYSIS.md` - Detailed analysis of data quality issues
- `PRODUCT_MAPPING_EXECUTION_SUMMARY.md` - Summary of tasks completed and findings
- `MULTI_CATEGORY_MAPPING_SUMMARY.md` - Summary of multi-category mapping files
- `CATEGORY_UPDATES_SUMMARY.md` - Summary of exterior and suspension category updates
- `REMAINING_CATEGORIES_PROCESSING_SUMMARY.md` - Summary of processing for interior, body kit, performance, audio, and lights categories

### Data Files
- `exported-accessories-products-2025-12-08.csv` - Raw export of all products in the accessories category
- `mapping-accessories-2025-12-08.csv` - Mapping template for comparing live site products with local products
- `mapping-audio-2025-12-08.csv` - Mapping template for audio category
- `mapping-body-kit-2025-12-08.csv` - Mapping template for body kit category
- `mapping-exterior-2025-12-08.csv` - Mapping template for exterior category
- `mapping-interior-2025-12-08.csv` - Mapping template for interior category
- `mapping-lights-2025-12-08.csv` - Mapping template for lights category
- `mapping-performance-2025-12-08.csv` - Mapping template for performance category
- `mapping-suspension-2025-12-08.csv` - Mapping template for suspension category

### Tools
- `export-category-products.js` - Script to export products from any category to CSV
- `product-mapping-tool.js` - Comprehensive tool for category analysis and mapping template creation
- `clean-duplicate-products.js` - Tool to identify and safely remove duplicate products
- `clean-category-duplicates.js` - Enhanced tool to clean duplicates in any category
- `update-accessories-from-mapping.js` - Tool to update accessories based on mapping CSV
- `update-categories-from-mapping.js` - Tool to update exterior and suspension categories
- `process-remaining-categories.js` - Tool to process interior, body kit, performance, audio, and lights categories

## Usage

### Exporting Products
To export products from a specific category:
```bash
node export-category-products.js
```

### Analyzing Categories and Creating Mapping Templates
To analyze categories and create mapping templates:
```bash
node product-mapping-tool.js
```

### Cleaning Duplicate Products
To identify and clean duplicate products (dry run mode):
```bash
node clean-duplicate-products.js
```

To actually remove duplicates, modify the script to set `dryRun=false`.

### Cleaning Duplicates in Any Category
To clean duplicates in a specific category (dry run mode):
```bash
node clean-category-duplicates.js <categorySlug> true
```

To actually remove duplicates in a specific category:
```bash
node clean-category-duplicates.js <categorySlug> false
```

To clean duplicates in all categories (dry run mode):
```bash
node clean-category-duplicates.js all true
```

To actually remove duplicates in all categories:
```bash
node clean-category-duplicates.js all false
```

## Key Findings

1. **Data Quality Issues**: Multiple categories have significant duplicate entries
2. **Missing Information**: Many products are missing SKU information
3. **Inconsistent Pricing**: Several products have ₹0 pricing

## Next Steps

1. Use the mapping CSV templates to manually compare products with the live site
2. Run the duplicate cleanup scripts for each category
3. Begin populating missing SKU information
4. Correct pricing information for products priced at ₹0