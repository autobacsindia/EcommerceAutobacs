import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';
import Category from './models/Category.js';

dotenv.config();

async function analyzeProductCategories() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/autobacs');
    console.log('✅ Connected to MongoDB');

    // Check total product count
    const totalProducts = await Product.countDocuments();
    console.log(`📊 Total products: ${totalProducts}`);

    // Check products with categories field (plural - correct)
    const productsWithCategories = await Product.countDocuments({ 
      categories: { $exists: true, $ne: null, $not: { $size: 0 } } 
    });
    console.log(`✅ Products with proper 'categories' field: ${productsWithCategories}`);

    // Check products without categories field (plural)
    const productsWithoutCategories = await Product.countDocuments({ 
      $or: [
        { categories: { $exists: false } },
        { categories: { $size: 0 } },
        { categories: null }
      ]
    });
    console.log(`❌ Products without proper 'categories' field: ${productsWithoutCategories}`);

    // Check for products that might have the incorrect 'category' field (singular)
    const productsWithSingularCategory = await Product.countDocuments({ 
      category: { $exists: true, $ne: null } 
    });
    console.log(`⚠️  Products with incorrect 'category' field (singular): ${productsWithSingularCategory}`);

    // Sample check for a product with both fields
    const sampleProduct = await Product.findOne({ 
      $and: [
        { categories: { $exists: true } },
        { category: { $exists: true } }
      ]
    }).populate('categories', 'name slug').limit(1);
    
    if (sampleProduct) {
      console.log('\n📋 Sample product with both fields:');
      console.log(`   Name: ${sampleProduct.name}`);
      console.log(`   Categories (plural): ${sampleProduct.categories.length > 0 ? sampleProduct.categories.map(c => c.name).join(', ') : 'None'}`);
      console.log(`   Category (singular): ${sampleProduct.category || 'None'}`);
    }

    // Get some sample products to see the issue
    console.log('\n🔍 Sample products with incorrect category assignment:');
    const sampleProducts = await Product.find({ 
      category: { $exists: true, $ne: null } 
    }).limit(5);
    
    sampleProducts.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} - category field: ${product.category}`);
    });

    // Get sample products with proper categories field
    console.log('\n✅ Sample products with proper categories assignment:');
    const properSampleProducts = await Product.find({ 
      categories: { $exists: true, $ne: null, $not: { $size: 0 } } 
    }).populate('categories', 'name slug').limit(5);
    
    properSampleProducts.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} - categories: ${product.categories.map(c => c.name).join(', ')}`);
    });

    // Check for duplicate products by name
    console.log('\n🔍 Checking for duplicate products by name...');
    const duplicateCheck = await Product.aggregate([
      {
        $group: {
          _id: { $toLower: { $trim: { input: "$name" } } },
          count: { $sum: 1 },
          products: { $push: { id: "$_id", name: "$name", categories: "$categories" } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    console.log(`   Found ${duplicateCheck.length} duplicate product names:`);
    duplicateCheck.slice(0, 10).forEach((dup, index) => {
      console.log(`   ${index + 1}. "${dup._id}" - ${dup.count} occurrences`);
      if (dup.count <= 5) { // Only show details for small groups
        dup.products.forEach((prod, idx) => {
          const catNames = prod.categories && Array.isArray(prod.categories) ? 
            prod.categories.map(c => c.name || c).join(', ') : 'None';
          console.log(`      ${idx + 1}. ID: ${prod.id} - Categories: ${catNames}`);
        });
      }
    });

    await mongoose.connection.close();
    console.log('\n✅ Analysis completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

analyzeProductCategories();