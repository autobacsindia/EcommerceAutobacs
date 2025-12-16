// Verify that products have been properly categorized
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function verifyCategorization() {
  try {
    console.log('🔍 Verifying product categorization...');
    
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Get total product count
    const totalProducts = await Product.countDocuments();
    console.log(`📊 Total products in database: ${totalProducts}`);
    
    // Get products with categories
    const productsWithCategories = await Product.countDocuments({ categories: { $exists: true, $ne: [] } });
    console.log(`🏷️  Products with categories assigned: ${productsWithCategories}`);
    
    // Get products without categories
    const productsWithoutCategories = await Product.countDocuments({ $or: [{ categories: { $exists: false } }, { categories: { $size: 0 } }] });
    console.log(`❌ Products without categories: ${productsWithoutCategories}`);
    
    // Show sample products with their categories
    console.log('\n📦 Sample products with categories:');
    const sampleProducts = await Product.find({ categories: { $exists: true, $ne: [] } })
      .populate('categories')
      .limit(10);
    
    sampleProducts.forEach((product, index) => {
      const categoryNames = product.categories.map(cat => cat.name);
      console.log(`   ${index + 1}. ${product.name}`);
      console.log(`      Categories: ${categoryNames.join(', ')}`);
    });
    
    // Get category statistics
    console.log('\n📂 Category Statistics:');
    const totalCategories = await Category.countDocuments();
    console.log(`   Total categories: ${totalCategories}`);
    
    const categoriesWithProducts = await Category.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'categories',
          as: 'products'
        }
      },
      {
        $match: {
          'products.0': { $exists: true }
        }
      },
      {
        $project: {
          name: 1,
          productCount: { $size: '$products' }
        }
      },
      {
        $sort: { productCount: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    console.log('   Top categories by product count:');
    categoriesWithProducts.forEach((category, index) => {
      console.log(`      ${index + 1}. ${category.name}: ${category.productCount} products`);
    });
    
    await mongoose.connection.close();
    console.log('\n✅ Verification completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifyCategorization();