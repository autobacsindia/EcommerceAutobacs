import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Function to synchronize accessories category with live site
const synchronizeAccessoriesCategory = async () => {
  try {
    // Find the accessories category
    const category = await Category.findOne({ slug: 'accessories', isActive: true });
    
    if (!category) {
      console.log('Accessories category not found');
      return;
    }
    
    console.log(`Accessories Category: ${category.name}`);
    
    // Read the mapping CSV file
    const csvFilePath = './product-mapping-results/mapping-accessories-2025-12-08.csv';
    const csvContent = readFileSync(csvFilePath, 'utf8');
    
    // Parse CSV content
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    console.log(`Processing ${records.length} records from mapping CSV`);
    
    // Create a set of product names that should be active (from live site)
    const liveSiteProducts = new Set();
    for (const record of records) {
      if (record['Live Site Product Name']) {
        liveSiteProducts.add(record['Live Site Product Name'].trim());
      }
      // Also add local product names as fallback
      if (record['Local Product Name']) {
        liveSiteProducts.add(record['Local Product Name'].trim());
      }
    }
    
    console.log(`Unique products that should be active: ${liveSiteProducts.size}`);
    
    // Get all active products in the accessories category
    const activeProducts = await Product.find({ 
      category: category._id, 
      isActive: true 
    });
    
    console.log(`Current active products in database: ${activeProducts.length}`);
    
    // Identify products that should be deactivated (exist in DB but not in live site)
    let productsToDeactivate = [];
    for (const product of activeProducts) {
      if (!liveSiteProducts.has(product.name.trim())) {
        productsToDeactivate.push(product);
      }
    }
    
    console.log(`Products to deactivate: ${productsToDeactivate.length}`);
    
    // Deactivate mismatched products
    let deactivatedCount = 0;
    for (const product of productsToDeactivate) {
      console.log(`Deactivating product: ${product.name} (ID: ${product._id})`);
      product.isActive = false;
      // Add a note about why this product was deactivated
      if (!product.notes) {
        product.notes = '';
      }
      product.notes += ' [Deactivated: Not present on live site as of 2025-12-12]';
      await product.save();
      deactivatedCount++;
    }
    
    console.log(`Deactivated ${deactivatedCount} products`);
    
    // Final verification
    const finalActiveCount = await Product.countDocuments({ 
      category: category._id, 
      isActive: true 
    });
    
    console.log(`Final active product count: ${finalActiveCount}`);
    
    // Show some sample products
    const sampleProducts = await Product.find({ 
      category: category._id, 
      isActive: true 
    })
    .limit(5)
    .select('name sku price');
    
    console.log('\nSample active products:');
    sampleProducts.forEach(product => {
      console.log(`- ${product.name} | SKU: ${product.sku || 'None'} | Price: ₹${product.price}`);
    });
    
  } catch (error) {
    console.error('Error synchronizing accessories category:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  await synchronizeAccessoriesCategory();
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('\nDatabase connection closed');
};

main();