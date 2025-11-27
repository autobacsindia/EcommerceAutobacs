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

async function analyzeAndRecategorize() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Get the standard categories
    const standardCategories = await Category.find({
      name: { $in: Object.keys(STANDARD_CATEGORY_KEYWORDS) }
    });
    
    const categoryMap = {};
    standardCategories.forEach(cat => {
      categoryMap[cat.name] = cat._id;
    });
    
    console.log('Standard categories found:', Object.keys(categoryMap));
    
    // Get all products with their current categories
    const products = await Product.find({}).populate('category');
    
    console.log(`Analyzing ${products.length} products for potential re-categorization...`);
    
    let recategorizedCount = 0;
    const bulkOps = [];
    
    for (const product of products) {
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
      
      // If no categories matched, skip this product
      if (Object.keys(categoryScores).length === 0) {
        continue;
      }
      
      // Find the category with the highest score
      const bestCategory = Object.keys(categoryScores).reduce((a, b) => 
        categoryScores[a] > categoryScores[b] ? a : b
      );
      
      // Get the ObjectId for the best matching category
      const bestCategoryId = categoryMap[bestCategory];
      
      // Check if the product's current category matches the best category
      if (product.category && product.category._id.toString() !== bestCategoryId.toString()) {
        // The product should be re-categorized
        console.log(`\nProduct: ${product.name}`);
        console.log(`  Current category: ${product.category ? product.category.name : 'None'}`);
        console.log(`  Suggested category: ${bestCategory}`);
        console.log(`  Confidence score: ${categoryScores[bestCategory]}`);
        
        // Add to bulk operations
        bulkOps.push({
          updateOne: {
            filter: { _id: product._id },
            update: { $set: { category: bestCategoryId } }
          }
        });
        
        recategorizedCount++;
      }
    }
    
    console.log(`\nFound ${recategorizedCount} products that could be re-categorized.`);
    
    // Execute bulk update if there are operations
    if (bulkOps.length > 0 && bulkOps.length <= 20) {
      console.log('\nRe-categorizing products...');
      const result = await Product.bulkWrite(bulkOps);
      console.log(`Successfully re-categorized ${result.modifiedCount} products.`);
    } else if (bulkOps.length > 20) {
      console.log(`\nToo many products (${bulkOps.length}) to re-categorize at once. Would need to process in smaller batches.`);
    } else {
      console.log('\nNo products need re-categorization.');
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

analyzeAndRecategorize();