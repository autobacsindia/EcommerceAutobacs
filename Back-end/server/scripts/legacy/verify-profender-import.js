import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';

dotenv.config();

async function verifyProfenderImport() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Count products with 'Profender' in the brand field (case insensitive)
    const profenderBrandCount = await Product.countDocuments({ 
      brand: { $regex: /profender/i } 
    });
    console.log('Products with Profender in brand field:', profenderBrandCount);
    
    // Show some sample Profender products
    const sampleProducts = await Product.find({ 
      brand: { $regex: /profender/i } 
    }).limit(10);
    
    console.log('\nSample Profender products:');
    sampleProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - Brand: ${product.brand || 'N/A'}`);
    });
    
    // Also check for products that might have 'Profender' in the name but different brand
    const profenderNameCount = await Product.countDocuments({ 
      name: { $regex: /profender/i },
      brand: { $not: /profender/i } 
    });
    console.log('\nProducts with Profender in name but different brand:', profenderNameCount);
    
    await mongoose.connection.close();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

