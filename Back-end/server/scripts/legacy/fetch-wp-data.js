// Fetch WordPress Profender product data
import axios from 'axios';

async function fetchWPData() {
  try {
    console.log('🌐 Fetching Profender products from WordPress...');
    const response = await axios.get('https://autobacsindia.com/wp-json/wc/v3/products', {
      auth: {
        username: 'ck_80b176c7e255a6c15870e77c3e4fe2d0b1a51b25',
        password: 'cs_a70a2b4d9c2b9eda44be80c301216ecc9b8cf7fe'
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
    console.log(`📊 Found ${wpProducts.length} Profender products`);
    
    // Show product names and categories
    console.log('\n📦 Profender Products from WordPress:');
    wpProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
      if (product.categories && product.categories.length > 0) {
        const categories = product.categories.map(c => c.name);
        console.log(`   Categories: [${categories.join(', ')}]`);
      } else {
        console.log('   Categories: None');
      }
    });
    
    // Save to file for analysis
    const fs = require('fs');
    fs.writeFileSync('wp-products.json', JSON.stringify(wpProducts, null, 2));
    console.log('\n💾 Saved WordPress product data to wp-products.json');
  } catch (error) {
    console.error('💥 Error fetching WordPress data:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

fetchWPData();