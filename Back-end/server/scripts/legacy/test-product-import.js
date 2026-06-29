import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function testProductImport() {
  try {
    console.log('🚀 Starting test product import...');
    
    // Connect to MongoDB with explicit localhost configuration
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Try to create a simple test product
    console.log('📝 Creating test product...');
    const testProduct = new Product({
      name: 'Test Product',
      description: 'Test product description',
      price: 100,
      stock: 10,
      sku: 'TEST-001',
      category: '64b0f1a0e8b8e4a8c8f0b1a1' // This would need to be a valid category ID
    });
    
    console.log('💾 Saving test product...');
    await testProduct.save();
    console.log('✅ Test product saved successfully');
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('📋 Error details:', error);
    process.exit(1);
  }
}

testProductImport();