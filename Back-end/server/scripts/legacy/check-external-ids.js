import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function checkExternalIds() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🔍 Checking products with/without external IDs...');
    
    // Count products with external IDs
    const withExternalIdCount = await Product.countDocuments({ externalId: { $exists: true } });
    console.log(`Products WITH externalId: ${withExternalIdCount}`);
    
    // Count products without external IDs
    const withoutExternalIdCount = await Product.countDocuments({ externalId: { $exists: false } });
    console.log(`Products WITHOUT externalId: ${withoutExternalIdCount}`);
    
    // Total count
    const totalCount = await Product.countDocuments();
    console.log(`Total products: ${totalCount}`);
    
    // Check a few products with external IDs
    console.log('\n📋 Sample products WITH external IDs:');
    const sampleWithExternalId = await Product.find({ externalId: { $exists: true } }).limit(5);
    sampleWithExternalId.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (External ID: ${product.externalId})`);
    });
    
    // Check a few products without external IDs
    console.log('\n📋 Sample products WITHOUT external IDs:');
    const sampleWithoutExternalId = await Product.find({ externalId: { $exists: false } }).limit(5);
    sampleWithoutExternalId.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (No external ID)`);
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkExternalIds();