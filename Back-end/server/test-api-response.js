import express from "express";
import Product from "./models/Product.js";
import mongoose from "mongoose";

async function testApiResponse() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ Connected to MongoDB');

    // Get a sample product with categories
    console.log('\n--- Sample Product with Categories (Raw from DB) ---');
    const productWithCategories = await Product.findOne({ 
      categories: { $exists: true, $not: { $size: 0 } } 
    });
    
    if (productWithCategories) {
      console.log('Product Name:', productWithCategories.name);
      console.log('Product ID:', productWithCategories._id);
      console.log('Raw Categories Field:', productWithCategories.categories);
      console.log('Categories Type:', typeof productWithCategories.categories);
      console.log('Is Array:', Array.isArray(productWithCategories.categories));
    } else {
      console.log('No product with categories found');
    }

    // Get a sample product without categories
    console.log('\n--- Sample Product without Categories (Raw from DB) ---');
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
      console.log('Categories Type:', typeof productWithoutCategories.categories);
      console.log('Is Array:', Array.isArray(productWithoutCategories.categories));
    } else {
      console.log('No product without categories found');
    }

    await mongoose.connection.close();
    console.log('\n✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testApiResponse();