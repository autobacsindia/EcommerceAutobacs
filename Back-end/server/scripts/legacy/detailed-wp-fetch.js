// Fetch detailed WordPress Profender product data
import axios from 'axios';
import fs from 'fs';

async function fetchDetailedWPData() {
  try {
    console.log('🌐 Fetching detailed Profender product data from WordPress...');
    const response = await axios.get('https://autobacsindia.com/wp-json/wc/v3/products', {
      auth: {
        username: 'ck_80b176c7e255a6c15870e77c3e4fe2d0b1a51b25',
        password: 'cs_a70a2b4d9c2b9eda44be80c301216ecc9b8cf7fe'
      },
      params: {
        per_page: 5, // Just get a few products for analysis
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products`);
    
    // Show detailed product information including categories
    console.log('\n📦 Detailed Profender Product Information:');
    wpProducts.forEach((product, index) => {
      console.log(`\n${index + 1}. ${product.name}`);
      console.log(`   ID: ${product.id}`);
      console.log(`   SKU: ${product.sku}`);
      console.log(`   Price: ${product.price}`);
      
      if (product.categories && product.categories.length > 0) {
        console.log('   Categories:');
        product.categories.forEach((cat, catIndex) => {
          console.log(`     ${catIndex + 1}. ${cat.name} (ID: ${cat.id}, Slug: ${cat.slug})`);
        });
      } else {
        console.log('   Categories: None');
      }
      
      if (product.attributes && product.attributes.length > 0) {
        console.log('   Attributes:');
        product.attributes.forEach((attr, attrIndex) => {
          console.log(`     ${attrIndex + 1}. ${attr.name}: ${Array.isArray(attr.options) ? attr.options.join(', ') : attr.options}`);
        });
      }
    });
    
    // Save to file for detailed analysis
    fs.writeFileSync('detailed-wp-products.json', JSON.stringify(wpProducts, null, 2));
    console.log('\n💾 Saved detailed WordPress product data to detailed-wp-products.json');
    
  } catch (error) {
    console.error('💥 Error fetching WordPress data:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

fetchDetailedWPData();