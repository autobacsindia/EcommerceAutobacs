// Check Profender product categories
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function checkProfenderCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('🔍 Checking Profender product categories...');
    
    // Get all Profender products with their categories
    const profenderProducts = await Product.find({ brand: 'Profender' })
      .populate('categories', 'name slug')
      .sort({ name: 1 });
    
    console.log(`📊 Found ${profenderProducts.length} Profender products`);
    
    // Show category distribution
    console.log('\n📊 Category Distribution:');
    const categoryCounts = {};
    const productCategories = {};
    
    profenderProducts.forEach(product => {
      const categoryName = product.category ? product.category.name : 'Uncategorized';
      categoryCounts[categoryName] = (categoryCounts[categoryName] || 0) + 1;
      
      // Track which products belong to which categories
      if (!productCategories[categoryName]) {
        productCategories[categoryName] = [];
      }
      productCategories[categoryName].push(product.name);
    });
    
    // Sort categories by count (descending)
    const sortedCategories = Object.entries(categoryCounts)
      .sort(([,a], [,b]) => b - a);
    
    sortedCategories.forEach(([category, count]) => {
      console.log(`\n📁 ${category}: ${count} products`);
      // Show first 3 products in this category
      const products = productCategories[category];
      const displayProducts = products.slice(0, 3);
      displayProducts.forEach(product => {
        console.log(`   • ${product}`);
      });
      if (products.length > 3) {
        console.log(`   ... and ${products.length - 3} more`);
      }
    });
    
    // Show total unique categories
    console.log(`\n📈 Total unique categories: ${Object.keys(categoryCounts).length}`);
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking Profender categories:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

checkProfenderCategories();