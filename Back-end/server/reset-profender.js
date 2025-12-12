// Reset all Profender products in database
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function resetProfenderProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Count current Profender products
    const currentCount = await Product.countDocuments({ brand: 'Profender' });
    console.log(`📊 Current Profender products in database: ${currentCount}`);
    
    // Soft delete all Profender products
    const result = await Product.updateMany(
      { brand: 'Profender' },
      { isActive: false }
    );
    
    console.log(`🗑️ Soft deleted ${result.modifiedCount} Profender products`);
    
    // Verify reset
    const remainingActive = await Product.countDocuments({ brand: 'Profender', isActive: true });
    console.log(`✅ Remaining active Profender products: ${remainingActive}`);
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error resetting Profender products:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run reset
resetProfenderProducts();