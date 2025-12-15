import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function cleanupWpProducts() {
  try {
    console.log('🧹 Cleaning up WordPress products...');
    
    // Connect to MongoDB with explicit localhost configuration
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Delete all products with SKUs starting with "WP-"
    console.log('🗑️ Deleting products with WordPress SKUs...');
    const result = await Product.deleteMany({ sku: /^WP-/ });
    console.log(`✅ Deleted ${result.deletedCount} WordPress products`);
    
    // Count remaining products
    const remainingCount = await Product.countDocuments();
    console.log(`📊 Remaining products in database: ${remainingCount}`);
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    console.log('✅ Cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanupWpProducts();