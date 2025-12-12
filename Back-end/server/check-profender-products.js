// Check Profender products in database
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function checkProfenderProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Check Profender products
    const profenderProducts = await Product.find({ brand: 'Profender', isActive: true });
    console.log(`📊 Found ${profenderProducts.length} active Profender products:`);
    
    profenderProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - ₹${product.price}`);
    });
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking Profender products:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run check
checkProfenderProducts();