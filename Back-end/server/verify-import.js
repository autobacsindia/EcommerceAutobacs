import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

dotenv.config();

async function verifyImport() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Get all unique brands in the database
    const allBrands = await Product.distinct('brand', { brand: { $exists: true, $ne: null, $ne: '' } });
    console.log(`\nTotal unique brands in database: ${allBrands.length}`);
    console.log('Brands:', allBrands);
    
    // Check for any products that might have 'Profender' in the name
    const profenderNameProducts = await Product.find({ 
      name: { $regex: /profender/i } 
    }).limit(10);
    
    console.log(`\nProducts with 'profender' in name: ${profenderNameProducts.length}`);
    profenderNameProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - Brand: ${product.brand || 'N/A'}`);
    });
    
    // Check for products with Profender as brand
    const profenderProducts = await Product.find({ brand: { $regex: /profender/i } });
    console.log(`\nProducts with 'profender' in brand: ${profenderProducts.length}`);
    if (profenderProducts.length > 0) {
      console.log('Sample Profender products:');
      profenderProducts.slice(0, 5).forEach((product, index) => {
        console.log(`${index + 1}. ${product.name} - Brand: ${product.brand}`);
      });
    }
    
    // Check recent products (limit to 10)
    const recentProducts = await Product.find({})
      .sort({ createdAt: -1 })
      .limit(10);
    
    console.log(`\nRecent products (10):`);
    recentProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - Brand: ${product.brand || 'N/A'}`);
    });
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error checking import data:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

