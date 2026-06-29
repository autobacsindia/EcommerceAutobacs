import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';

dotenv.config();

async function checkProfenderProducts() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Count products with 'Profender' in the brand field
    const profenderBrandCount = await Product.countDocuments({ brand: { $regex: /profender/i } });
    console.log('Products with Profender in brand field:', profenderBrandCount);
    
    // Count products with 'Profender' in the name
    const profenderNameCount = await Product.countDocuments({ name: { $regex: /profender/i } });
    console.log('Products with Profender in name:', profenderNameCount);
    
    // Show some sample products
    const sampleProducts = await Product.find({ 
      $or: [
        { brand: { $regex: /profender/i } },
        { name: { $regex: /profender/i } }
      ]
    }).limit(10);
    
    console.log('\nSample Profender products:');
    sampleProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - Brand: ${product.brand || 'N/A'}`);
    });
    
    await mongoose.connection.close();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

