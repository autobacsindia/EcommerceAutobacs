# Category Import Guide

This guide explains how to import product categories from autobacsindia.com into your local Autobacs India e-commerce platform.

## Overview

The import script creates a hierarchical category structure that matches the taxonomy on autobacsindia.com/shop/. It creates both main categories and their subcategories with proper parent-child relationships.

## Files

1. `import-autobacs-categories.js` - Full import script for all categories
2. `test-category-import.js` - Simple test script to verify functionality

## Prerequisites

1. Ensure your MongoDB database is running
2. Make sure the backend server is properly configured with environment variables
3. Verify you have admin access to create categories

## Running the Import

### Test Import (Recommended First Step)

Before running the full import, test the functionality with the simple test script:

```bash
node test-category-import.js
```

This will create two test categories to verify the import process works correctly.

### Full Category Import

To import all categories from autobacsindia.com:

```bash
node import-autobacs-categories.js
```

## Category Structure

The import creates the following main categories:
- Other
- Accessories
- Exterior
- Interior
- Performance
- Suspension
- Lighting
- Body Kits
- Protection Kit
- Roof Top
- Portable Fridge
- Winch
- X-JACK

Each main category has multiple subcategories as found on the live site.

## How It Works

1. The script connects to your MongoDB database using the connection string in your `.env` file
2. It checks if each category already exists to prevent duplicates
3. It creates main categories first, then subcategories with proper parent references
4. It maintains the hierarchical structure by linking subcategories to their parent categories

## Verification

After running the import, you can verify the categories were created by:

1. Checking the MongoDB database directly
2. Accessing the categories API endpoint: `GET /categories`
3. Viewing the console output from the script which lists all categories

## Troubleshooting

### Connection Issues

If you encounter MongoDB connection errors:
1. Verify your `MONGO_URI` in the `.env` file
2. Ensure MongoDB is running
3. Check that the database credentials are correct

### Duplicate Categories

The script checks for existing categories by slug before creating new ones. If you need to reimport categories:
1. Manually delete existing categories from the database, or
2. Modify the script to update existing categories instead of skipping them

### Script Errors

If the script encounters errors:
1. Check the console output for specific error messages
2. Verify all required fields (name, slug) are present in the category definitions
3. Ensure the MongoDB connection is stable throughout the import process

## Customization

To customize the import:

1. Modify the `categoryStructure` array to change main categories
2. Modify the `subCategoryStructure` array to change subcategories
3. Adjust the parent-child relationships as needed
4. Add or remove categories based on your specific requirements

## API Integration

Once imported, these categories will be available through the existing API endpoints:
- `GET /categories` - List all categories
- `GET /categories/:id` - Get category by ID
- `GET /categories/slug/:slug` - Get category by slug

The frontend ProductFilters component will automatically display these categories in the filter sidebar.