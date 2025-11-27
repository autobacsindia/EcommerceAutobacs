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

async function recategorizeAllProducts() {
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
    
    // Get ALL products (not just uncategorized ones)
    const allProducts = await Product.find({});
    
    console.log(`Found ${allProducts.length} total products`);
    
    // Process products in batches
    const batchSize = 50;
    let totalRecategorized = 0;
    
    for (let i = 0; i < allProducts.length; i += batchSize) {
      const batch = allProducts.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allProducts.length/batchSize)}`);
      
      const bulkOps = [];
      
      for (const product of batch) {
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
          
          // Get the ObjectId for the best matching category
          const bestCategoryId = categoryMap[bestCategory];
          
          // Only update if the category would change
          if (bestCategoryId && (!product.category || !product.category.toString || product.category.toString() !== bestCategoryId.toString())) {
            // Add to bulk operations
            bulkOps.push({
              updateOne: {
                filter: { _id: product._id },
                update: { $set: { category: bestCategoryId } }
              }
            });
          }
        }
      }
      
      // Execute bulk update for this batch
      if (bulkOps.length > 0) {
        const result = await Product.bulkWrite(bulkOps);
        totalRecategorized += result.modifiedCount;
        console.log(`  Recategorized ${result.modifiedCount} products in this batch`);
      }
      
      // Add a small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\nSuccessfully recategorized ${totalRecategorized} products`);
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

recategorizeAllProducts();