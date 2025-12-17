// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';
import { connectWithRetry } from './config/db.js';

async function assignProductsToCategories() {
  try {
    // Connect to database
    await connectWithRetry();
    console.log('Connected to database');

    // Find the categories
    const lightsCategory = await Category.findOne({ slug: 'lights' });
    const audioCategory = await Category.findOne({ slug: 'audio' });

    if (!lightsCategory) {
      console.log('Lights category not found');
      return;
    }

    if (!audioCategory) {
      console.log('Audio category not found');
      return;
    }

    console.log(`Found lights category: ${lightsCategory.name} (${lightsCategory._id})`);
    console.log(`Found audio category: ${audioCategory.name} (${audioCategory._id})`);

    // Assign lighting products to the lights category
    // Find products with "light" in their name or tags
    const lightingProducts = await Product.find({
      $or: [
        { name: { $regex: 'light', $options: 'i' } },
        { tags: { $regex: 'light', $options: 'i' } },
        { tags: { $regex: 'LED', $options: 'i' } }
      ],
      categories: { $ne: lightsCategory._id }
    });

    console.log(`Found ${lightingProducts.length} lighting products to assign`);

    // Update lighting products to include the lights category
    let lightsUpdatedCount = 0;
    for (const product of lightingProducts) {
      // Add the lights category to the product's categories array if it's not already there
      if (!product.categories.includes(lightsCategory._id)) {
        product.categories.push(lightsCategory._id);
        await product.save();
        lightsUpdatedCount++;
      }
    }

    console.log(`Assigned ${lightsUpdatedCount} products to the lights category`);

    // Assign audio products to the audio category
    // Find products with "audio" in their tags
    const audioProducts = await Product.find({
      tags: { $regex: 'audio', $options: 'i' },
      categories: { $ne: audioCategory._id }
    });

    console.log(`Found ${audioProducts.length} audio products to assign`);

    // Update audio products to include the audio category
    let audioUpdatedCount = 0;
    for (const product of audioProducts) {
      // Add the audio category to the product's categories array if it's not already there
      if (!product.categories.includes(audioCategory._id)) {
        product.categories.push(audioCategory._id);
        await product.save();
        audioUpdatedCount++;
      }
    }

    console.log(`Assigned ${audioUpdatedCount} products to the audio category`);

    console.log('Product assignment completed successfully!');
  } catch (error) {
    console.error('Error assigning products to categories:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the assignment function
assignProductsToCategories();