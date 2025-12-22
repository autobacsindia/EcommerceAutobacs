// Test the vehicles page functionality
const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

async function testVehiclesPage() {
  console.log('=== Testing Vehicles Page Functionality ===\n');
  
  const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL;
  const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY;
  const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET;
  const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'wc/v3';
  
  if (!siteUrl || !consumerKey || !consumerSecret) {
    console.log('❌ Missing required configuration');
    console.log('Site URL:', siteUrl ? '✓ Set' : '✗ Missing');
    console.log('Consumer Key:', consumerKey ? '✓ Set' : '✗ Missing');
    console.log('Consumer Secret:', consumerSecret ? '✓ Set' : '✗ Missing');
    return;
  }
  
  console.log('✅ WordPress API Configuration:');
  console.log('  Site URL:', siteUrl);
  console.log('  API Version:', apiVersion);
  console.log('  Consumer Key:', consumerKey ? '✓ Set' : '✗ Missing');
  console.log('  Consumer Secret:', consumerSecret ? '✓ Set' : '✗ Missing');
  
  try {
    console.log('\n--- Testing WordPress API Connectivity ---');
    
    // Test basic connectivity
    const healthEndpoint = `${siteUrl}/wp-json`;
    console.log('Testing endpoint:', healthEndpoint);
    
    const healthResponse = await axios.get(healthEndpoint, {
      timeout: 10000
    });
    
    console.log('✅ WordPress REST API is accessible');
    console.log('  Status:', healthResponse.status);
    
    // Test WooCommerce products endpoint
    console.log('\n--- Testing WooCommerce Products Endpoint ---');
    const productsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products`;
    console.log('Testing endpoint:', productsEndpoint);
    
    const productsResponse = await axios.get(productsEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      params: {
        per_page: 5
      },
      timeout: 15000
    });
    
    console.log('✅ WooCommerce Products API is accessible');
    console.log('  Status:', productsResponse.status);
    console.log('  Retrieved', Array.isArray(productsResponse.data) ? productsResponse.data.length : 0, 'products');
    
    if (Array.isArray(productsResponse.data) && productsResponse.data.length > 0) {
      console.log('  Sample product:', productsResponse.data[0].name);
    }
    
    console.log('\n🎉 Vehicles page should work correctly!');
    console.log('The WordPress service is properly configured and accessible.');
    
  } catch (error) {
    console.log('\n❌ Test Failed');
    console.log('Error:', error.message);
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Status Text:', error.response.statusText);
      if (error.response.data) {
        console.log('Response Data:', JSON.stringify(error.response.data, null, 2));
      }
    }
    
    console.log('\n🔧 Troubleshooting Tips:');
    console.log('1. Check your WordPress site URL in .env.local');
    console.log('2. Verify your Consumer Key and Secret are correct');
    console.log('3. Ensure your WordPress site has the WooCommerce plugin installed');
    console.log('4. Confirm the REST API is enabled on your WordPress site');
  }
}

testVehiclesPage();