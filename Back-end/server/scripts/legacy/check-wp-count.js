// Check total WordPress product count
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function checkProductCount() {
  try {
    console.log('🔍 Checking WordPress product count...');
    
    // Get total number of products
    const response = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
      auth: {
        username: process.env.WORDPRESS_API_KEY,
        password: process.env.WORDPRESS_API_SECRET
      },
      params: {
        per_page: 100
      },
      timeout: 30000
    });
    
    const totalPages = parseInt(response.headers['x-wp-totalpages']) || 1;
    const totalProducts = parseInt(response.headers['x-wp-total']) || 0;
    
    console.log(`📊 Total products: ${totalProducts}`);
    console.log(`📄 Total pages: ${totalPages}`);
    console.log(`📋 Sample products retrieved: ${response.data.length}`);
    
    // Show first few products
    console.log('\n📦 Sample products:');
    response.data.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} (ID: ${product.id})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkProductCount();