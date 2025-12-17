import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';
import { connectWithRetry } from './config/db.js';

async function undoCategoryMapping() {
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

    // Remove lights category from all products
    const lightsProductsResult = await Product.updateMany(
      { categories: lightsCategory._id },
      { $pull: { categories: lightsCategory._id } }
    );

    console.log(`Removed lights category from ${lightsProductsResult.modifiedCount} products`);

    // Remove audio category from all products
    const audioProductsResult = await Product.updateMany(
      { categories: audioCategory._id },
      { $pull: { categories: audioCategory._id } }
    );

    console.log(`Removed audio category from ${audioProductsResult.modifiedCount} products`);

    console.log('Category mapping removal completed successfully!');
  } catch (error) {
    console.error('Error removing category mappings:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the undo function
undoCategoryMapping();