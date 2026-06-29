// Check for King Series products
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function checkKingSeries() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Find King Series products
    const kingSeries = await Product.find({ 
      brand: 'Profender', 
      name: { $regex: 'King Series', $options: 'i' },
      isActive: true 
    });
    
    console.log(`\n🏆 Found ${kingSeries.length} King Series products:`);
    kingSeries.forEach(p => console.log(`- ${p.name}`));
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking King Series products:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run check
checkKingSeries();