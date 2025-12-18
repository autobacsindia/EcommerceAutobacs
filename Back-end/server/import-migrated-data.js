import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import models
import Product from './models/Product.js';
import Category from './models/Category.js';

// Connect to MongoDB
async function connectDB() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
}

// Import categories from complete-wp-data.json
async function importCategories() {
  try {
    console.log('🏷️ Importing categories...');
    
    // Read the complete WP data file
    const wpDataPath = path.join(process.cwd(), 'complete-wp-data.json');
    const wpData = JSON.parse(fs.readFileSync(wpDataPath, 'utf8'));
    
    const categories = wpData.allCategories;
    console.log(`📦 Found ${categories.length} categories to import`);
    
    // Clear existing categories
    await Category.deleteMany({});
    console.log('🧹 Cleared existing categories');
    
    // Create category documents
    const categoryDocs = categories.map(categoryName => ({
      name: categoryName,
      slug: categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      description: `${categoryName} category imported from WordPress`,
      isActive: true
    }));
    
    // Insert categories
    const insertedCategories = await Category.insertMany(categoryDocs);
    console.log(`✅ Imported ${insertedCategories.length} categories`);
    
    // Create a map of category names to IDs for reference
    const categoryMap = {};
    insertedCategories.forEach(cat => {
      categoryMap[cat.name] = cat._id;
    });
    
    return categoryMap;
  } catch (error) {
    console.error('❌ Error importing categories:', error.message);
    throw error;
  }
}

// Import products from detailed-wp-products.json
async function importProducts(categoryMap) {
  try {
    console.log('\n🛍️ Importing products...');
    
    // Read the detailed WP products file
    const wpProductsPath = path.join(process.cwd(), 'detailed-wp-products.json');
    const wpProducts = JSON.parse(fs.readFileSync(wpProductsPath, 'utf8'));
    
    console.log(`📦 Found ${wpProducts.length} products to import`);
    
    // Clear existing products
    await Product.deleteMany({});
    console.log('🧹 Cleared existing products');
    
    // Process products in batches to avoid memory issues
    const batchSize = 50;
    let importedCount = 0;
    
    for (let i = 0; i < wpProducts.length; i += batchSize) {
      const batch = wpProducts.slice(i, i + batchSize);
      const productDocs = [];
      
      batch.forEach(wpProduct => {
        // Map category names to IDs
        const categoryIds = [];
        if (wpProduct.categories && Array.isArray(wpProduct.categories)) {
          wpProduct.categories.forEach(cat => {
            if (categoryMap[cat.name]) {
              categoryIds.push(categoryMap[cat.name]);
            }
          });
        }
        
        // Extract primary image
        let primaryImage = null;
        if (wpProduct.images && wpProduct.images.length > 0) {
          primaryImage = {
            url: wpProduct.images[0].src,
            alt: wpProduct.images[0].alt || wpProduct.name,
            isPrimary: true
          };
        }
        
        // Extract additional images
        const additionalImages = [];
        if (wpProduct.images && wpProduct.images.length > 1) {
          wpProduct.images.slice(1).forEach(img => {
            additionalImages.push({
              url: img.src,
              alt: img.alt || wpProduct.name
            });
          });
        }
        
        // Create product document
        const productDoc = {
          name: wpProduct.name || 'Untitled Product',
          description: wpProduct.description || 'No description available',
          shortDescription: wpProduct.short_description || '',
          price: parseFloat(wpProduct.price) || 0,
          originalPrice: parseFloat(wpProduct.regular_price) || parseFloat(wpProduct.price) || 0,
          categories: categoryIds,
          brand: '', // Brand information not available in current data
          images: primaryImage ? [primaryImage, ...additionalImages] : additionalImages,
          stock: 10, // Default stock value
          sku: wpProduct.sku || `WP-${wpProduct.id}`,
          isActive: true,
          isFeatured: wpProduct.featured || false,
          tags: wpProduct.tags && Array.isArray(wpProduct.tags) ? wpProduct.tags.map(tag => tag.name) : []
        };
        
        productDocs.push(productDoc);
      });
      
      // Insert batch of products
      if (productDocs.length > 0) {
        await Product.insertMany(productDocs);
        importedCount += productDocs.length;
        console.log(`📦 Imported ${importedCount}/${wpProducts.length} products...`);
      }
    }
    
    console.log(`✅ Successfully imported ${importedCount} products`);
    return importedCount;
  } catch (error) {
    console.error('❌ Error importing products:', error.message);
    throw error;
  }
}

// Main function
async function importMigratedData() {
  try {
    await connectDB();
    
    // Import categories first
    const categoryMap = await importCategories();
    
    // Then import products
    const productCount = await importProducts(categoryMap);
    
    // Verify the import
    console.log('\n🔍 Verifying import...');
    const finalProductCount = await Product.countDocuments();
    const finalCategoryCount = await Category.countDocuments();
    
    console.log(`📊 Final product count: ${finalProductCount}`);
    console.log(`📊 Final category count: ${finalCategoryCount}`);
    
    // Show some sample data
    console.log('\n📦 Sample products:');
    const sampleProducts = await Product.find({}, 'name price categories')
      .populate('categories', 'name')
      .limit(5);
    
    sampleProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} - ₹${product.price}`);
      if (product.categories && product.categories.length > 0) {
        const categoryNames = product.categories.map(cat => cat.name).join(', ');
        console.log(`   🏷️ Categories: ${categoryNames}`);
      }
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    console.log('✅ Migration completed successfully!');
    
    // Check if we have the expected counts
    if (finalProductCount >= 1700 && finalCategoryCount >= 400) {
      console.log(`🎉 Confirmed: Database has ${finalProductCount} products and ${finalCategoryCount} categories!`);
    } else {
      console.log(`⚠️  Note: Expected ~1764 products and ~420 categories, but found ${finalProductCount} products and ${finalCategoryCount} categories.`);
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the import
if (process.argv[1] === import.meta.url) {
  importMigratedData();
}

export default importMigratedData;