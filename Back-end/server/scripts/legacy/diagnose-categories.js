#!/usr/bin/env node

/**
 * Script to diagnose category import issues
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

async function diagnoseCategories() {
  try {
    console.log('Diagnosing category import issues...\n');
    
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
    const existingCategories = [];
    
    for (const [wcId, wcCat] of wcCategoryMap) {
      if (dbCategoryMap.has(wcId.toString())) {
        existingCategories.push(wcCat);
      } else {
        missingCategories.push(wcCat);
      }
    }
    
    console.log(`\nMissing categories: ${missingCategories.length}`);
    if (missingCategories.length > 0) {
      console.log('Missing categories:');
      missingCategories.forEach(cat => {
        console.log(`- ${cat.name} (ID: ${cat.id}, Parent: ${cat.parent || 'None'})`);
      });
    }
    
    // Check for categories with duplicate names/slugs
    const nameCount = new Map();
    const slugCount = new Map();
    
    dbCategories.forEach(cat => {
      nameCount.set(cat.name, (nameCount.get(cat.name) || 0) + 1);
      slugCount.set(cat.slug, (slugCount.get(cat.slug) || 0) + 1);
    });
    
    const duplicateNames = [];
    const duplicateSlugs = [];
    
    for (const [name, count] of nameCount) {
      if (count > 1) {
        duplicateNames.push({ name, count });
      }
    }
    
    for (const [slug, count] of slugCount) {
      if (count > 1) {
        duplicateSlugs.push({ slug, count });
      }
    }
    
    if (duplicateNames.length > 0) {
      console.log(`\nCategories with duplicate names: ${duplicateNames.length}`);
      duplicateNames.forEach(item => {
        console.log(`- ${item.name} (${item.count} instances)`);
      });
    }
    
    if (duplicateSlugs.length > 0) {
      console.log(`\nCategories with duplicate slugs: ${duplicateSlugs.length}`);
      duplicateSlugs.forEach(item => {
        console.log(`- ${item.slug} (${item.count} instances)`);
      });
    }
    
    // Try to import missing categories
    if (missingCategories.length > 0) {
      console.log(`\nAttempting to import ${missingCategories.length} missing categories...`);
      
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
      
      // Update parent relationships
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
    }
    
  } catch (error) {
    console.error('Error diagnosing categories:', error);
  }
}

diagnoseCategories().then(() => {
  console.log('\nFinished diagnosis');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});