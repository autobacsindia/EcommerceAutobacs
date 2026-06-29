import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from '../../models/Category.js';
import categoryMappingService from '../../services/categoryMappingService.js';

// Load environment variables
dotenv.config();

async function debugCategoryMapping() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Initialize category mapping service
    console.log('\n🔍 Initializing category mapping service...');
    await categoryMappingService.initialize();
    const stats = categoryMappingService.getStatistics();
    console.log(`✅ Initialized with ${stats.totalCategories} categories`);
    
    // Test specific categories from the failed product
    console.log('\n🧪 Testing specific categories from failed product:');
    const testCategories = ['Exterior', 'Exterior Accessories', 'Stepney Cover'];
    
    for (const categoryName of testCategories) {
      console.log(`\n🔍 Looking for category: "${categoryName}"`);
      const category = categoryMappingService.findCategory(categoryName);
      if (category) {
        console.log(`   ✅ Found: ${category.name} (${category.slug}) - ID: ${category._id}`);
      } else {
        console.log(`   ❌ Not found`);
      }
    }
    
    // Test all available categories
    console.log('\n📋 All available categories in database:');
    const categories = await Category.find({}, 'name slug');
    categories.forEach((category, index) => {
      console.log(`${index + 1}. ${category.name} (${category.slug})`);
    });
    
    // Test specific category lookups
    console.log('\n🔍 Testing specific lookups:');
    const specificTests = [
      'Exterior',
      'exterior',
      'Exterior Accessories',
      'exterior accessories',
      'Stepney Cover',
      'stepney cover'
    ];
    
    for (const testName of specificTests) {
      console.log(`\n🔍 Testing lookup for: "${testName}"`);
      const result = categoryMappingService.findCategory(testName);
      if (result) {
        console.log(`   ✅ Found: ${result.name} (${result.slug}) - ID: ${result._id}`);
      } else {
        console.log(`   ❌ Not found`);
      }
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

debugCategoryMapping();