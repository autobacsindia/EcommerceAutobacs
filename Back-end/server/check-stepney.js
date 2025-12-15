import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function checkStepneyCategories() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🔍 Searching for Stepney categories...');
    const stepneyCategories = await Category.find({ 
      name: { $regex: 'Stepney', $options: 'i' } 
    });
    
    if (stepneyCategories.length > 0) {
      console.log(`\n📊 Found ${stepneyCategories.length} Stepney categories:`);
      stepneyCategories.forEach(category => {
        console.log(`- ${category.name} (slug: ${category.slug})`);
      });
    } else {
      console.log('❌ No Stepney categories found');
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkStepneyCategories();