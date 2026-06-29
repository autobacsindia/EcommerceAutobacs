// Fetch Profender products directly from WordPress API
import axios from 'axios';

async function fetchProfenderProducts() {
  try {
    console.log('🌐 Fetching Profender products from WordPress API...');
    
    // WordPress API credentials from our .env file
    const response = await axios.get('https://autobacsindia.com/wp-json/wc/v3/products', {
      auth: {
        username: 'ck_80b176c7e255a6c15870e77c3e4fe2d0b1a51b25',
        password: 'cs_a70a2b4d9c2b9eda44be80c301216ecc9b8cf7fe'
      },
      params: {
        per_page: 30, // Get more products to be sure
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const products = response.data;
    console.log(`📊 Found ${products.length} Profender products`);
    
    console.log('\n📦 Profender Products from Live Site:');
    products.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
      
      // Check if this is one of the specific products the user mentioned
      if (product.name.includes('2 Inch Lift Kit For Hilux') || 
          product.name.includes('Suspension Set for Mahindra Thar CRDe')) {
        console.log('   ⭐ THIS IS ONE OF THE SPECIFIC PRODUCTS MENTIONED BY USER!');
      }
    });
    
    // Save to file for analysis
    const fs = require('fs');
    fs.writeFileSync('live-site-profender-products.json', JSON.stringify(products, null, 2));
    console.log('\n💾 Saved live site product data to live-site-profender-products.json');
    
    // Check specifically for the products mentioned by the user
    console.log('\n🔍 Checking for user-specific products:');
    const userProducts = products.filter(product => 
      product.name.includes('2 Inch Lift Kit For Hilux') || 
      product.name.includes('Suspension Set for Mahindra Thar CRDe')
    );
    
    if (userProducts.length > 0) {
      console.log(`✅ Found ${userProducts.length} of the user\'s specific products:`);
      userProducts.forEach(p => console.log(`   • ${p.name}`));
    } else {
      console.log('❌ Did not find the specific products mentioned by the user');
      console.log('   This might mean the product names are slightly different or they\'re on another page');
    }
    
  } catch (error) {
    console.error('💥 Error fetching Profender products:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

fetchProfenderProducts();