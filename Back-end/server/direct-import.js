// Direct import script with explicit configuration
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from './models/Product.js';
import Category from './models/Category.js';
import categoryMappingService from './services/categoryMappingService.js';

// Load environment variables
dotenv.config();

async function directImport() {
  try {
    console.log('🚀 Starting direct WordPress product import...');
    
    // Connect to MongoDB with explicit localhost configuration
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
        per_page: 5
      },
      timeout: 30000
    });
    
    console.log(`✅ WordPress API connection successful`);
    console.log(`📊 Retrieved ${response.data.length} sample products`);
    
    // Process each product
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    
    for (const wpProduct of response.data) {
      try {
        console.log(`\n📦 Processing: ${wpProduct.name} (ID: ${wpProduct.id})`);
        
        // Handle categories - automatically create missing categories and assign all
        let categoryIds = [];
        
        if (wpProduct.categories && wpProduct.categories.length > 0) {
          // Process all categories for this product
          for (const wpCategory of wpProduct.categories) {
            let matchedCategory = categoryMappingService.findCategory(wpCategory.name);
            
            if (matchedCategory) {
              categoryIds.push(matchedCategory._id);
              console.log(`   📂 Added to existing category: ${matchedCategory.name}`);
            } else {
              console.log(`   ⚠️  Category "${wpCategory.name}" not found, creating it...`);
              // Create the missing category
              const newCategory = await categoryMappingService.createCategory(wpCategory.name);
              categoryIds.push(newCategory._id);
              console.log(`   ➕ Created and added to new category: ${newCategory.name}`);
            }
          }
          console.log(`   📂 Assigned to ${categoryIds.length} categories`);
        } else {
          // No categories in WordPress product, use default "Other" category
          const otherCategory = categoryMappingService.findCategory('Other');
          if (otherCategory) {
            categoryIds.push(otherCategory._id);
            console.log(`   📂 Assigned to default category: ${otherCategory.name}`);
          } else {
            console.log(`   ⚠️  No "Other" category found, using first available category...`);
            const categories = await Category.find({}).limit(1);
            if (categories.length > 0) {
              categoryIds.push(categories[0]._id);
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
        
        // Transform images - convert from WordPress format to our format
        let images = [];
        if (wpProduct.images && Array.isArray(wpProduct.images)) {
          images = wpProduct.images.map((img, index) => ({
            url: img.src || img.url || '',
            alt: img.alt || img.name || wpProduct.name || '',
            isPrimary: index === 0
          })).filter(img => img.url); // Filter out images without URLs
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
          categories: categoryIds,
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
          // Update only the fields we want to change, preserving _id and other immutable fields
          const updateData = { ...productData };
          delete updateData._id; // Don't try to update _id
          
          await Product.updateOne(
            { _id: product._id },
            { $set: updateData }
          );
          
          console.log(`   🔄 Updated existing product: ${productData.name}`);
          updatedCount++;
        } else {
          // Create new product
          try {
            console.log(`   🆕 Creating new product: ${productData.name} with SKU: ${productData.sku}`);
            product = new Product(productData);
            console.log(`   💾 Saving product to database...`);
            await product.save();
            console.log(`   ➕ Created new product: ${product.name}`);
            createdCount++;
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
                updatedCount++;
              }
            } else {
              throw saveError; // Re-throw if it's a different error
            }
          }
        }
      } catch (error) {
        console.error(`   ❌ Failed to process product ${wpProduct.id}:`, error.message);
        console.error(`   🐛 Error stack:`, error.stack);
        failedCount++;
      }
    }
    
    console.log('\n📈 Import Summary:');
    console.log(`   ➕ Created: ${createdCount} products`);
    console.log(`   🔄 Updated: ${updatedCount} products`);
    console.log(`   ❌ Failed: ${failedCount} products`);
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    console.log('✅ Direct import completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
    process.exit(1);
  }
}

directImport();