// Analyze products for vehicle mentions
const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

async function analyzeProductsForVehicles() {
  console.log('=== Analyzing Products for Vehicle Mentions ===\n');
  
  const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL;
  const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY;
  const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET;
  const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'wc/v3';
  
  if (!siteUrl || !consumerKey || !consumerSecret) {
    console.log('❌ Missing required configuration');
    return;
  }
  
  try {
    // Get vehicle makes
    console.log('--- Getting Vehicle Makes ---');
    const termsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products/attributes/2/terms`;
    const termsResponse = await axios.get(termsEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      timeout: 15000
    });
    
    const vehicleMakes = Array.isArray(termsResponse.data) ? termsResponse.data : [];
    console.log('Found', vehicleMakes.length, 'vehicle makes');
    
    // Extract make names for searching
    const makeNames = vehicleMakes.map(make => make.name.toLowerCase());
    console.log('Vehicle makes to search for:', makeNames.join(', '));
    
    // Get a larger sample of products
    console.log('\n--- Getting Product Sample ---');
    const productsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products`;
    const productsResponse = await axios.get(productsEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      params: {
        per_page: 50  // Get more products to analyze
      },
      timeout: 30000
    });
    
    const products = Array.isArray(productsResponse.data) ? productsResponse.data : [];
    console.log('Retrieved', products.length, 'products');
    
    // Analyze products for vehicle mentions
    console.log('\n--- Analyzing Products for Vehicle Mentions ---');
    const productVehicleMatches = {};
    
    products.forEach(product => {
      // Check product name
      const productName = product.name.toLowerCase();
      
      // Check tags
      const productTags = product.tags && Array.isArray(product.tags) 
        ? product.tags.map(tag => tag.name.toLowerCase()).join(' ') 
        : '';
      
      // Check categories
      const productCategories = product.categories && Array.isArray(product.categories)
        ? product.categories.map(cat => cat.name.toLowerCase()).join(' ')
        : '';
      
      // Combine all text to search
      const searchText = `${productName} ${productTags} ${productCategories}`;
      
      // Check for matches with vehicle makes
      makeNames.forEach(makeName => {
        if (searchText.includes(makeName)) {
          if (!productVehicleMatches[makeName]) {
            productVehicleMatches[makeName] = [];
          }
          productVehicleMatches[makeName].push({
            id: product.id,
            name: product.name,
            price: product.price
          });
        }
      });
    });
    
    // Display results
    console.log('\n--- Vehicle Mentions in Products ---');
    Object.keys(productVehicleMatches).forEach(makeName => {
      console.log(`\n${makeName.toUpperCase()}:`);
      console.log(`  Found in ${productVehicleMatches[makeName].length} products:`);
      productVehicleMatches[makeName].slice(0, 3).forEach(product => {
        console.log(`    - ${product.name} (₹${product.price})`);
      });
      if (productVehicleMatches[makeName].length > 3) {
        console.log(`    ... and ${productVehicleMatches[makeName].length - 3} more`);
      }
    });
    
    // Show makes with no matches
    const unmatchedMakes = makeNames.filter(makeName => !productVehicleMatches[makeName]);
    if (unmatchedMakes.length > 0) {
      console.log('\n--- Vehicle Makes with No Product Matches ---');
      unmatchedMakes.forEach(makeName => {
        console.log(`- ${makeName.toUpperCase()}`);
      });
    }
    
    console.log('\n🎉 Product analysis completed!');
    
  } catch (error) {
    console.log('\n❌ Product Analysis Failed');
    console.log('Error:', error.message);
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Status Text:', error.response.statusText);
      if (error.response.data) {
        console.log('Response Data:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }
}

analyzeProductsForVehicles();