// Check Profender products by specific categories
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function checkProfenderByCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Categories/slugs mentioned in the request
    const relevantCategories = [
      'Lift Kit', 'Motor Vehicle Suspension Parts', 'Suspension Kit', 
      'Upper Control Arms', 'Exterior', 'Performance', 'Suspension',
      'Coil Suspension', 'Nitro Gas Shock Absorbers', 'Nitro Gas Suspension'
    ];
    
    console.log('🔍 Searching for Profender products in relevant categories...');
    
    // Find Profender products that match these categories
    const profenderProducts = await Product.find({ 
      brand: 'Profender',
      isActive: true,
      $or: [
        { name: { $regex: 'lift.*kit|suspension|performance|exterior|control arm|coil|nitro gas', $options: 'i' } },
        { 'category.name': { $in: relevantCategories } }
      ]
    });
    
    console.log(`\n📊 Found ${profenderProducts.length} Profender products in relevant categories:`);
    
    profenderProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
      if (product.category) {
        console.log(`   Category: ${typeof product.category === 'object' ? product.category.name : product.category}`);
      }
    });
    
    // Check specifically for the King Series suspension products
    console.log('\n🔍 Checking for King Series suspension products...');
    const kingSeriesProducts = await Product.find({ 
      brand: 'Profender',
      isActive: true,
      name: { $regex: 'king.*series.*suspension|suspension.*king.*series', $options: 'i' }
    });
    
    console.log(`\n🏆 Found ${kingSeriesProducts.length} King Series suspension products:`);
    kingSeriesProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking Profender products by categories:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run check
checkProfenderByCategories();