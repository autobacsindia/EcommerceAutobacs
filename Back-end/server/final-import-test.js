// Final import test script
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from './models/Product.js';
import Category from './models/Category.js';
import categoryMappingService from './services/categoryMappingService.js';

// Load environment variables
dotenv.config();

console.log('🚀 Starting final import test...');

async function finalImportTest() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
    });
    console.log('✅ Connected to MongoDB');
    
    // Initialize category mapping service
    console.log('📂 Initializing category mapping service...');
    await categoryMappingService.initialize();
    console.log('✅ Category mapping service initialized');
    
    // Test WordPress API connection
    console.log('🔍 Testing WordPress API connection...');
    const response = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
      auth: {
        username: process.env.WORDPRESS_API_KEY,
        password: process.env.WORDPRESS_API_SECRET
      },
      params: {
        per_page: 2
      },
      timeout: 30000
    });
    
    console.log(`✅ WordPress API connection successful`);
    console.log(`📊 Retrieved ${response.data.length} sample products`);
    
    // Process just the first product to test
    const wpProduct = response.data[0];
    console.log(`\n📦 Processing: ${wpProduct.name} (ID: ${wpProduct.id})`);
    
    // Handle categories
    let categoryId = null;
    if (wpProduct.categories && wpProduct.categories.length > 0) {
      const primaryCategory = wpProduct.categories[0];
      let matchedCategory = categoryMappingService.findCategory(primaryCategory.name);
      
      if (matchedCategory) {
        categoryId = matchedCategory._id;
        console.log(`   📂 Assigned to existing category: ${matchedCategory.name}`);
      } else {
        console.log(`   ⚠️  Category "${primaryCategory.name}" not found, creating it...`);
        const newCategory = await categoryMappingService.createCategory(primaryCategory.name);
        categoryId = newCategory._id;
        console.log(`   ➕ Created and assigned to new category: ${newCategory.name}`);
      }
    } else {
      // No categories in WordPress product, use default "Other" category
      const otherCategory = categoryMappingService.findCategory('Other');
      if (otherCategory) {
        categoryId = otherCategory._id;
        console.log(`   📂 Assigned to default category: ${otherCategory.name}`);
      } else {
        console.log(`   ⚠️  No "Other" category found, using first available category...`);
        const categories = await Category.find({}).limit(1);
        if (categories.length > 0) {
          categoryId = categories[0]._id;
          console.log(`   📂 Assigned to fallback category: ${categories[0].name}`);
        } else {
          console.error(`   ❌ No categories available in database!`);
          throw new Error('No categories available in database');
        }
      }
    }
    
    // Extract brand information
    let brand = 'Unknown';
    if (wpProduct.attributes) {
      const brandAttribute = wpProduct.attributes.find(attr => 
        attr.name.toLowerCase() === 'brand' || attr.name.toLowerCase() === 'brands'
      );
      
      if (brandAttribute && brandAttribute.options && brandAttribute.options.length > 0) {
        brand = Array.isArray(brandAttribute.options) 
          ? brandAttribute.options[0] 
          : brandAttribute.options;
      }
    }
    
    // Transform images
    let images = [];
    if (wpProduct.images && Array.isArray(wpProduct.images)) {
      images = wpProduct.images.map((img, index) => ({
        url: img.src || img.url || '',
        alt: img.alt || img.name || wpProduct.name || '',
        isPrimary: index === 0
      })).filter(img => img.url);
    }
    
    // Transform product data
    const productData = {
      name: wpProduct.name || 'Untitled Product',
      description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '').trim() : '',
      shortDescription: wpProduct.short_description 
        ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) 
        : (wpProduct.name ? wpProduct.name.substring(0, 200) : ''),
      price: parseFloat(wpProduct.price || wpProduct.regular_price) || 0,
      originalPrice: parseFloat(wpProduct.sale_price) || null,
      sku: wpProduct.sku || `WP-${wpProduct.id}`,
      stock: parseInt(wpProduct.stock_quantity) || 0,
      brand: brand,
      category: categoryId,
      images: images,
      isActive: wpProduct.status === 'publish',
      isFeatured: wpProduct.featured || false,
      externalId: wpProduct.id.toString(),
      externalUrl: wpProduct.permalink,
      tags: wpProduct.tags ? wpProduct.tags.map(tag => tag.name) : [],
      specifications: wpProduct.attributes ? wpProduct.attributes.map(attr => ({
        name: attr.name,
        value: Array.isArray(attr.options) ? attr.options.join(', ') : attr.options
      })) : []
    };
    
    console.log(`   📝 Product data prepared: ${productData.name} (SKU: ${productData.sku})`);
    
    // Check if product already exists
    console.log(`   🔍 Checking for existing product with externalId: ${productData.externalId} or SKU: ${productData.sku}`);
    let product = await Product.findOne({
      $or: [
        { externalId: productData.externalId },
        { sku: productData.sku }
      ]
    });
    console.log(`   🔎 Found existing product: ${!!product}`);
    
    if (product) {
      // Update existing product
      console.log(`   🔄 Updating existing product...`);
      const updateData = { ...productData };
      delete updateData._id;
      
      await Product.updateOne(
        { _id: product._id },
        { $set: updateData }
      );
      
      console.log(`   ✅ Updated existing product: ${productData.name}`);
    } else {
      // Create new product
      try {
        console.log(`   🆕 Creating new product: ${productData.name} with SKU: ${productData.sku}`);
        product = new Product(productData);
        console.log(`   💾 Saving product to database...`);
        await product.save();
        console.log(`   ➕ Created new product: ${product.name}`);
      } catch (saveError) {
        console.error(`   ⚠️  Error saving product:`, saveError.message);
        // If saving fails due to duplicate key, try to update existing product
        if (saveError.code === 11000) {
          console.log(`   ⚠️  Duplicate detected for ${productData.name}, updating instead...`);
          // Find the existing product by SKU
          const existingProduct = await Product.findOne({ sku: productData.sku });
          if (existingProduct) {
            const updateData = { ...productData };
            delete updateData._id;
            
            await Product.updateOne(
              { _id: existingProduct._id },
              { $set: updateData }
            );
            
            console.log(`   🔄 Updated existing product: ${productData.name}`);
          }
        } else {
          throw saveError; // Re-throw if it's a different error
        }
      }
    }
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    console.log('✅ Final import test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
    console.error('📋 Error stack:', error.stack);
    process.exit(1);
  }
}

finalImportTest();