// Simple product synchronization script
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Product = require('../../models/Product.js');

// Load environment variables
dotenv.config();

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    return false;
  }
}

async function checkProductCounts() {
  const isConnected = await connectDB();
  if (!isConnected) {
    process.exit(1);
  }
  
  try {
    // Get current active product count in local database
    const localActiveProductCount = await Product.countDocuments({ isActive: true });
    console.log(`📁 Local active product count: ${localActiveProductCount}`);
    
    // Get total product count in local database
    const localTotalProductCount = await Product.countDocuments();
    console.log(`📁 Local total product count: ${localTotalProductCount}`);
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking product counts:', error);
    if (mongoose.connection.readyState === 1) {
      mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the function
checkProductCounts();