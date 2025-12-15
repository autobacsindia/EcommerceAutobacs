import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function simpleWordPressImport() {
  try {
    console.log('🚀 Starting simple WordPress product import...');
    
    // Connect to MongoDB with simplified settings
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
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
    
    // Show sample products
    console.log('\n📦 Sample products from WordPress:');
    response.data.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (ID: ${product.id})`);
    });
    
    console.log('\n✅ Simple import test completed successfully!');
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
    process.exit(1);
  }
}

simpleWordPressImport();