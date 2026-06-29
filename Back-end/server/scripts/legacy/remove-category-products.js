import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

dotenv.config();

async function removeCategoryProducts() {
  try {
    console.log('🗑️  Starting product removal for categories...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ Connected to MongoDB');

    // Get the Lights and Audio categories
    const lightsCategory = await Category.findOne({ slug: 'lights' });
    const audioCategory = await Category.findOne({ slug: 'audio' });

    if (!lightsCategory && !audioCategory) {
      console.log('⚠️  Categories not found, nothing to remove');
      process.exit(0);
    }

    const categoryIds = [];
    if (lightsCategory) {
      categoryIds.push(lightsCategory._id);
      console.log(`\n📦 Found Lights category: ${lightsCategory._id}`);
    }
    if (audioCategory) {
      categoryIds.push(audioCategory._id);
      console.log(`📦 Found Audio category: ${audioCategory._id}`);
    }

    // Delete products in these categories
    console.log('\n💡 Removing products from Lights category...');
    const lightsResult = await Product.deleteMany({ 
      category: lightsCategory?._id 
    });
    console.log(`   🗑️  Deleted ${lightsResult.deletedCount} products`);

    console.log('\n🔊 Removing products from Audio category...');
    const audioResult = await Product.deleteMany({ 
      category: audioCategory?._id 
    });
    console.log(`   🗑️  Deleted ${audioResult.deletedCount} products`);

    // Summary
    const totalDeleted = lightsResult.deletedCount + audioResult.deletedCount;
    
    console.log('\n✨ ====================================');
    console.log('✨ Product removal complete!');
    console.log('✨ ====================================');
    console.log(`\n📈 Summary:`);
    console.log(`   Total products removed: ${totalDeleted}`);
    console.log(`   Lights category products: ${lightsResult.deletedCount || 0}`);
    console.log(`   Audio category products: ${audioResult.deletedCount || 0}`);
    console.log(`\n⚠️  Note: Categories still exist, just emptied of products\n`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error during removal:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

removeCategoryProducts();
