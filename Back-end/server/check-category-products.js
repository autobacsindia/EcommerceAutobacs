import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';
import Category from './models/Category.js';

dotenv.config();

async function checkCategoryProducts() {
  try {
    console.log('🔍 Checking products in Lights and Audio categories...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ Connected to MongoDB\n');

    // Get the categories
    const lightsCategory = await Category.findOne({ slug: 'lights' });
    const audioCategory = await Category.findOne({ slug: 'audio' });

    if (!lightsCategory && !audioCategory) {
      console.log('❌ Categories not found!');
      process.exit(1);
    }

    if (lightsCategory) {
      console.log(`📦 Lights category ID: ${lightsCategory._id}`);
      const lightsProducts = await Product.find({ category: lightsCategory._id });
      console.log(`   📊 Products found: ${lightsProducts.length}\n`);
      
      if (lightsProducts.length > 0) {
        console.log('   Products in Lights category:');
        lightsProducts.forEach(p => {
          console.log(`      - ${p.name} (${p.slug})`);
        });
        console.log('');
      }
    }

    if (audioCategory) {
      console.log(`📦 Audio category ID: ${audioCategory._id}`);
      const audioProducts = await Product.find({ category: audioCategory._id });
      console.log(`   📊 Products found: ${audioProducts.length}\n`);
      
      if (audioProducts.length > 0) {
        console.log('   Products in Audio category:');
        audioProducts.forEach(p => {
          console.log(`      - ${p.name} (${p.slug})`);
        });
        console.log('');
      }
    }

    console.log('✨ ====================================');
    console.log('✨ Check complete!');
    console.log('✨ ====================================\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

checkCategoryProducts();
