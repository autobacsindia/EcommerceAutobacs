import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Define the standard category keywords for categorization
const STANDARD_CATEGORY_KEYWORDS = {
  'ACCESSORIES': ['accessory', 'accessories', 'cover', 'mat', 'liner', 'organizer', 'bag', 'case', 'rack', 'storage'],
  'EXTERIOR': ['bumper', 'spoiler', 'wing', 'body', 'paint', 'wrap', 'decal', 'sticker', 'fender', 'hood', 'grill'],
  'INTERIOR': ['seat', 'dashboard', 'console', 'steering', 'wheel', 'pedal', 'gauge', 'carpet', 'upholstery', 'armrest'],
  'PERFORMANCE': ['engine', 'turbo', 'supercharger', 'exhaust', 'intake', 'throttle', 'chip', 'tuner', 'boost', 'performance'],
  'BODYKIT': ['bodykit', 'body kit', 'widebody', 'skirt', 'lip', 'kit', 'conversion'],
  'SUSPENSION': ['suspension', 'coilover', 'spring', 'damper', 'strut', 'shock', 'coil', 'lift'],
  'LIGHTS': ['light', 'led', 'bulb', 'headlight', 'taillight', 'fog', 'angel', 'halo', 'lamp', 'drl'],
  'AUDIO': ['audio', 'speaker', 'subwoofer', 'amp', 'amplifier', 'headunit', 'stereo', 'sound', 'sub', 'head unit']
};

async function analyzeCategorization() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Get all categories
    const standardCategories = await Category.find({});
    
    const categoryMap = {};
    standardCategories.forEach(cat => {
      categoryMap[cat.name] = cat._id;
    });
    
    console.log('Standard categories found:', Object.keys(categoryMap));
    
    // Get all products with their current categories
    const products = await Product.find({}).populate('categories');
    
    console.log(`Analyzing ${products.length} products for categorization...`);
    
    // Count products by current category
    const categoryCounts = {};
    const standardCategoryCounts = {};
    
    for (const product of products) {
      const currentCategory = product.categories && product.categories.length > 0 ? product.categories[0].name : 'Uncategorized';
      categoryCounts[currentCategory] = (categoryCounts[currentCategory] || 0) + 1;
      
      // Combine product attributes for analysis
      const productText = [
        product.name || '',
        product.description || '',
        product.shortDescription || '',
        ...(product.tags || []),
        ...(product.features || [])
      ].join(' ').toLowerCase();
      
      // Score each standard category based on keyword matches
      const categoryScores = {};
      
      for (const [categoryName, keywords] of Object.entries(STANDARD_CATEGORY_KEYWORDS)) {
        let score = 0;
        
        for (const keyword of keywords) {
          // Count occurrences of each keyword (case insensitive)
          const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
          const matches = productText.match(regex);
          if (matches) {
            score += matches.length;
          }
        }
        
        // Only consider categories with at least one match
        if (score > 0) {
          categoryScores[categoryName] = score;
        }
      }
      
      // Find the category with the highest score (if any)
      if (Object.keys(categoryScores).length > 0) {
        const bestCategory = Object.keys(categoryScores).reduce((a, b) => 
          categoryScores[a] > categoryScores[b] ? a : b
        );
        
        standardCategoryCounts[bestCategory] = (standardCategoryCounts[bestCategory] || 0) + 1;
      } else {
        standardCategoryCounts['Uncategorized'] = (standardCategoryCounts['Uncategorized'] || 0) + 1;
      }
    }
    
    console.log('\n--- Current Category Distribution ---');
    Object.entries(categoryCounts)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`${category}: ${count}`);
      });
    
    console.log('\n--- Recommended Category Distribution ---');
    Object.entries(standardCategoryCounts)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`${category}: ${count}`);
      });
    
    // Show some examples of products that might benefit from re-categorization
    console.log('\n--- Sample Products That Might Need Re-categorization ---');
    let sampleCount = 0;
    
    for (const product of products) {
      if (sampleCount >= 10) break;
      
      // Combine product attributes for analysis
      const productText = [
        product.name || '',
        product.description || '',
        product.shortDescription || '',
        ...(product.tags || []),
        ...(product.features || [])
      ].join(' ').toLowerCase();
      
      // Score each standard category based on keyword matches
      const categoryScores = {};
      
      for (const [categoryName, keywords] of Object.entries(STANDARD_CATEGORY_KEYWORDS)) {
        let score = 0;
        
        for (const keyword of keywords) {
          // Count occurrences of each keyword (case insensitive)
          const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
          const matches = productText.match(regex);
          if (matches) {
            score += matches.length;
          }
        }
        
        // Only consider categories with at least one match
        if (score > 0) {
          categoryScores[categoryName] = score;
        }
      }
      
      // Find the category with the highest score (if any)
      if (Object.keys(categoryScores).length > 0) {
        const bestCategory = Object.keys(categoryScores).reduce((a, b) => 
          categoryScores[a] > categoryScores[b] ? a : b
        );
        
        // Check if the product's current category matches the best category
        const currentCategory = product.categories && product.categories.length > 0 ? product.categories[0] : null;
        if (!currentCategory || currentCategory.name !== bestCategory) {
          console.log(`\nProduct: ${product.name}`);
          console.log(`  Current category: ${currentCategory ? currentCategory.name : 'None'}`);
          console.log(`  Suggested category: ${bestCategory}`);
          console.log(`  Confidence score: ${categoryScores[bestCategory]}`);
          sampleCount++;
        }
      }
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

analyzeCategorization();