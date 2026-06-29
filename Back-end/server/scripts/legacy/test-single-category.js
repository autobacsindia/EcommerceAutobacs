#!/usr/bin/env node

/**
 * Script to test importing a single category
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

async function testSingleCategory() {
  try {
    console.log('Testing single category import...\n');
    
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
      console.log('First missing category:');
      const firstMissing = missingCategories[0];
      console.log(`- ${firstMissing.name} (ID: ${firstMissing.id}, Parent: ${firstMissing.parent || 'None'})`);
      
      // Try to import this single category
      console.log(`\nTrying to import: ${firstMissing.name}`);
      
      const categoryService = new CategoryImportService();
      try {
        const categoryId = await categoryService.findOrCreateCategory(firstMissing);
        console.log(`✓ Successfully imported: ${firstMissing.name} with ID: ${categoryId}`);
      } catch (error) {
        console.error(`✗ Failed to import ${firstMissing.name}:`, error.message);
      }
    } else {
      console.log('No missing categories found!');
    }
    
    // Final count
    const finalDbCategories = await Category.find({});
    console.log(`\nFinal database category count: ${finalDbCategories.length}`);
    
  } catch (error) {
    console.error('Error testing single category import:', error);
  }
}

testSingleCategory().then(() => {
  console.log('\nFinished testing single category import');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});