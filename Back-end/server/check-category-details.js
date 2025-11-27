import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function checkCategoryDetails() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Get all categories
    const categories = await Category.find({});
    console.log('Total categories:', categories.length);
    console.log('Categories:');
    categories.forEach(cat => {
      console.log(`- ${cat.name} (${cat._id})`);
    });
    
    console.log('\n--- Sample Products ---');
    
    // Get a few sample products with their categories populated
    const sampleProducts = await Product.find({}).limit(10).populate('category');
    
    sampleProducts.forEach((product, index) => {
      console.log(`\n${index + 1}. ${product.name}`);
      console.log(`   Category: ${product.category ? product.category.name : 'None'} (${product.category ? product.category._id : 'None'})`);
      console.log(`   Description preview: ${product.description.substring(0, 50)}...`);
    });
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkCategoryDetails();