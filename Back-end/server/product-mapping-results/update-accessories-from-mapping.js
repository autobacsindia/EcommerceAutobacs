import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

// Load environment variables
dotenv.config({ path: '../.env' });

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

// Function to process the mapping CSV and update products
const updateAccessoriesFromMapping = async (csvFilePath) => {
  try {
    // Read the CSV file
    const csvContent = readFileSync(csvFilePath, 'utf8');
    
    // Parse CSV content
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    console.log(`Processing ${records.length} records from mapping CSV`);
    
    // Find the accessories category
    const category = await Category.findOne({ slug: 'accessories', isActive: true });
    
    if (!category) {
      console.log('Accessories category not found');
      return;
    }
    
    console.log(`Found accessories category: ${category.name}`);
    
    // Counter for updates
    let updatedProducts = 0;
    let skippedProducts = 0;
    
    // Process each record
    for (const record of records) {
      // Skip header or invalid records
      if (!record['Local Product Name']) {
        console.log('Skipping record with no local product name');
        skippedProducts++;
        continue;
      }
      
      // Find product by name in the accessories category
      const product = await Product.findOne({ 
        name: record['Local Product Name'],
        category: category._id,
        isActive: true
      });
      
      if (!product) {
        console.log(`Product not found: ${record['Local Product Name']}`);
        skippedProducts++;
        continue;
      }
      
      // Check if we have new information to update
      let hasUpdates = false;
      const updates = {};
      
      // Update SKU if provided in mapping
      if (record['Local SKU'] && record['Local SKU'] !== product.sku) {
        updates.sku = record['Local SKU'];
        hasUpdates = true;
      }
      
      // Update price if provided in mapping and different
      if (record['Local Price'] && !isNaN(record['Local Price'])) {
        const newPrice = parseFloat(record['Local Price']);
        if (newPrice !== product.price) {
          updates.price = newPrice;
          hasUpdates = true;
        }
      }
      
      // Update match status if provided
      if (record['Match Status'] && record['Match Status'] !== 'To verify') {
        // We could store this in a custom field or notes, but for now we'll just log it
        console.log(`Match status for ${product.name}: ${record['Match Status']}`);
        hasUpdates = true;
      }
      
      // Apply updates if any
      if (hasUpdates) {
        await Product.findByIdAndUpdate(product._id, updates, { new: true });
        console.log(`Updated product: ${product.name}`);
        updatedProducts++;
      } else {
        console.log(`No updates needed for: ${product.name}`);
      }
    }
    
    console.log(`\nUpdate Summary:`);
    console.log(`- Updated products: ${updatedProducts}`);
    console.log(`- Skipped products: ${skippedProducts}`);
    console.log(`- Total records processed: ${records.length}`);
    
  } catch (error) {
    console.error('Error processing mapping CSV:', error);
  }
};

// Function to add SKU information to products that don't have it
const addMissingSKUs = async () => {
  try {
    console.log('\n=== Adding Missing SKUs ===');
    
    // Find the accessories category
    const category = await Category.findOne({ slug: 'accessories', isActive: true });
    
    if (!category) {
      console.log('Accessories category not found');
      return;
    }
    
    // Find products without SKU
    const productsWithoutSKU = await Product.find({ 
      category: category._id,
      isActive: true,
      $or: [{ sku: { $exists: false } }, { sku: null }, { sku: "" }]
    });
    
    console.log(`Found ${productsWithoutSKU.length} products without SKU`);
    
    let updatedCount = 0;
    
    for (const product of productsWithoutSKU) {
      // Generate a simple SKU based on product name and ID
      const baseSKU = product.name
        .substring(0, 10)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .substring(0, 8);
      
      // Add a numeric suffix based on product ID
      const productIdSuffix = product._id.toString().substring(product._id.toString().length - 4);
      const newSKU = `${baseSKU}${productIdSuffix}`;
      
      // Update the product
      await Product.findByIdAndUpdate(product._id, { sku: newSKU }, { new: true });
      console.log(`Added SKU ${newSKU} to product: ${product.name}`);
      updatedCount++;
    }
    
    console.log(`Added SKUs to ${updatedCount} products`);
    
  } catch (error) {
    console.error('Error adding missing SKUs:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  // Process the mapping CSV file
  await updateAccessoriesFromMapping('mapping-accessories-2025-12-08.csv');
  
  // Add missing SKUs as identified in our analysis
  await addMissingSKUs();
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('\nDatabase connection closed');
};

main();