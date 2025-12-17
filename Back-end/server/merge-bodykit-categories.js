import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';
import Category from './models/Category.js';
import { connectWithRetry } from './config/db.js';

// Load environment variables
dotenv.config();

async function mergeBodyKitCategories() {
  try {
    // Connect to database
    await connectWithRetry();
    console.log('Connected to database');

    // Find the categories
    const singularBodyKitCategory = await Category.findOne({ slug: 'body-kit' });
    const pluralBodyKitCategory = await Category.findOne({ slug: 'body-kits' });

    if (!singularBodyKitCategory) {
      console.log('Singular "body-kit" category not found');
      return;
    }

    if (!pluralBodyKitCategory) {
      console.log('Plural "body-kits" category not found');
      return;
    }

    console.log(`Found singular category: ${singularBodyKitCategory.name} (${singularBodyKitCategory._id})`);
    console.log(`Found plural category: ${pluralBodyKitCategory.name} (${pluralBodyKitCategory._id})`);

    // Update all products that reference the singular category to reference the plural category
    const result = await Product.updateMany(
      { categories: singularBodyKitCategory._id },
      { $set: { "categories.$[elem]": pluralBodyKitCategory._id } },
      { arrayFilters: [{ elem: singularBodyKitCategory._id }] }
    );

    console.log(`Updated ${result.modifiedCount} products to use the plural category`);

    // Delete the singular category
    await Category.deleteOne({ _id: singularBodyKitCategory._id });
    console.log('Deleted singular "body-kit" category');

    // Update the plural category name to be consistent
    await Category.updateOne(
      { _id: pluralBodyKitCategory._id },
      { $set: { name: 'Body Kits', description: 'Complete body kits and styling packages' } }
    );
    console.log('Updated plural category name and description');

    console.log('Category merge completed successfully!');
  } catch (error) {
    console.error('Error merging categories:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the merge function
mergeBodyKitCategories();