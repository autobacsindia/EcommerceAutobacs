import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import Category from '../models/Category.js';

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

// Function to identify and clean duplicate products in any category
const cleanCategoryDuplicates = async (categorySlug, dryRun = true) => {
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

// Function to process all categories
const cleanAllCategories = async (dryRun = true) => {
  const categoriesToProcess = ['exterior', 'interior', 'body-kit', 'performance', 'suspension', 'audio', 'lights'];
  
  console.log(`=== CLEANING DUPLICATES IN ALL CATEGORIES ===`);
  console.log(`Dry Run Mode: ${dryRun ? 'ON' : 'OFF'}\n`);
  
  for (const categorySlug of categoriesToProcess) {
    await cleanCategoryDuplicates(categorySlug, dryRun);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  // Get command line arguments
  const args = process.argv.slice(2);
  const categorySlug = args[0];
  const dryRun = args[1] !== 'false'; // Default to dry run unless explicitly set to false
  
  if (categorySlug) {
    // Process specific category
    if (categorySlug === 'all') {
      // Process all categories
      await cleanAllCategories(dryRun);
    } else {
      // Process specific category
      await cleanCategoryDuplicates(categorySlug, dryRun);
    }
  } else {
    console.log('Usage: node clean-category-duplicates.js <categorySlug|all> [dryRun=true|false]');
    console.log('Examples:');
    console.log('  node clean-category-duplicates.js exterior true     # Dry run for exterior category');
    console.log('  node clean-category-duplicates.js exterior false    # Actual cleanup for exterior category');
    console.log('  node clean-category-duplicates.js all true         # Dry run for all categories');
    console.log('  node clean-category-duplicates.js all false        # Actual cleanup for all categories');
  }
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('\nDatabase connection closed');
};

main();