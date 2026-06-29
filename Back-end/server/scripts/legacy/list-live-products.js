// List all Profender products from live site
import axios from 'axios';

async function listLiveSiteProducts() {
  try {
    console.log('🌐 Fetching all Profender products from live site...');
    
    // WordPress API credentials
    const response = await axios.get('https://autobacsindia.com/wp-json/wc/v3/products', {
      auth: {
        username: 'ck_80b176c7e255a6c15870e77c3e4fe2d0b1a51b25',
        password: 'cs_a70a2b4d9c2b9eda44be80c301216ecc9b8cf7fe'
      },
      params: {
        per_page: 50,
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const products = response.data;
    console.log(`📊 Found ${products.length} Profender products on live site`);
    
    console.log('\n📦 All Profender Products from Live Site:');
    products.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
      
      // Highlight if this is one of the products the user specifically mentioned
      if (product.name.includes('2 Inch Lift Kit') || 
          product.name.includes('Suspension Set for Mahindra Thar')) {
        console.log('   ⭐ USER REQUESTED PRODUCT');
      }
    });
    
    // Save to file
    const fs = require('fs');
    fs.writeFileSync('all-live-profender-products.txt', 
      products.map((p, i) => `${i + 1}. ${p.name}`).join('\n')
    );
    console.log('\n💾 Saved product list to all-live-profender-products.txt');
    
  } catch (error) {
    console.error('💥 Error fetching products:', error.message);
  }
}

listLiveSiteProducts();