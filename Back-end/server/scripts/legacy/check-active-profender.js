// Check active Profender products
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function checkActiveProfenderProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get active Profender products
    const activeProducts = await Product.find({ brand: 'Profender', isActive: true });
    console.log(`\n📊 Found ${activeProducts.length} active Profender products:`);
    
    activeProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking active Profender products:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run check
checkActiveProfenderProducts();