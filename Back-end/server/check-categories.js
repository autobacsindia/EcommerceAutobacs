// Check categories in database
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function checkCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('🔍 Checking categories in database...');
    const categories = await Category.find({});
    console.log(`📊 Found ${categories.length} categories:`);
    
    categories.forEach((category, index) => {
      console.log(`${index + 1}. ${category.name} (${category.slug})`);
    });
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking categories:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

checkCategories();