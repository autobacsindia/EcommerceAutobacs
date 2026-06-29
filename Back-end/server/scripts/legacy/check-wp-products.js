import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function checkWPProducts() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🔍 Checking products with WP- prefixed SKUs...');
    
    // Count products with WP- prefixed SKUs
    const wpProductCount = await Product.countDocuments({ sku: { $regex: '^WP-' } });
    console.log(`Products with WP- prefixed SKUs: ${wpProductCount}`);
    
    // Count products without WP- prefixed SKUs
    const nonWPProductCount = await Product.countDocuments({ sku: { $not: { $regex: '^WP-' } } });
    console.log(`Products without WP- prefixed SKUs: ${nonWPProductCount}`);
    
    // Total count
    const totalCount = await Product.countDocuments();
    console.log(`Total products: ${totalCount}`);
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkWPProducts();