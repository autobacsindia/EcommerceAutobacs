// Simple test script to check connections
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import ProductImportService from './services/productImportService.js';

// Load environment variables
dotenv.config();

async function testConnections() {
  try {
    // Test MongoDB connection
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected successfully');
    
    // Test product count
    const count = await Product.countDocuments();
    console.log(`📊 Total products in database: ${count}`);
    
    // Test WordPress connection
    console.log('Testing WordPress connection...');
    const importService = new ProductImportService();
    const wpCount = await importService.getTotalProductCount();
    console.log(`🌐 WordPress product count: ${wpCount}`);
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      mongoose.connection.close();
    }
  }
}

testConnections();