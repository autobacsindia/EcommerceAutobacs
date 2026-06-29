import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function checkProducts() {
  try {
    console.log('🔍 Checking products in database...');
    
    // Connect to MongoDB with explicit localhost configuration
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Count total products
    const productCount = await Product.countDocuments();
    console.log(`📊 Total products in database: ${productCount}`);
    
    // Show first 5 products
    const products = await Product.find().limit(5);
    console.log(`\n📋 First 5 products:`);
    products.forEach((product, index) => {
      console.log(`  ${index + 1}. ${product.name} (SKU: ${product.sku})`);
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkProducts();