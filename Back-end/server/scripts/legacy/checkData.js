import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Product from "../../models/Product.js";
import Category from "../../models/Category.js";
import { connectWithRetry } from "../../config/db.js";

async function checkData() {
  try {
    // Connect to database
    await connectWithRetry();
    
    // Count documents
    const productCount = await Product.countDocuments();
    const categoryCount = await Category.countDocuments();
    
    console.log('Products:', productCount);
    console.log('Categories:', categoryCount);
    
    // Get a sample of products to see structure
    if (productCount > 0) {
      const sampleProducts = await Product.find({}).limit(5).populate('categories', 'name slug');
      console.log('\nSample Products:');
      sampleProducts.forEach(product => {
        console.log(`- ${product.name} (${product.categories.map(cat => cat.name).join(', ')})`);
      });
    }
    
    // Get a sample of categories
    if (categoryCount > 0) {
      const sampleCategories = await Category.find({}).limit(10).sort({ name: 1 });
      console.log('\nSample Categories:');
      sampleCategories.forEach(category => {
        console.log(`- ${category.name} (${category.slug})`);
      });
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error checking data:', error.message);
    process.exit(1);
  }
}

checkData();