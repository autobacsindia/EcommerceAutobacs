// Analyze categories of Profender products on live site vs database
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
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
    
    // Get database products
    console.log('🔍 Getting Profender products from database...');
    const dbProducts = await Product.find({ brand: 'Profender' }).sort({ name: 1 });
    console.log(`📊 Found ${dbProducts.length} Profender products in database`);
    
    console.log('\n📋 Live Site vs Database Category Comparison:');
    
    // Compare categories for each product
    for (let i = 0; i < Math.min(wpProducts.length, dbProducts.length); i++) {
      const wpProduct = wpProducts[i];
      // Find matching database product by name
      const dbProduct = dbProducts.find(p => p.name === wpProduct.name);
      
      if (dbProduct) {
        // Get live site categories
        const wpCategories = wpProduct.categories ? wpProduct.categories.map(c => c.name).sort() : [];
        // Get database categories (we only have one category per product in our model)
        const dbCategory = dbProduct.category ? [dbProduct.category.toString()] : [];
        
        console.log(`\n${i + 1}. ${wpProduct.name}`);
        console.log(`   Live Site Categories: [${wpCategories.join(', ')}]`);
        console.log(`   Database Category: ${dbCategory.length > 0 ? dbCategory[0] : 'None'}`);
        
        // Check if they match
        if (wpCategories.length > 0 && dbCategory.length > 0) {
          console.log(`   ✅ Match: ${wpCategories.includes('Automotive Parts') ? 'Yes' : 'No'}`);
        } else {
          console.log(`   ⚠️  Incomplete: Missing category information`);
        }
      }
    }
    
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
      .populate('category', 'name')
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
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error analyzing categories:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
    mongoose.connection.close();
  }
});