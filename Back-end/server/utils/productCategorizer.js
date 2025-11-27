import Category from '../models/Category.js';

// Define category keywords based on the design document
const CATEGORY_KEYWORDS = {
  'ACCESSORIES': ['accessory', 'accessories', 'cover', 'mat', 'liner', 'organizer', 'bag', 'case'],
  'EXTERIOR': ['bumper', 'spoiler', 'wing', 'body', 'paint', 'wrap', 'decal', 'sticker'],
  'INTERIOR': ['seat', 'dashboard', 'console', 'steering', 'wheel', 'pedal', 'gauge', 'carpet'],
  'PERFORMANCE': ['engine', 'turbo', 'supercharger', 'exhaust', 'intake', 'throttle', 'chip', 'tuner'],
  'BODYKIT': ['bodykit', 'body kit', 'widebody', 'fender', 'skirt', 'bumper', 'lip'],
  'SUSPENSION': ['suspension', 'coilover', 'spring', 'damper', 'strut', 'shock'],
  'LIGHTS': ['light', 'led', 'bulb', 'headlight', 'taillight', 'fog', 'angel', 'halo'],
  'AUDIO': ['audio', 'speaker', 'subwoofer', 'amp', 'amplifier', 'headunit', 'stereo', 'sound']
};

/**
 * Categorize a product based on its attributes
 * @param {Object} product - Product object to categorize
 * @returns {ObjectId|null} Category ID or null if no match found
 */
async function categorizeProduct(product) {
  try {
    // Get all active categories from database
    const categories = await Category.find({ isActive: true });
    
    if (!categories || categories.length === 0) {
      console.warn('No categories found in database');
      return null;
    }
    
    // Create a map of category names to IDs
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.name.toUpperCase()] = cat._id;
    });
    
    // Combine product attributes for analysis
    const productText = [
      product.name || '',
      product.description || '',
      product.shortDescription || '',
      ...(product.tags || []),
      ...(product.features || [])
    ].join(' ').toLowerCase();
    
    // Score each category based on keyword matches
    const categoryScores = {};
    
    for (const [categoryName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
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
    
    // If no categories matched, return null
    if (Object.keys(categoryScores).length === 0) {
      return null;
    }
    
    // Find the category with the highest score
    const bestCategory = Object.keys(categoryScores).reduce((a, b) => 
      categoryScores[a] > categoryScores[b] ? a : b
    );
    
    // Return the ObjectId for the best matching category
    return categoryMap[bestCategory] || null;
  } catch (error) {
    console.error('Error categorizing product:', error.message);
    return null;
  }
}

/**
 * Categorize multiple products
 * @param {Array} products - Array of product objects
 * @returns {Array} Products with assigned categories
 */
async function categorizeProducts(products) {
  const categorizedProducts = [];
  
  for (const product of products) {
    const categoryId = await categorizeProduct(product);
    
    if (categoryId) {
      categorizedProducts.push({
        ...product,
        category: categoryId
      });
    } else {
      // Keep original product if no category match
      categorizedProducts.push(product);
    }
  }
  
  return categorizedProducts;
}

export { categorizeProduct, categorizeProducts, CATEGORY_KEYWORDS };
export default { categorizeProduct, categorizeProducts, CATEGORY_KEYWORDS };