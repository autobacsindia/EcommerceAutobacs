// Test the updated WordPress service
const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

async function testUpdatedService() {
  console.log('=== Testing Updated WordPress Service ===\n');
  
  const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL;
  const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY;
  const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET;
  const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'wc/v3';
  
  if (!siteUrl || !consumerKey || !consumerSecret) {
    console.log('❌ Missing required configuration');
    return;
  }
  
  try {
    console.log('--- Testing Vehicle Extraction ---');
    
    // Get products to extract vehicles from
    const productsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products`;
    const productsResponse = await axios.get(productsEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      params: {
        per_page: 50
      },
      timeout: 15000
    });
    
    const products = Array.isArray(productsResponse.data) ? productsResponse.data : [];
    console.log('Retrieved', products.length, 'products');
    
    // Extract vehicles using the same logic as the service
    function extractVehiclesFromProducts(products) {
      const vehicleMap = {};
      
      products.forEach(product => {
        // Extract from product name
        const productName = product.name.toLowerCase();
        
        // Common vehicle patterns
        const patterns = [
          /(?:bmw|m3|m4|m5)\s*[a-z0-9]+/gi,
          /(?:thar|scorpio|bolero|xylo|xuv)[\s\-]?[a-z0-9]*/gi,
          /(?:hilux|fortuner|innova|prado|land\s*cruiser|camry|corolla|yaris)[\s\-]?[a-z0-9]*/gi,
          /(?:audi|a[0-9])\s*[a-z0-9]+/gi,
          /(?:mercedes|benz|c\-?class|e\-?class|s\-?class|gl[ac])[a-z0-9\-]*/gi,
          /[a-z0-9]+\s*(?:series|class)/gi
        ];
        
        patterns.forEach(pattern => {
          const matches = productName.match(pattern);
          if (matches) {
            matches.forEach(match => {
              const cleanMatch = match.trim().toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/[^a-z0-9\s\-]/g, '');
              
              if (cleanMatch.length > 2) {
                vehicleMap[cleanMatch] = (vehicleMap[cleanMatch] || 0) + 1;
              }
            });
          }
        });
        
        // Extract from tags
        if (product.tags && Array.isArray(product.tags)) {
          product.tags.forEach(tag => {
            const tagName = (tag.name || '').toLowerCase();
            // Look for vehicle-like patterns in tags
            if (tagName.includes('bmw') || tagName.includes('thar') || tagName.includes('hilux') || 
                tagName.includes('fortuner') || tagName.includes('scorpio') || tagName.includes('audi') ||
                tagName.includes('toyota') || tagName.includes('mahindra') || tagName.includes('series')) {
              vehicleMap[tagName] = (vehicleMap[tagName] || 0) + 1;
            }
          });
        }
      });
      
      // Convert to array and sort by frequency
      return Object.entries(vehicleMap)
        .sort((a, b) => b[1] - a[1])
        .map(([vehicle]) => vehicle)
        .slice(0, 10); // Top 10 vehicles
    }
    
    const vehicleNames = extractVehiclesFromProducts(products);
    console.log('\nExtracted vehicles:');
    vehicleNames.forEach((vehicle, index) => {
      console.log(`${index + 1}. ${vehicle}`);
    });
    
    console.log('\n--- Testing Product Filtering ---');
    if (vehicleNames.length > 0) {
      const testVehicle = vehicleNames[0];
      console.log(`Filtering products for: ${testVehicle}`);
      
      // Filter products that mention the vehicle
      const filteredProducts = products.filter(product => {
        const productName = (product.name || '').toLowerCase();
        const productTags = product.tags && Array.isArray(product.tags) 
          ? product.tags.map(tag => (tag.name || '').toLowerCase()).join(' ')
          : '';
        const productCategories = product.categories && Array.isArray(product.categories)
          ? product.categories.map(cat => (cat.name || '').toLowerCase()).join(' ')
          : '';
        
        const searchText = `${productName} ${productTags} ${productCategories}`;
        return searchText.includes(testVehicle);
      });
      
      console.log(`Found ${filteredProducts.length} products for ${testVehicle}:`);
      filteredProducts.slice(0, 3).forEach(product => {
        console.log(`- ${product.name} (₹${product.price})`);
      });
    }
    
    console.log('\n🎉 Updated service test completed!');
    
  } catch (error) {
    console.log('\n❌ Service Test Failed');
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

testUpdatedService();