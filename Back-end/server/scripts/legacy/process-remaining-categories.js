import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

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

// Function to add SKU information to products that don't have it
const addMissingSKUs = async (categorySlug) => {
  try {
    console.log(`\n=== Adding Missing SKUs to ${categorySlug} ===`);
    
    // Find the category
    const category = await Category.findOne({ slug: categorySlug, isActive: true });
    
    if (!category) {
      console.log(`Category ${categorySlug} not found`);
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
    
    console.log(`Added SKUs to ${updatedCount} products in ${categorySlug}`);
    
  } catch (error) {
    console.error(`Error adding missing SKUs to ${categorySlug}:`, error);
  }
};

// Function to identify and clean duplicate products in any category
const cleanCategoryDuplicates = async (categorySlug, dryRun = false) => {
  try {
    const category = await Category.findOne({ slug: categorySlug, isActive: true });
    
    if (!category) {
      console.log(`Category with slug '${categorySlug}' not found`);
      return;
    }
    
    console.log(`\n=== CLEANING DUPLICATE PRODUCTS IN CATEGORY: ${category.name} ===`);
    console.log(`Dry Run Mode: ${dryRun ? 'ON' : 'OFF'}\n`);
    
    // Find all products in this category
    const products = await Product.find({ 
      category: category._id, 
      isActive: true 
    }).sort({ name: 1, createdAt: 1 }); // Sort by name and creation date
    
    // Group products by normalized name
    const productGroups = {};
    products.forEach(product => {
      const normalizedName = product.name.trim().toLowerCase();
      if (!productGroups[normalizedName]) {
        productGroups[normalizedName] = [];
      }
      productGroups[normalizedName].push(product);
    });
    
    // Find duplicates
    const duplicates = Object.entries(productGroups).filter(([name, group]) => group.length > 1);
    
    if (duplicates.length === 0) {
      console.log('No duplicate products found.');
      return;
    }
    
    console.log(`Found ${duplicates.length} duplicate product groups:`);
    
    let totalDuplicatesRemoved = 0;
    
    for (const [normalizedName, group] of duplicates) {
      console.log(`\nProcessing group: "${group[0].name}" (${group.length} items)`);
      
      // Sort by creation date to keep the oldest and remove newer duplicates
      group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      // Keep the first (oldest) product and mark others as inactive
      const productToKeep = group[0];
      const productsToRemove = group.slice(1);
      
      console.log(`  Keeping: ${productToKeep._id} (Created: ${productToKeep.createdAt})`);
      
      for (const product of productsToRemove) {
        console.log(`  Marking for removal: ${product._id} (Created: ${product.createdAt})`);
        
        if (!dryRun) {
          // Soft delete by setting isActive to false
          product.isActive = false;
          await product.save();
          console.log(`    ✓ Marked as inactive`);
        } else {
          console.log(`    (Would mark as inactive in actual run)`);
        }
        
        totalDuplicatesRemoved++;
      }
    }
    
    console.log(`\n${dryRun ? '[DRY RUN]' : '[ACTUAL RUN]'} Total duplicates processed: ${totalDuplicatesRemoved}`);
    
    if (dryRun) {
      console.log('\nTo actually remove duplicates, run this script with dryRun=false');
    }
    
    return duplicates;
  } catch (error) {
    console.error('Error cleaning duplicate products:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  // Process the categories you requested
  const categoriesToProcess = [
    { slug: 'interior', file: 'product-mapping-results/mapping-interior-2025-12-08.csv' },
    { slug: 'body-kit', file: 'product-mapping-results/mapping-body-kit-2025-12-08.csv' },
    { slug: 'performance', file: 'product-mapping-results/mapping-performance-2025-12-08.csv' },
    { slug: 'audio', file: 'product-mapping-results/mapping-audio-2025-12-08.csv' },
    { slug: 'lights', file: 'product-mapping-results/mapping-lights-2025-12-08.csv' }
  ];
  
  for (const category of categoriesToProcess) {
    console.log(`\n=== Processing ${category.slug} ===`);
    
    // Add missing SKUs
    await addMissingSKUs(category.slug);
    
    // Clean duplicates (actual run, not dry run)
    await cleanCategoryDuplicates(category.slug, false);
  }
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('\nDatabase connection closed');
};

main();