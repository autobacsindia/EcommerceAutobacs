#!/usr/bin/env node

/**
 * Script to check category breakdown
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from '../../models/Category.js';

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function checkCategoryBreakdown() {
  try {
    console.log('Checking category breakdown...\n');
    
    const totalCategories = await Category.countDocuments();
    const categoriesWithExternalId = await Category.countDocuments({ externalId: { $exists: true } });
    const categoriesWithoutExternalId = await Category.countDocuments({ externalId: { $exists: false } });
    
    console.log('Category breakdown:');
    console.log('- Total categories:', totalCategories);
    console.log('- Categories with externalId:', categoriesWithExternalId);
    console.log('- Categories without externalId:', categoriesWithoutExternalId);
    
    // List categories without externalId
    if (categoriesWithoutExternalId > 0) {
      console.log('\nCategories without externalId:');
      const catsWithoutExternalId = await Category.find({ externalId: { $exists: false } });
      catsWithoutExternalId.forEach(cat => {
        console.log(`- ${cat.name} (Slug: ${cat.slug})`);
      });
    }
    
  } catch (error) {
    console.error('Error checking category breakdown:', error);
  }
}

checkCategoryBreakdown().then(() => {
  console.log('\nFinished checking category breakdown');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});#!/usr/bin/env node

/**
 * Script to check category breakdown
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from '../../models/Category.js';

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function checkCategoryBreakdown() {
  try {
    console.log('Checking category breakdown...\n');
    
    const totalCategories = await Category.countDocuments();
    const categoriesWithExternalId = await Category.countDocuments({ externalId: { $exists: true } });
    const categoriesWithoutExternalId = await Category.countDocuments({ externalId: { $exists: false } });
    
    console.log('Category breakdown:');
    console.log('- Total categories:', totalCategories);
    console.log('- Categories with externalId:', categoriesWithExternalId);
    console.log('- Categories without externalId:', categoriesWithoutExternalId);
    
    // List categories without externalId
    if (categoriesWithoutExternalId > 0) {
      console.log('\nCategories without externalId:');
      const catsWithoutExternalId = await Category.find({ externalId: { $exists: false } });
      catsWithoutExternalId.forEach(cat => {
        console.log(`- ${cat.name} (Slug: ${cat.slug})`);
      });
    }
    
  } catch (error) {
    console.error('Error checking category breakdown:', error);
  }
}

checkCategoryBreakdown().then(() => {
  console.log('\nFinished checking category breakdown');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});