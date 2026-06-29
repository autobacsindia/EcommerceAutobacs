import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from '../../models/Product.js';
import categoryMappingService from '../../services/categoryMappingService.js';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

// Transform WordPress product to our product model
async function transformProduct(wpProduct, categoryMap) {
  try {
    // Handle categories - automatically create missing categories
    let categoryId = null;
    
    if (wpProduct.categories && wpProduct.categories.length > 0) {
      // Try to match the first category
      const primaryCategory = wpProduct.categories[0];
      let matchedCategory = categoryMap.findCategory(primaryCategory.name);
      
      if (matchedCategory) {
        categoryId = matchedCategory._id;
        console.log(`   📂 Assigned to existing category: ${matchedCategory.name}`);
      } else {
        console.log(`   ⚠️  Category "${primaryCategory.name}" not found, creating it...`);
        // Create the missing category
        const newCategory = await categoryMap.createCategory(primaryCategory.name);
        categoryId = newCategory._id;
        console.log(`   ➕ Created and assigned to new category: ${newCategory.name}`);
      }
      
      // For debugging, let's also create all categories in the product
      for (const category of wpProduct.categories) {
        const existingCategory = categoryMap.findCategory(category.name);
        if (!existingCategory) {
          console.log(`   ➕ Auto-creating missing category: ${category.name}`);
          await categoryMap.createCategory(category.name);
        }
      }
    } else {
      // No categories in WordPress product, use default "Other" category
      const otherCategory = categoryMap.findCategory('Other');
      if (otherCategory) {
        categoryId = otherCategory._id;
        console.log(`   📂 Assigned to default category: ${otherCategory.name}`);
      } else {
        // If no "Other" category, try to find any available category
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
    
    return productData;
  } catch (error) {
    console.error('❌ Error transforming product:', error.message);
    throw error;
  }
}

// Save or update product in database
async function saveProduct(productData) {
  try {
    // Check if product already exists
    let product = await Product.findOne({ externalId: productData.externalId });
    
    if (product) {
      // Update existing product
      Object.assign(product, productData);
      await product.save();
      console.log(`   🔄 Updated existing product: ${product.name}`);
      return { action: 'updated', product: product };
    } else {
      // Create new product
      product = new Product(productData);
      await product.save();
      console.log(`   ➕ Created new product: ${product.name}`);
      return { action: 'created', product: product };
    }
  } catch (error) {
    console.error('❌ Error saving product:', error.message);
    throw error;
  }
}

async function importSampleProducts() {
  try {
    console.log('🚀 Starting sample product import...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Initialize category mapping service
    await categoryMappingService.initialize();
    console.log('📚 Category mapping service initialized');
    
    // Fetch sample products from WordPress
    console.log('\n🔍 Fetching sample products from WordPress...');
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
    
    console.log(`✅ Retrieved ${response.data.length} sample products`);
    
    // Process each product
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    
    for (const wpProduct of response.data) {
      try {
        console.log(`\n📦 Processing: ${wpProduct.name} (ID: ${wpProduct.id})`);
        
        // Transform product
        const productData = await transformProduct(wpProduct, categoryMappingService);
        
        // Save product
        const result = await saveProduct(productData);
        
        if (result.action === 'created') {
          createdCount++;
        } else if (result.action === 'updated') {
          updatedCount++;
        }
      } catch (error) {
        console.error(`   ❌ Failed to process product ${wpProduct.id}:`, error.message);
        failedCount++;
      }
    }
    
    console.log('\n📈 Import Summary:');
    console.log(`   ➕ Created: ${createdCount} products`);
    console.log(`   🔄 Updated: ${updatedCount} products`);
    console.log(`   ❌ Failed: ${failedCount} products`);
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    console.log('✅ Sample import completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
    process.exit(1);
  }
}

importSampleProducts();