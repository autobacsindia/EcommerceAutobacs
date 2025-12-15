import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function listCategories() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n📂 Loading all categories...');
    const categories = await Category.find({});
    
    console.log(`\n📊 Found ${categories.length} categories:`);
    categories.forEach(category => {
      console.log(`- ${category.name} (slug: ${category.slug})${category.parent ? ` -> parent: ${category.parent}` : ''}`);
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listCategories();