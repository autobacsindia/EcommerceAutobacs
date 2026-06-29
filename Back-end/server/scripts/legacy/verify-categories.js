// Verify all categories from live site exist in database
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from '../../models/Category.js';
import fs from 'fs';

// Load environment variables
dotenv.config();

async function verifyCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Read the complete WP data
    const wpData = JSON.parse(fs.readFileSync('complete-wp-data.json', 'utf8'));
    const liveSiteCategories = wpData.allCategories;
    
    console.log(`📊 Live site has ${liveSiteCategories.length} categories`);
    
    // Check which categories exist in our database
    const existingCategories = [];
    const missingCategories = [];
    
    for (const categoryName of liveSiteCategories) {
      const category = await Category.findOne({ 
        $or: [
          { name: categoryName },
          { slug: categoryName.toLowerCase().replace(/\s+/g, '-') }
        ]
      });
      
      if (category) {
        existingCategories.push(categoryName);
      } else {
        missingCategories.push(categoryName);
      }
    }
    
    console.log(`\n✅ Existing categories in database: ${existingCategories.length}`);
    console.log(`❌ Missing categories: ${missingCategories.length}`);
    
    if (missingCategories.length > 0) {
      console.log('\n📋 Missing categories:');
      missingCategories.forEach((cat, index) => {
        console.log(`   ${index + 1}. ${cat}`);
      });
    }
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error verifying categories:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

verifyCategories();