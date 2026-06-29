import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function checkWordPressProductCount() {
  try {
    console.log('🔍 Checking total product count on WordPress...');
    
    const response = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
      auth: {
        username: process.env.WORDPRESS_API_KEY,
        password: process.env.WORDPRESS_API_SECRET
      },
      params: {
        per_page: 1
      },
      timeout: 30000
    });
    
    const totalProducts = parseInt(response.headers['x-wp-total']) || response.data.length;
    console.log(`📊 Total products on WordPress: ${totalProducts}`);
    
  } catch (error) {
    console.error('❌ Error checking WordPress product count:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
  }
}

checkWordPressProductCount();