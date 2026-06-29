#!/usr/bin/env node

/**
 * Script to check actual counts from WooCommerce
 */

import dotenv from 'dotenv';
import WooCommerceApiClient from '../../services/woocommerceApiClient.js';

dotenv.config();

async function checkCounts() {
  try {
    const apiClient = new WooCommerceApiClient();
    
    console.log('Checking WooCommerce counts...');
    
    // Get total product count
    const totalProducts = await apiClient.getProductCount();
    console.log(`Total products in WooCommerce: ${totalProducts}`);
    
    // Get total category count
    const totalCategories = await apiClient.getCategoryCount();
    console.log(`Total categories in WooCommerce: ${totalCategories}`);
    
    // Get all categories to see details
    const wcCategories = await apiClient.fetchAllCategories();
    console.log(`\nDetailed category list (${wcCategories.length} categories):`);
    wcCategories.forEach(cat => {
      console.log(`- ${cat.name} (ID: ${cat.id}, Parent: ${cat.parent || 'None'})`);
    });
    
  } catch (error) {
    console.error('Error checking counts:', error.message);
  }
}

checkCounts().then(() => {
  console.log('\nFinished checking counts');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});