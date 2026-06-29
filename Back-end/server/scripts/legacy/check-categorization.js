import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function checkCategorization() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    const totalProducts = await Product.countDocuments({});
    const productsWithCategory = await Product.countDocuments({ 
      categories: { $exists: true, $ne: null } 
    });
    
    console.log('Total products:', totalProducts);
    console.log('Products with category:', productsWithCategory);
    console.log('Products without category:', totalProducts - productsWithCategory);
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkCategorization();