// Diagnose uncategorized products issue
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function diagnoseUncategorizedProducts() {
  try {
    console.log('🔍 Diagnosing uncategorized products issue...');
    
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Get total product count
    const totalProducts = await Product.countDocuments();
    console.log(`📊 Total products in database: ${totalProducts}`);
    
    // Get products with categories array
    const productsWithCategoriesArray = await Product.countDocuments({ categories: { $exists: true } });
    console.log(`🏷️  Products with categories array: ${productsWithCategoriesArray}`);
    
    // Get products with empty categories array
    const productsWithEmptyCategories = await Product.countDocuments({ categories: { $exists: true, $size: 0 } });
    console.log(`EmptyEntries categories array: ${productsWithEmptyCategories}`);
    
    // Get products without categories field
    const productsWithoutCategoriesField = await Product.countDocuments({ categories: { $exists: false } });
    console.log(`❌ Missing categories field: ${productsWithoutCategoriesField}`);
    
    // Get products with ObjectId in categories (incorrect format)
    const productsWithObjectIdInCategories = await Product.countDocuments({
      categories: { $type: 'objectId' }
    });
    console.log(`🆔 Products with ObjectId in categories (incorrect): ${productsWithObjectIdInCategories}`);
    
    // Show sample products with empty categories
    console.log('\n📦 Sample products with empty categories:');
    const sampleEmptyCategoryProducts = await Product.find({ categories: { $exists: true, $size: 0 } })
      .limit(5);
    
    sampleEmptyCategoryProducts.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} (ID: ${product._id})`);
      console.log(`      Categories: ${JSON.stringify(product.categories)}`);
    });
    
    // Show sample products with ObjectId in categories
    console.log('\n🆔 Sample products with ObjectId in categories:');
    const sampleObjectIdProducts = await Product.find({
      categories: { $type: 'objectId' }
    }).limit(5);
    
    sampleObjectIdProducts.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} (ID: ${product._id})`);
      console.log(`      Categories: ${JSON.stringify(product.categories)}`);
    });
    
    // Show sample products without categories field
    console.log('\n❌ Sample products without categories field:');
    const sampleNoFieldProducts = await Product.find({ categories: { $exists: false } })
      .limit(5);
    
    sampleNoFieldProducts.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} (ID: ${product._id})`);
      console.log(`      Categories field exists: ${product.hasOwnProperty('categories')}`);
    });
    
    // Check a few categories to verify they exist
    console.log('\n📂 Sample categories:');
    const sampleCategories = await Category.find({}).limit(10);
    sampleCategories.forEach((category, index) => {
      console.log(`   ${index + 1}. ${category.name} (ID: ${category._id})`);
    });
    
    await mongoose.connection.close();
    console.log('\n✅ Diagnosis completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

diagnoseUncategorizedProducts();