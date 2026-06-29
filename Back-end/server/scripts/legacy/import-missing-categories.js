#!/usr/bin/env node

/**
 * Script to import missing categories
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import WooCommerceApiClient from '../../services/woocommerceApiClient.js';
import Category from '../../models/Category.js';
import CategoryImportService from '../../services/categoryImportService.js';

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function importMissingCategories() {
  try {
    console.log('Importing missing categories...\n');
    
    // Get WooCommerce categories
    const apiClient = new WooCommerceApiClient();
    const wcCategories = await apiClient.fetchAllCategories();
    console.log(`WooCommerce categories: ${wcCategories.length}`);
    
    // Get database categories
    const dbCategories = await Category.find({});
    console.log(`Database categories: ${dbCategories.length}`);
    
    // Create maps for easier comparison
    const wcCategoryMap = new Map();
    wcCategories.forEach(cat => wcCategoryMap.set(cat.id, cat));
    
    const dbCategoryMap = new Map();
    dbCategories.forEach(cat => {
      if (cat.externalId) {
        dbCategoryMap.set(cat.externalId, cat);
      }
    });
    
    console.log(`\nCategories with external IDs in database: ${dbCategoryMap.size}`);
    
    // Find missing categories
    const missingCategories = [];
    
    for (const [wcId, wcCat] of wcCategoryMap) {
      if (!dbCategoryMap.has(wcId.toString())) {
        missingCategories.push(wcCat);
      }
    }
    
    console.log(`\nMissing categories: ${missingCategories.length}`);
    if (missingCategories.length > 0) {
      console.log('Missing categories:');
      missingCategories.forEach(cat => {
        console.log(`- ${cat.name} (ID: ${cat.id}, Parent: ${cat.parent || 'None'})`);
      });
      
      // Import missing categories
      console.log(`\nImporting ${missingCategories.length} missing categories...`);
      
      const categoryService = new CategoryImportService();
      let importedCount = 0;
      let failedCount = 0;
      
      for (const wcCategory of missingCategories) {
        try {
          const categoryId = await categoryService.findOrCreateCategory(wcCategory);
          console.log(`✓ Imported: ${wcCategory.name}`);
          importedCount++;
        } catch (error) {
          console.error(`✗ Failed to import ${wcCategory.name}:`, error.message);
          failedCount++;
        }
      }
      
      console.log(`\nImport results:`);
      console.log(`- Successfully imported: ${importedCount}`);
      console.log(`- Failed to import: ${failedCount}`);
      
      // Update parent relationships for all categories
      console.log(`\nSetting parent relationships...`);
      const categoryIdMap = new Map();
      const allDbCategories = await Category.find({});
      allDbCategories.forEach(cat => {
        if (cat.externalId) {
          categoryIdMap.set(parseInt(cat.externalId), cat._id);
        }
      });
      
      try {
        await categoryService.setCategoryParents(wcCategories, categoryIdMap);
        console.log('✓ Parent relationships updated');
      } catch (error) {
        console.error('✗ Failed to update parent relationships:', error.message);
      }
    } else {
      console.log('All categories are already imported!');
    }
    
    // Final count
    const finalDbCategories = await Category.find({});
    console.log(`\nFinal database category count: ${finalDbCategories.length}`);
    
  } catch (error) {
    console.error('Error importing missing categories:', error);
  }
}

importMissingCategories().then(() => {
  console.log('\nFinished importing missing categories');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});