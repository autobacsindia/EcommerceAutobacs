import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getAdminAuthToken } from './utils/authHelper.js';
import Category from './models/Category.js';

dotenv.config();

const API_BASE_URL = 'http://localhost:5000';
const PRODUCTS_FILE_PATH = path.join(process.cwd(), '..', '..', 'Front-end', 'web', 'public', 'data', 'products.json');

// Connect to MongoDB to access categories
await mongoose.connect(process.env.MONGO_URI);

/**
 * Get category ID by name with better matching logic
 * @param {string|Object} categoryData - Category data from frontend (could be string or object)
 * @returns {Promise<string|null>} Category ID or null if not found
 */
async function getCategoryIdByName(categoryData) {
  try {
    let categoryName = '';
    
    // Handle different formats of category data
    if (typeof categoryData === 'object' && categoryData !== null) {
      categoryName = categoryData.name || categoryData._id || '';
    } else if (typeof categoryData === 'string') {
      categoryName = categoryData;
    }
    
    if (!categoryName) {
      console.log('⚠️  Empty category name provided');
      return null;
    }
    
    console.log(`🔍 Looking for category: "${categoryName}"`);
    
    // Try different strategies to find the category
    
    // Strategy 1: Exact match
    let category = await Category.findOne({ 
      name: { $regex: new RegExp(`^${categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    
    if (category) {
      console.log(`✅ Found exact match: "${category.name}" (${category._id})`);
      return category._id.toString();
    }
    
    // Strategy 2: Parse hierarchical category and try to match the last part
    // e.g., "Brands > Autobacs India, Exterior > Body Parts > Bumper" -> "Bumper"
    const parts = categoryName.split(/[>,]/).map(part => part.trim());
    const lastPart = parts[parts.length - 1];
    
    if (lastPart && lastPart !== categoryName) {
      console.log(`🔍 Trying to match last part: "${lastPart}"`);
      category = await Category.findOne({ 
        name: { $regex: new RegExp(lastPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
      });
      
      if (category) {
        console.log(`✅ Found match for last part: "${category.name}" (${category._id})`);
        return category._id.toString();
      }
    }
    
    // Strategy 3: Try to match any part of the category name
    for (const part of parts.reverse()) {
      if (part) {
        category = await Category.findOne({ 
          name: { $regex: new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        });
        
        if (category) {
          console.log(`✅ Found match for part "${part}": "${category.name}" (${category._id})`);
          return category._id.toString();
        }
      }
    }
    
    // Strategy 4: Fuzzy matching with common category names
    const commonCategories = [
      'Bumper', 'Body Parts', 'Tail Light', 'Headlight', 'Spoiler', 'Grill', 'Fender Flare',
      'Suspension', 'Shock Absorbers', 'Winch', 'Snorkel', 'Side Steps', 'Roof Light',
      'Bed Liner', 'Steering Wheel', 'Interior', 'Exterior', 'Lighting', 'Accessories'
    ];
    
    for (const commonCat of commonCategories) {
      if (categoryName.toLowerCase().includes(commonCat.toLowerCase())) {
        category = await Category.findOne({ 
          name: { $regex: new RegExp(commonCat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        });
        
        if (category) {
          console.log(`✅ Found fuzzy match for "${commonCat}": "${category.name}" (${category._id})`);
          return category._id.toString();
        }
      }
    }
    
    console.log(`⚠️  Category not found: "${categoryName}"`);
    return null;
  } catch (error) {
    console.error(`❌ Error finding category:`, error.message);
    return null;
  }
}
/**
 * Transform product data to match backend schema
 * @param {Object} product - Product data from JSON file
 * @returns {Object} Transformed product data
 */
function transformProductData(product) {
  // Transform images array
  const images = product.images ? product.images.map(img => ({
    url: img.url || '',
    alt: img.alt || '',
    isPrimary: !!img.isPrimary
  })) : [];
  
  // Transform specifications array
  const specifications = product.specifications ? product.specifications.map(spec => ({
    key: spec.key || '',
    value: spec.value || ''
  })) : [];
  
  // Return transformed product
  const transformedProduct = {
    _id: product._id,
    name: product.name || '',
    description: product.description || '',
    shortDescription: product.shortDescription || '',
    price: product.price || 0,
    originalPrice: product.originalPrice || 0,
    category: product.category, // Will be replaced with actual ID later
    brand: product.brand || '',
    images,
    stock: product.stock || 0,
    specifications,
    features: product.features || [],
    isActive: product.isActive !== undefined ? product.isActive : true,
    isFeatured: !!product.isFeatured,
    averageRating: product.averageRating || 0,
    totalReviews: product.totalReviews || 0,
    tags: product.tags || []
  };
  
  // Completely remove SKU field to avoid uniqueness constraints
  delete transformedProduct.sku;
  
  return transformedProduct;
}

/**
 * Import a single product with exponential backoff for rate limiting
 * @param {Object} product - Product data
 * @param {string} authToken - Admin JWT token
 * @param {number} attempt - Current attempt number (for retries)
 * @returns {Promise<boolean>} Success status
 */
async function importProduct(product, authToken, attempt = 1) {
  try {
    // Handle category mapping
    let categoryId = null;
    
    console.log(`\n📦 Processing product: "${product.name}"`);
    
    if (product.category) {
      categoryId = await getCategoryIdByName(product.category);
    }
    
    // Skip product if category not found and it's required
    if (!categoryId) {
      console.log(`⚠️  Skipping product "${product.name}" - category not found`);
      return false;
    }
    
    // Update product with category ID
    const productToImport = { ...product, category: categoryId };
    
    // Remove _id field as MongoDB will generate a new one
    delete productToImport._id;
    
    // Ensure required fields are present and valid
    if (!productToImport.name || productToImport.name.trim().length < 3) {
      console.log(`⚠️  Skipping product "${product.name}" - invalid name`);
      return false;
    }
    
    if (!productToImport.description || productToImport.description.trim().length < 10) {
      console.log(`⚠️  Skipping product "${product.name}" - invalid description`);
      return false;
    }
    
    if (productToImport.price === undefined || productToImport.price < 0) {
      console.log(`⚠️  Skipping product "${product.name}" - invalid price`);
      return false;
    }
    
    if (productToImport.stock === undefined || productToImport.stock < 0) {
      productToImport.stock = 0; // Set default stock to 0
    }
    
    // Fix shortDescription length if it's too long
    if (productToImport.shortDescription && productToImport.shortDescription.length > 200) {
      productToImport.shortDescription = productToImport.shortDescription.substring(0, 197) + '...';
      console.log(`🔧 Fixed shortDescription length for "${product.name}"`);
    }
    
    // SKU is completely removed to avoid uniqueness constraints
    // productToImport.sku is already removed in transformProductData
    
    const response = await fetch(`${API_BASE_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(productToImport)
    });
    
    const result = await response.json();
    
    if (!result.success) {
      console.log(`❌ Failed to import product "${product.name}":`, result.message);
      if (result.errors) {
        console.log('Validation errors:', result.errors);
      }
      
      // Handle rate limiting with exponential backoff
      if (result.message && (result.message.includes('Too many requests') || result.message.includes('rate limit'))) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
        console.log(`⏳ Rate limit hit, waiting ${delay/1000} seconds before retry (attempt ${attempt})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Retry with exponential backoff (max 3 attempts)
        if (attempt < 3) {
          console.log('🔁 Retrying product import...');
          return await importProduct(product, authToken, attempt + 1);
        } else {
          console.log(`⏭️  Skipping product after ${attempt} attempts due to persistent rate limiting`);
          return false;
        }
      }
      
      return false;
    }
    
    console.log(`✅ Imported product: "${product.name}" with ID: ${result.product._id}`);
    return true;
  } catch (error) {
    console.error(`❌ Error importing product "${product.name}":`, error.message);
    return false;
  }
}

/**
 * Main import function
 */
async function importProducts() {
  try {
    console.log('🚀 Starting product import process...');
    
    // Check if products file exists
    if (!fs.existsSync(PRODUCTS_FILE_PATH)) {
      throw new Error(`Products file not found at: ${PRODUCTS_FILE_PATH}`);
    }
    
    // Read products from JSON file
    console.log(`📂 Reading products from: ${PRODUCTS_FILE_PATH}`);
    const productsData = JSON.parse(fs.readFileSync(PRODUCTS_FILE_PATH, 'utf8'));
    console.log(`📊 Found ${productsData.length} products to import`);
    
    // Authenticate as admin
    console.log('🔐 Authenticating as admin user...');
    const authToken = await getAdminAuthToken();
    
    // Import products one by one
    let importedCount = 0;
    let skippedCount = 0;
    
    for (let i = 0; i < productsData.length; i++) {
      const product = productsData[i];
      console.log(`\n📦 Processing product ${i + 1}/${productsData.length}: "${product.name}"`);
      
      const transformedProduct = transformProductData(product);
      const success = await importProduct(transformedProduct, authToken);
      
      if (success) {
        importedCount++;
      } else {
        skippedCount++;
      }
      
      // Add delay to avoid rate limiting
      // Every 3 products, add a longer delay
      if ((i + 1) % 3 === 0) {
        console.log(`⏳ Adding longer delay after batch of 3 products...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        // Add small delay between products
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }    
    console.log('\n🏁 Import process completed!');
    console.log(`✅ Successfully imported: ${importedCount} products`);
    console.log(`⚠️  Skipped: ${skippedCount} products`);
    
    // Close MongoDB connection
    await mongoose.connection.close();
  } catch (error) {
    console.error('💥 Error during import process:', error.message);
    // Close MongoDB connection even if there's an error
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the import
importProducts();