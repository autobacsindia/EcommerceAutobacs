// Analyze current category structure and mapping
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/Category.js';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function analyzeCategoryStructure() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get all categories
    const categories = await Category.find({}).sort({ name: 1 });
    console.log(`\n📊 Total categories in database: ${categories.length}`);
    
    // Show category hierarchy
    console.log('\n📂 Category Hierarchy:');
    const topLevelCategories = categories.filter(cat => !cat.parent);
    const childCategories = categories.filter(cat => cat.parent);
    
    console.log(`\n🏛️ Top-level categories (${topLevelCategories.length}):`);
    topLevelCategories.forEach((cat, index) => {
      console.log(`   ${index + 1}. ${cat.name} (slug: ${cat.slug})`);
    });
    
    console.log(`\n🌳 Child categories (${childCategories.length}):`);
    for (const cat of childCategories) {
      const parent = await Category.findById(cat.parent);
      console.log(`   • ${cat.name} (slug: ${cat.slug}) → Parent: ${parent ? parent.name : 'Unknown'}`);
    }
    
    // Show product-category mapping
    console.log('\n🔗 Product-Category Mapping:');
    const products = await Product.find({ brand: 'Profender' })
      .populate('category', 'name slug')
      .sort({ name: 1 });
    
    console.log(`\n📦 Profender products (${products.length}):`);
    const categoryProductCount = {};
    
    products.forEach(product => {
      const categoryName = product.category ? product.category.name : 'Uncategorized';
      if (!categoryProductCount[categoryName]) {
        categoryProductCount[categoryName] = [];
      }
      categoryProductCount[categoryName].push(product.name);
    });
    
    Object.entries(categoryProductCount).forEach(([category, productNames]) => {
      console.log(`\n📁 ${category}: ${productNames.length} products`);
      productNames.slice(0, 3).forEach(name => {
        console.log(`   • ${name}`);
      });
      if (productNames.length > 3) {
        console.log(`   ... and ${productNames.length - 3} more`);
      }
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error analyzing category structure:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

analyzeCategoryStructure();