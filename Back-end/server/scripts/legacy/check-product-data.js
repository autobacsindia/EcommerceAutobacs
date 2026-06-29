import mongoose from "mongoose";
import Product from "../../models/Product.js";
import Category from "../../models/Category.js";

async function checkProductData() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ Connected to MongoDB');

    // Get a sample product with categories
    console.log('\n--- Sample Product with Categories ---');
    const productWithCategories = await Product.findOne({ 
      categories: { $exists: true, $not: { $size: 0 } } 
    }).populate('categories', 'name slug');
    
    if (productWithCategories) {
      console.log('Product Name:', productWithCategories.name);
      console.log('Product ID:', productWithCategories._id);
      console.log('Categories:', productWithCategories.categories.map(cat => ({
        name: cat.name,
        id: cat._id,
        slug: cat.slug
      })));
    } else {
      console.log('No product with categories found');
    }

    // Get a sample product without categories
    console.log('\n--- Sample Product without Categories ---');
    const productWithoutCategories = await Product.findOne({ 
      $or: [
        { categories: { $exists: false } },
        { categories: { $size: 0 } }
      ]
    });
    
    if (productWithoutCategories) {
      console.log('Product Name:', productWithoutCategories.name);
      console.log('Product ID:', productWithoutCategories._id);
      console.log('Categories Field:', productWithoutCategories.categories);
    } else {
      console.log('No product without categories found');
    }

    // Check total counts
    const totalProducts = await Product.countDocuments();
    const productsWithCategories = await Product.countDocuments({ 
      categories: { $exists: true, $not: { $size: 0 } } 
    });
    const productsWithoutCategories = await Product.countDocuments({ 
      $or: [
        { categories: { $exists: false } },
        { categories: { $size: 0 } }
      ]
    });

    console.log('\n--- Summary ---');
    console.log('Total Products:', totalProducts);
    console.log('Product with Categories:', productsWithCategories);
    console.log('Products without Categories:', productsWithoutCategories);

    await mongoose.connection.close();
    console.log('\n✅ Check completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkProductData();