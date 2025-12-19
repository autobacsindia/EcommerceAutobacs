#!/usr/bin/env node

/**
 * Script to retry failed WooCommerce product and category imports
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';
import ImportJob from './models/ImportJob.js';
import ProductImportService from './services/productImportService.js';
import CategoryImportService from './services/categoryImportService.js';

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function retryAllProducts() {
  try {
    console.log('Starting full product re-import...');
    
    const importService = new ProductImportService();
    
    // Generate a unique job ID
    const jobId = `reimport-all-products-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`Starting re-import with job ID: ${jobId}`);
    
    // Start import process
    const importResult = await importService.importAllProducts(jobId, null, (progress) => {
      console.log(`Import progress: ${progress.progress}% (${progress.imported + progress.failed + progress.skipped}/${progress.totalPages * 50})`);
    });
    
    if (importResult.success) {
      console.log('Products re-imported successfully:');
      console.log(`- Total products: ${importResult.summary.totalProducts}`);
      console.log(`- Imported: ${importResult.summary.imported}`);
      console.log(`- Failed: ${importResult.summary.failed}`);
      console.log(`- Skipped: ${importResult.summary.skipped}`);
    } else {
      console.error('Failed to re-import products:', importResult.error);
    }
    
  } catch (error) {
    console.error('Error during product re-import:', error);
  }
}

async function retryAllCategories() {
  try {
    console.log('Starting full category re-import...');
    
    const categoryService = new CategoryImportService();
    
    console.log('Starting category re-import...');
    
    // Start import process
    const importResult = await categoryService.importAllCategories((progress) => {
      console.log(`Category import progress: ${Math.round(progress.processed / progress.total * 100)}% (${progress.processed}/${progress.total})`);
    });
    
    if (importResult.success) {
      console.log('Categories re-imported successfully:');
      console.log(`- Total categories: ${importResult.summary.total}`);
      console.log(`- Imported: ${importResult.summary.imported}`);
      console.log(`- Failed: ${importResult.summary.failed}`);
    } else {
      console.error('Failed to re-import categories:', importResult.error);
    }
    
  } catch (error) {
    console.error('Error during category re-import:', error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node retry-failed-imports.js [products|categories|all]');
    process.exit(1);
  }
  
  const command = args[0];
  
  switch (command) {
    case 'products':
      await retryAllProducts();
      break;
    case 'categories':
      await retryAllCategories();
      break;
    case 'all':
      await retryAllProducts();
      await retryAllCategories();
      break;
    default:
      console.log('Unknown command. Use: products, categories, or all');
      process.exit(1);
  }
  
  console.log('Finished retry process');
  process.exit(0);
}

// Wait for MongoDB connection to be established before running main
setTimeout(() => {
  main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
}, 2000);