import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function countProducts() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n📊 Counting products...');
    const count = await Product.countDocuments();
    console.log(`Total products in database: ${count}`);
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

countProducts();