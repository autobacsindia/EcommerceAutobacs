import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from './models/Product.js';
import categoryMappingService from './services/categoryMappingService.js';

// Load environment variables
dotenv.config();

async function testWordPressImport() {
  try {
    console.log('🚀 Testing WordPress import connection...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Initialize category mapping service
    await categoryMappingService.initialize();
    console.log('📚 Category mapping service initialized');
    
    // Test WordPress API connection
    console.log('\n🔍 Testing WordPress API connection...');
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
    
    // Show sample products
    console.log('\n📦 Sample products from WordPress:');
    response.data.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (ID: ${product.id})`);
      if (product.categories && product.categories.length > 0) {
        console.log(`   Categories: ${product.categories.map(c => c.name).join(', ')}`);
      }
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testWordPressImport();