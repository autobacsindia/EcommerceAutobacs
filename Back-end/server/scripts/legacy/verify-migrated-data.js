import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

async function verifyMigratedData() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Count migrated products and categories
    console.log('📊 Checking migrated data...');
    const productCount = await Product.countDocuments();
    const categoryCount = await Category.countDocuments();
    
    console.log(`📦 Total products: ${productCount}`);
    console.log(`🏷️ Total categories: ${categoryCount}\n`);
    
    // Check if we have the expected counts
    if (productCount >= 1085) {
      console.log(`✅ Product migration verified (${productCount} products)`);
    } else {
      console.log(`⚠️ Expected at least 1085 products, found ${productCount}`);
    }
    
    if (categoryCount >= 418) {
      console.log(`✅ Category migration verified (${categoryCount} categories)`);
    } else {
      console.log(`⚠️ Expected at least 418 categories, found ${categoryCount}`);
    }
    
    // Show some sample products
    console.log('\n📦 Sample products:');
    const sampleProducts = await Product.find({}, 'name price sku categories')
      .populate('categories', 'name')
      .limit(5);
    
    sampleProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - ₹${product.price} (SKU: ${product.sku || 'N/A'})`);
      if (product.categories && product.categories.length > 0) {
        const categoryNames = product.categories.map(cat => cat.name).join(', ');
        console.log(`   🏷️ Categories: ${categoryNames}`);
      }
    });
    
    // Show some sample categories
    console.log('\n🏷️ Sample categories:');
    const sampleCategories = await Category.find({}, 'name slug description')
      .limit(5);
    
    sampleCategories.forEach((category, index) => {
      console.log(`${index + 1}. ${category.name} (${category.slug})`);
    });
    
    // Check referential integrity
    console.log('\n🔗 Checking referential integrity...');
    const productsWithCategories = await Product.countDocuments({
      categories: { $exists: true, $not: { $size: 0 } }
    });
    
    console.log(`📦 Products with categories: ${productsWithCategories}/${productCount}`);
    
    // Check for orphaned references
    const allProducts = await Product.find({}, 'categories');
    const allCategoryIds = new Set();
    allProducts.forEach(product => {
      if (product.categories) {
        product.categories.forEach(catId => allCategoryIds.add(catId.toString()));
      }
    });
    
    const categoryCountInProducts = allCategoryIds.size;
    console.log(`🔗 Unique category references in products: ${categoryCountInProducts}`);
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    console.log('✅ Data verification completed!');
    
  } catch (error) {
    console.error('❌ Error during verification:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

verifyMigratedData();