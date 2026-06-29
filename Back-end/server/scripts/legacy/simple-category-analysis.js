// Simple category analysis without starting full server
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

async function analyzeCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('🔍 Analyzing Profender product categories...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    // Fetch Profender products from WordPress with full details
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
    console.log(`📊 Found ${wpProducts.length} Profender products on live site`);
    
    // Show a summary of all categories from live site
    console.log('\n📊 All Live Site Categories:');
    const allCategories = new Set();
    wpProducts.forEach(product => {
      if (product.categories) {
        product.categories.forEach(cat => allCategories.add(cat.name));
      }
    });
    
    const sortedCategories = Array.from(allCategories).sort();
    console.log(`   Total unique categories: ${sortedCategories.length}`);
    console.log(`   Categories: [${sortedCategories.join(', ')}]`);
    
    // Show database categories
    console.log('\n📊 Database Categories:');
    // We need to populate the category information
    const dbProductsWithCategories = await Product.find({ brand: 'Profender' })
      .populate('categories', 'name')
      .sort({ name: 1 });
    
    const dbCategories = new Set();
    dbProductsWithCategories.forEach(product => {
      if (product.category) {
        dbCategories.add(product.category.name);
      }
    });
    
    const sortedDbCategories = Array.from(dbCategories).sort();
    console.log(`   Total unique categories: ${sortedDbCategories.length}`);
    console.log(`   Categories: [${sortedDbCategories.join(', ')}]`);
    
    // Show detailed comparison for first few products
    console.log('\n📋 Detailed Category Comparison (First 5 Products):');
    for (let i = 0; i < Math.min(5, wpProducts.length); i++) {
      const wpProduct = wpProducts[i];
      console.log(`\n${i + 1}. ${wpProduct.name}`);
      
      // Live site categories
      const wpCategories = wpProduct.categories ? wpProduct.categories.map(c => c.name).sort() : [];
      console.log(`   Live Site: [${wpCategories.join(', ')}]`);
      
      // Find matching database product
      const dbProduct = dbProductsWithCategories.find(p => p.name === wpProduct.name);
      if (dbProduct && dbProduct.category) {
        console.log(`   Database: [${dbProduct.category.name}]`);
      } else {
        console.log(`   Database: [None]`);
      }
    }
    
    // Check if we need to import categories
    console.log('\n🔍 Category Import Analysis:');
    if (sortedCategories.length > sortedDbCategories.length) {
      console.log(`   ⚠️  Live site has ${sortedCategories.length} categories but database has only ${sortedDbCategories.length}`);
      console.log(`   📋 Missing categories: [${sortedCategories.filter(cat => !sortedDbCategories.includes(cat)).join(', ')}]`);
    } else {
      console.log('   ✅ Category counts match');
    }
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error analyzing categories:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run analysis
analyzeCategories();