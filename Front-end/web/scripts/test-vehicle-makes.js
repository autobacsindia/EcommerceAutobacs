// Test WordPress API to check vehicle makes
const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

async function testVehicleMakes() {
  console.log('=== Checking Vehicle Makes ===\n');
  
  const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL;
  const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY;
  const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET;
  const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'wc/v3';
  
  if (!siteUrl || !consumerKey || !consumerSecret) {
    console.log('❌ Missing required configuration');
    return;
  }
  
  try {
    console.log('--- Checking "make" Attribute Terms ---');
    const termsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products/attributes/2/terms`;
    console.log('Terms Endpoint:', termsEndpoint);
    
    const termsResponse = await axios.get(termsEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      timeout: 15000
    });
    
    console.log('✅ Terms endpoint accessible');
    console.log('Status:', termsResponse.status);
    console.log('Total makes:', Array.isArray(termsResponse.data) ? termsResponse.data.length : 'Unknown');
    
    if (Array.isArray(termsResponse.data)) {
      console.log('\nVehicle Makes:');
      termsResponse.data.forEach(term => {
        console.log(`- ${term.name} (${term.slug}) - ID: ${term.id} - Count: ${term.count}`);
      });
    }
    
    console.log('\n--- Testing Product Filtering by Make ---');
    // Test filtering products by a specific make
    if (Array.isArray(termsResponse.data) && termsResponse.data.length > 0) {
      const firstMake = termsResponse.data[0];
      console.log(`Filtering products by make: ${firstMake.name}`);
      
      const productsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products`;
      const productsResponse = await axios.get(productsEndpoint, {
        auth: {
          username: consumerKey,
          password: consumerSecret
        },
        params: {
          attribute: 'pa_make',
          attribute_term: firstMake.id,
          per_page: 3
        },
        timeout: 15000
      });
      
      console.log('Status:', productsResponse.status);
      console.log(`Products with make "${firstMake.name}":`, Array.isArray(productsResponse.data) ? productsResponse.data.length : 'Unknown');
      
      if (Array.isArray(productsResponse.data) && productsResponse.data.length > 0) {
        console.log('\nSample products:');
        productsResponse.data.slice(0, 2).forEach(product => {
          console.log(`- ${product.name} (₹${product.price})`);
        });
      }
    }
    
    console.log('\n🎉 Vehicle makes analysis completed!');
    
  } catch (error) {
    console.log('\n❌ Vehicle Makes Test Failed');
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

testVehicleMakes();