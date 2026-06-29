import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

// Test the incremental import by checking product count
async function testIncrementalImport() {
  console.log('🔍 Testing incremental import functionality...');
  
  try {
    // Connect to database
    await connectToDatabase();
    
    // Get current product count
    const productCount = await Product.countDocuments();
    console.log(`📊 Current product count in database: ${productCount}`);
    
    // Get sample products
    const sampleProducts = await Product.find({}).limit(5);
    console.log('\n📦 Sample products in database:');
    sampleProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} | SKU: ${product.sku || 'N/A'} | Price: ${product.price || 'N/A'}`);
    });
    
    // Get products by brand
    const profenderCount = await Product.countDocuments({ brand: 'Profender' });
    console.log(`\n🏷️  Profender products: ${profenderCount}`);
    
    // Get products by category
    const categoryStats = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      {
        $project: {
          categoryName: { $arrayElemAt: ['$categoryInfo.name', 0] },
          count: 1
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    console.log('\n📂 Category distribution:');
    categoryStats.slice(0, 10).forEach(stat => {
      console.log(`   ${stat.categoryName || 'Uncategorized'}: ${stat.count} products`);
    });
    
    await mongoose.connection.close();
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the test
testIncrementalImport();