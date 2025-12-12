// Import Profender products with correct categories
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function importProfenderWithCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('🚀 Starting Profender product import with correct categories...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    // Fetch Profender products from WordPress
    console.log('🌐 Fetching Profender products from WordPress...');
    const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 20,
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products`);
    
    let importedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let categoryCreatedCount = 0;
    
    // Process each product
    for (let i = 0; i < wpProducts.length; i++) {
      const wpProduct = wpProducts[i];
      console.log(`\n📦 Processing product ${i + 1}/${wpProducts.length}: ${wpProduct.name}`);
      
      try {
        // Handle categories - create or find existing categories
        let categoryId = null;
        if (wpProduct.categories && wpProduct.categories.length > 0) {
          // Use the first category for simplicity, but in a real implementation 
          // we might want to handle multiple categories
          const primaryCategory = wpProduct.categories[0];
          console.log(`   📂 Primary category: ${primaryCategory.name}`);
          
          // Find or create category
          let category = await Category.findOne({ 
            $or: [
              { name: primaryCategory.name },
              { slug: primaryCategory.slug }
            ]
          });
          
          if (!category) {
            // Create new category
            console.log(`   ➕ Creating new category: ${primaryCategory.name}`);
            category = new Category({
              name: primaryCategory.name,
              slug: primaryCategory.slug,
              description: primaryCategory.description || `Category for ${primaryCategory.name}`
            });
            await category.save();
            categoryCreatedCount++;
            console.log(`   ✅ Created category with ID: ${category._id}`);
          } else {
            console.log(`   🔍 Found existing category: ${category.name} (${category._id})`);
          }
          
          categoryId = category._id;
        }
        
        // Transform product data
        const productData = {
          name: wpProduct.name,
          description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '') : '',
          shortDescription: wpProduct.short_description ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) : wpProduct.name.substring(0, 200),
          price: parseFloat(wpProduct.price || wpProduct.regular_price) || 0,
          sku: wpProduct.sku || `PROFENDER-${Date.now()}-${i}`,
          stock: parseInt(wpProduct.stock_quantity) || 0,
          brand: 'Profender',
          category: categoryId, // Use the correct category
          isActive: wpProduct.status === 'publish',
          isFeatured: wpProduct.featured || false
        };
        
        console.log(`   💰 Price: ${productData.price}`);
        console.log(`   📦 SKU: ${productData.sku}`);
        console.log(`   📦 Stock: ${productData.stock}`);
        console.log(`   📂 Category ID: ${productData.category || 'None'}`);
        
        // Handle images
        if (wpProduct.images && Array.isArray(wpProduct.images)) {
          productData.images = wpProduct.images.map((img, index) => ({
            url: img.src,
            alt: img.alt || img.name || `Product image ${index + 1}`,
            isPrimary: index === 0
          }));
          console.log(`   🖼️ Images: ${productData.images.length}`);
        }
        
        // Handle specifications/attributes
        if (wpProduct.attributes && Array.isArray(wpProduct.attributes)) {
          productData.specifications = wpProduct.attributes.map(attr => ({
            key: attr.name,
            value: Array.isArray(attr.options) ? attr.options.join(', ') : attr.options
          }));
          console.log(`   📋 Specifications: ${productData.specifications.length}`);
        }
        
        // Check if product already exists (by name since SKU might be missing)
        let existingProduct = await Product.findOne({ 
          name: productData.name,
          brand: 'Profender'
        });
        
        console.log(`   🔍 Existing product found: ${!!existingProduct}`);
        
        let savedProduct;
        if (existingProduct) {
          // Update existing product with correct category
          savedProduct = await Product.findByIdAndUpdate(
            existingProduct._id,
            productData,
            { new: true, runValidators: true }
          );
          console.log(`   ✅ Updated product: ${productData.name}`);
          updatedCount++;
        } else {
          // Create new product
          const product = new Product(productData);
          savedProduct = await product.save();
          console.log(`   ➕ Created product: ${productData.name}`);
          importedCount++;
        }
        
        console.log(`   📈 Progress: ${importedCount} imported, ${updatedCount} updated`);
      } catch (error) {
        console.error(`   ❌ Failed to import product ${wpProduct.name}:`, error.message);
        failedCount++;
      }
    }
    
    console.log(`\n🎉 Import completed!`);
    console.log(`✅ Successfully imported: ${importedCount} new products`);
    console.log(`✅ Successfully updated: ${updatedCount} existing products`);
    console.log(`✅ Categories created: ${categoryCreatedCount}`);
    console.log(`❌ Failed to import: ${failedCount} products`);
    
    // Final verification
    console.log('\n🔍 Verifying import...');
    const profenderProducts = await Product.find({ brand: 'Profender' }).populate('category', 'name');
    console.log(`📊 Final count of Profender products: ${profenderProducts.length}`);
    
    // Show category distribution
    console.log('\n📊 Category Distribution:');
    const categoryCounts = {};
    profenderProducts.forEach(product => {
      const categoryName = product.category ? product.category.name : 'Uncategorized';
      categoryCounts[categoryName] = (categoryCounts[categoryName] || 0) + 1;
    });
    
    Object.entries(categoryCounts).forEach(([category, count]) => {
      console.log(`   ${category}: ${count} products`);
    });
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error importing Profender products:', error.message);
    console.error('📋 Error details:', error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run import
importProfenderWithCategories();