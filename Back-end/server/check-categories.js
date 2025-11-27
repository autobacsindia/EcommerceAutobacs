import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function checkCategories() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Get all categories
    const allCategories = await Category.find({});
    
    console.log('All categories in database:');
    allCategories.forEach(cat => {
      console.log(`- ${cat.name} (${cat._id})`);
    });
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

checkCategories();