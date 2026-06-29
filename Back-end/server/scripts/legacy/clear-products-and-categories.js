import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

async function clearProductsAndCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Count existing products and categories
    console.log('📊 Checking current database state...');
    const productCount = await Product.countDocuments();
    const categoryCount = await Category.countDocuments();
    
    console.log(`📦 Products in database: ${productCount}`);
    console.log(`🏷️ Categories in database: ${categoryCount}\n`);
    
    if (productCount > 0) {
      console.log('🗑️ Clearing all products...');
      const productResult = await Product.deleteMany({});
      console.log(`✅ Removed ${productResult.deletedCount} products`);
    } else {
      console.log('ℹ️ No products to remove');
    }
    
    if (categoryCount > 0) {
      console.log('🗑️ Clearing all categories...');
      const categoryResult = await Category.deleteMany({});
      console.log(`✅ Removed ${categoryResult.deletedCount} categories`);
    } else {
      console.log('ℹ️ No categories to remove');
    }
    
    // Verify removal
    console.log('\n🔍 Verifying removal...');
    const remainingProducts = await Product.countDocuments();
    const remainingCategories = await Category.countDocuments();
    
    console.log(`📦 Remaining products: ${remainingProducts}`);
    console.log(`🏷️ Remaining categories: ${remainingCategories}`);
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    console.log('✅ Database cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

clearProductsAndCategories();