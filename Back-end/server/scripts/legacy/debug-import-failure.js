import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';
import categoryMappingService from '../../services/categoryMappingService.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

// Test WordPress API connectivity
async function testWordPressAPI() {
  try {
    console.log('🔍 Testing WordPress API connectivity...');
    
    const response = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
      auth: {
        username: process.env.WORDPRESS_API_KEY,
        password: process.env.WORDPRESS_API_SECRET
      },
      params: {
        per_page: 5,
        status: 'publish'
      },
      timeout: 30000
    });
    
    console.log(`✅ WordPress API connection successful! Found ${response.data.length} products`);
    
    // Display first product details
    if (response.data.length > 0) {
      const firstProduct = response.data[0];
      console.log('\n📦 First product details:');
      console.log(`   Name: ${firstProduct.name}`);
      console.log(`   ID: ${firstProduct.id}`);
      console.log(`   SKU: ${firstProduct.sku || 'N/A'}`);
      console.log(`   Price: ${firstProduct.price || firstProduct.regular_price || 'N/A'}`);
      console.log(`   Status: ${firstProduct.status}`);
      
      if (firstProduct.categories && firstProduct.categories.length > 0) {
        console.log('   Categories:');
        firstProduct.categories.forEach((cat, index) => {
          console.log(`     ${index + 1}. ${cat.name} (ID: ${cat.id})`);
        });
      } else {
        console.log('   Categories: None');
      }
      
      if (firstProduct.attributes && firstProduct.attributes.length > 0) {
        console.log('   Attributes:');
        firstProduct.attributes.forEach((attr, index) => {
          console.log(`     ${index + 1}. ${attr.name}: ${Array.isArray(attr.options) ? attr.options.join(', ') : attr.options}`);
        });
      } else {
        console.log('   Attributes: None');
      }
    }
    
    return response.data;
  } catch (error) {
    console.error('❌ WordPress API connection failed:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// Test category mapping
async function testCategoryMapping() {
  try {
    console.log('\n🔍 Testing category mapping service...');
    
    // Initialize category mapping service
    await categoryMappingService.initialize();
    const stats = categoryMappingService.getStatistics();
    console.log(`✅ Category mapping service initialized with ${stats.totalCategories} categories`);
    
    // Test with some sample categories
    const testCategories = ['Accessories', 'Exterior', 'Performance', 'Lighting', 'NonExistentCategory'];
    
    console.log('\n🧪 Testing category lookups:');
    for (const categoryName of testCategories) {
      const category = categoryMappingService.findCategory(categoryName);
      if (category) {
        console.log(`   ✅ Found: ${categoryName} → ${category.name} (${category._id})`);
      } else {
        console.log(`   ❌ Not found: ${categoryName}`);
      }
    }
  } catch (error) {
    console.error('❌ Category mapping test failed:', error.message);
    throw error;
  }
}

// Test database operations
async function testDatabaseOperations() {
  try {
    console.log('\n🔍 Testing database operations...');
    
    // Count existing products
    const productCount = await Product.countDocuments();
    console.log(`✅ Found ${productCount} existing products in database`);
    
    // Count categories
    const categoryCount = await Category.countDocuments();
    console.log(`✅ Found ${categoryCount} categories in database`);
    
    // Try to create a test product
    const testProduct = new Product({
      name: 'Debug Test Product',
      description: 'This is a test product for debugging import failures',
      price: 99.99,
      sku: 'DEBUG-TEST-001',
      stock: 10,
      brand: 'DebugBrand',
      isActive: true,
      externalId: 'debug-test-id',
      externalUrl: 'https://example.com/debug-test'
    });
    
    await testProduct.save();
    console.log('✅ Successfully created test product');
    
    // Clean up test product
    await Product.deleteOne({ externalId: 'debug-test-id' });
    console.log('✅ Cleaned up test product');
    
  } catch (error) {
    console.error('❌ Database operations test failed:', error.message);
    throw error;
  }
}

// Debug a single product import
async function debugSingleProductImport(wpProduct) {
  try {
    console.log(`\n🔍 Debugging import of product: ${wpProduct.name} (ID: ${wpProduct.id})`);
    
    // Initialize category mapping service
    await categoryMappingService.initialize();
    
    // Test category mapping
    if (wpProduct.categories && wpProduct.categories.length > 0) {
      console.log('   📂 Category mapping test:');
      for (const category of wpProduct.categories) {
        const matchedCategory = categoryMappingService.findCategory(category.name);
        if (matchedCategory) {
          console.log(`     ✅ ${category.name} → ${matchedCategory.name} (${matchedCategory._id})`);
        } else {
          console.log(`     ❌ ${category.name} → No match found`);
        }
      }
    }
    
    // Test brand extraction
    let brand = 'Unknown';
    if (wpProduct.attributes) {
      const brandAttribute = wpProduct.attributes.find(attr => 
        attr.name.toLowerCase() === 'brand' || attr.name.toLowerCase() === 'brands'
      );
      
      if (brandAttribute && brandAttribute.options && brandAttribute.options.length > 0) {
        brand = Array.isArray(brandAttribute.options) 
          ? brandAttribute.options[0] 
          : brandAttribute.options;
        console.log(`   🏷️  Brand extracted: ${brand}`);
      } else {
        console.log('   🏷️  No brand attribute found');
      }
    }
    
    // Test product transformation
    console.log('   🔄 Testing product transformation...');
    
    // Handle categories
    let categoryId = null;
    if (wpProduct.categories && wpProduct.categories.length > 0) {
      const primaryCategory = wpProduct.categories[0];
      const matchedCategory = categoryMappingService.findCategory(primaryCategory.name);
      if (matchedCategory) {
        categoryId = matchedCategory._id;
      }
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
      categories: [categoryId],
      images: wpProduct.images ? wpProduct.images.map(img => img.src) : [],
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
    
    console.log('   ✅ Product transformation successful');
    console.log(`      Name: ${productData.name}`);
    console.log(`      Price: ${productData.price}`);
    console.log(`      SKU: ${productData.sku}`);
    console.log(`      Brand: ${productData.brand}`);
    console.log(`      Category ID: ${productData.categories && productData.categories.length > 0 ? productData.categories[0] : 'None'}`);
    
    // Test database save
    console.log('   💾 Testing database save...');
    let product = await Product.findOne({ externalId: productData.externalId });
    
    if (product) {
      console.log('      🔄 Updating existing product');
      Object.assign(product, productData);
      await product.save();
      console.log('      ✅ Product updated successfully');
    } else {
      console.log('      ➕ Creating new product');
      product = new Product(productData);
      await product.save();
      console.log('      ✅ Product created successfully');
    }
    
    console.log('✅ Single product import debug completed successfully');
    
  } catch (error) {
    console.error('❌ Single product import debug failed:', error.message);
    console.error('📋 Error stack:', error.stack);
    throw error;
  }
}

// Main debug function
async function debugImportFailure() {
  console.log('🐛 Debugging Import Failure\n');
  
  try {
    // Connect to database
    await connectToDatabase();
    
    // Test WordPress API
    const wpProducts = await testWordPressAPI();
    
    // Test category mapping
    await testCategoryMapping();
    
    // Test database operations
    await testDatabaseOperations();
    
    // Debug a single product if available
    if (wpProducts && wpProducts.length > 0) {
      await debugSingleProductImport(wpProducts[0]);
    }
    
    console.log('\n✅ All debug tests completed successfully!');
    console.log('💡 Based on the debug output, you should now have insight into why the import is failing.');
    
  } catch (error) {
    console.error('\n💥 Debug process failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the debug
debugImportFailure();