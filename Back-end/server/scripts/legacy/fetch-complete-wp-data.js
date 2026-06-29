// Fetch all Profender products with complete category information from WordPress
import axios from 'axios';
import fs from 'fs';

async function fetchCompleteWPData() {
  try {
    console.log('🌐 Fetching complete Profender product data from WordPress...');
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
    
    // Collect all unique categories
    const allCategories = new Set();
    const productCategories = {};
    
    console.log('\n📦 Profender Products and Their Categories:');
    wpProducts.forEach((product, index) => {
      console.log(`\n${index + 1}. ${product.name}`);
      
      if (product.categories && product.categories.length > 0) {
        const categories = product.categories.map(c => c.name);
        productCategories[product.name] = categories;
        categories.forEach(cat => allCategories.add(cat));
        console.log(`   Categories: [${categories.join(', ')}]`);
      } else {
        productCategories[product.name] = [];
        console.log('   Categories: None');
      }
    });
    
    console.log(`\n📈 Total unique categories on live site: ${allCategories.size}`);
    console.log(`Categories: [${Array.from(allCategories).sort().join(', ')}]`);
    
    // Save to file for analysis
    const dataToSave = {
      products: wpProducts.map(p => ({
        name: p.name,
        categories: p.categories ? p.categories.map(c => c.name) : []
      })),
      allCategories: Array.from(allCategories).sort()
    };
    
    fs.writeFileSync('complete-wp-data.json', JSON.stringify(dataToSave, null, 2));
    console.log('\n💾 Saved complete WordPress data to complete-wp-data.json');
    
  } catch (error) {
    console.error('💥 Error fetching WordPress data:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
    }
  }
}

fetchCompleteWPData();