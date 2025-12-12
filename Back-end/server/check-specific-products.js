// Check for specific Profender products
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function checkSpecificProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Check for the specific products mentioned by the user
    console.log('\n🔍 Checking for specific Profender products...');
    
    const specificProducts = [
      "Profender 2 Inch Lift Kit For Hilux",
      "Profender Suspension Set for Mahindra Thar CRDe (Set of 4)"
    ];
    
    for (const productName of specificProducts) {
      const product = await Product.findOne({ 
        brand: 'Profender', 
        name: { $regex: productName, $options: 'i' } 
      });
      
      if (product) {
        console.log(`✅ Found: ${product.name}`);
      } else {
        console.log(`❌ Not found: ${productName}`);
      }
    }
    
    // Also check for products with "Lift Kit" or "Suspension Set" in the name
    console.log('\n🔍 Checking for products with "Lift Kit" or "Suspension Set"...');
    const patternProducts = await Product.find({ 
      brand: 'Profender', 
      $or: [
        { name: { $regex: 'Lift Kit', $options: 'i' } },
        { name: { $regex: 'Suspension Set', $options: 'i' } }
      ]
    });
    
    if (patternProducts.length > 0) {
      console.log(`✅ Found ${patternProducts.length} matching products:`);
      patternProducts.forEach(p => console.log(`   • ${p.name}`));
    } else {
      console.log('❌ No products found matching the patterns');
    }
    
    // Check for lift kit products in our database
    console.log('\n🔍 Checking for lift kit related products...');
    const liftKitProducts = await Product.find({ 
      brand: 'Profender', 
      name: { $regex: 'lift.*kit|kit.*lift', $options: 'i' } 
    });
    
    if (liftKitProducts.length > 0) {
      console.log(`✅ Found ${liftKitProducts.length} lift kit products:`);
      liftKitProducts.forEach(p => console.log(`   • ${p.name}`));
    } else {
      console.log('❌ No lift kit products found');
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking specific products:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

checkSpecificProducts();