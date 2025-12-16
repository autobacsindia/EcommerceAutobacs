import mongoose from 'mongoose';
import dotenv from 'dotenv';
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

// Function to get all categories with their product counts
const getAllCategoriesWithCounts = async () => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    
    console.log('=== LOCAL CATEGORIES ===');
    console.log('Name | Slug | Product Count');
    console.log('-----|------|-------------');
    
    for (const category of categories) {
      const productCount = await Product.countDocuments({ 
        category: category._id, 
        isActive: true 
      });
      
      console.log(`${category.name} | ${category.slug} | ${productCount}`);
    }
    
    return categories;
  } catch (error) {
    console.error('Error getting categories:', error);
  }
};

// Function to export products from a specific category in mapping format
const exportCategoryForMapping = async (categorySlug) => {
  try {
    // Find the category by slug
    const category = await Category.findOne({ slug: categorySlug, isActive: true });
    
    if (!category) {
      console.log(`Category with slug '${categorySlug}' not found`);
      return;
    }
    
    console.log(`\n=== EXPORTING PRODUCTS FROM CATEGORY: ${category.name} ===`);
    
    // Find all products in this category
    const products = await Product.find({ 
      category: category._id, 
      isActive: true 
    })
    .populate('categories', 'name slug')
    .sort({ name: 1 });
    
    console.log(`Found ${products.length} products in category '${category.name}'`);
    
    // Create mapping CSV header
    let csvContent = 'Live Site Product Name,Live Site SKU,Live Site Price,Local Product Name,Local SKU,Local Price,Match Status,Notes\n';
    
    // Add product data to CSV in mapping format
    products.forEach(product => {
      const row = [
        `"${product.name.replace(/"/g, '""')}"`, // Live Site Product Name (placeholder)
        '', // Live Site SKU (placeholder)
        '', // Live Site Price (placeholder)
        `"${product.name.replace(/"/g, '""')}"`, // Local Product Name
        product.sku || '', // Local SKU
        product.price, // Local Price
        'To verify', // Match Status
        '' // Notes
      ].join(',');
      
      csvContent += row + '\n';
    });
    
    // Save to file
    const fs = await import('fs');
    const fileName = `mapping-${categorySlug}-${new Date().toISOString().slice(0, 10)}.csv`;
    fs.writeFileSync(fileName, csvContent);
    
    console.log(`Mapping template exported to ${fileName}`);
    
    // Show sample rows
    console.log('\nSample mapping rows:');
    const lines = csvContent.split('\n');
    for (let i = 0; i < Math.min(6, lines.length); i++) {
      console.log(lines[i]);
    }
    
    return products;
  } catch (error) {
    console.error('Error exporting category for mapping:', error);
  }
};

// Function to check for duplicate products in a category
const checkForDuplicates = async (categorySlug) => {
  try {
    const category = await Category.findOne({ slug: categorySlug, isActive: true });
    
    if (!category) {
      console.log(`Category with slug '${categorySlug}' not found`);
      return;
    }
    
    console.log(`\n=== CHECKING FOR DUPLICATES IN CATEGORY: ${category.name} ===`);
    
    // Find all products in this category
    const products = await Product.find({ 
      category: category._id, 
      isActive: true 
    }).sort({ name: 1 });
    
    // Group products by name
    const productGroups = {};
    products.forEach(product => {
      const normalizedName = product.name.trim().toLowerCase();
      if (!productGroups[normalizedName]) {
        productGroups[normalizedName] = [];
      }
      productGroups[normalizedName].push(product);
    });
    
    // Find duplicates
    const duplicates = Object.values(productGroups).filter(group => group.length > 1);
    
    if (duplicates.length > 0) {
      console.log(`Found ${duplicates.length} duplicate product groups:`);
      duplicates.forEach(group => {
        console.log(`\nDuplicate group (${group.length} items):`);
        group.forEach(product => {
          console.log(`  - ${product.name} (ID: ${product._id}, Price: ₹${product.price})`);
        });
      });
    } else {
      console.log('No duplicate products found.');
    }
    
    return duplicates;
  } catch (error) {
    console.error('Error checking for duplicates:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  // Get all categories with counts
  await getAllCategoriesWithCounts();
  
  // Export accessories category for mapping
  await exportCategoryForMapping('accessories');
  
  // Check for duplicates in accessories category
  await checkForDuplicates('accessories');
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('\nDatabase connection closed');
};

main();