// Find products similar to what user is looking for
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function findSimilarProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🔍 Searching for products that might match user requirements...');
    
    // Look for products that might be lift kits or suspension sets
    const potentialProducts = await Product.find({ 
      brand: 'Profender',
      $or: [
        { name: { $regex: 'lift', $options: 'i' } },
        { name: { $regex: 'suspension', $options: 'i' } },
        { name: { $regex: 'kit', $options: 'i' } },
        { name: { $regex: 'conversion', $options: 'i' } },
        { name: { $regex: 'upgrade', $options: 'i' } }
      ]
    }).sort({ name: 1 });
    
    console.log(`\n📊 Found ${potentialProducts.length} potential products:`);
    
    potentialProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
    });
    
    // Check if we have any products with "2 inch" in the name
    console.log('\n🔍 Checking for products with "2 inch" or "2-inch":');
    const inchProducts = await Product.find({ 
      brand: 'Profender',
      $or: [
        { name: { $regex: '2 inch', $options: 'i' } },
        { name: { $regex: '2-inch', $options: 'i' } }
      ]
    });
    
    if (inchProducts.length > 0) {
      console.log(`✅ Found ${inchProducts.length} products with "2 inch":`);
      inchProducts.forEach(p => console.log(`   • ${p.name}`));
    } else {
      console.log('❌ No products found with "2 inch"');
    }
    
    // Check for Mahindra Thar related products
    console.log('\n🔍 Checking for Mahindra Thar related products:');
    const tharProducts = await Product.find({ 
      brand: 'Profender',
      name: { $regex: 'thar', $options: 'i' }
    });
    
    if (tharProducts.length > 0) {
      console.log(`✅ Found ${tharProducts.length} Mahindra Thar products:`);
      tharProducts.forEach(p => console.log(`   • ${p.name}`));
    } else {
      console.log('❌ No Mahindra Thar products found');
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error finding similar products:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

findSimilarProducts();