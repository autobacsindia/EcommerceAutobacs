// Test WordPress API connectivity and check for vehicle-related data
const axios = require('axios');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

async function testWordPressAPI() {
  console.log('=== WordPress API Connectivity Test ===\n');
  
  const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL;
  const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY;
  const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET;
  const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || 'wc/v3';
  
  console.log('Configuration:');
  console.log('- Site URL:', siteUrl);
  console.log('- API Version:', apiVersion);
  console.log('- Consumer Key:', consumerKey ? 'SET' : 'NOT SET');
  console.log('- Consumer Secret:', consumerSecret ? 'SET' : 'NOT SET');
  
  if (!siteUrl || !consumerKey || !consumerSecret) {
    console.log('\n❌ Missing required configuration');
    return;
  }
  
  try {
    console.log('\n--- Testing WooCommerce Products Endpoint ---');
    const productsEndpoint = `${siteUrl}/wp-json/${apiVersion}/products`;
    console.log('Products Endpoint:', productsEndpoint);
    
    const productsResponse = await axios.get(productsEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      params: {
        per_page: 3
      },
      timeout: 15000
    });
    
    console.log('✅ Products endpoint accessible');
    console.log('Status:', productsResponse.status);
    console.log('Products count:', Array.isArray(productsResponse.data) ? productsResponse.data.length : 'Unknown');
    
    // Analyze product structure to see if there's vehicle data
    if (Array.isArray(productsResponse.data) && productsResponse.data.length > 0) {
      console.log('\nAnalyzing product structure for vehicle data...');
      
      productsResponse.data.forEach((product, index) => {
        console.log(`\n--- Product ${index + 1}: ${product.name} ---`);
        console.log('- ID:', product.id);
        console.log('- Name:', product.name);
        console.log('- Price:', product.price);
        
        // Check for categories
        if (product.categories && product.categories.length > 0) {
          console.log('- Categories:');
          product.categories.forEach(cat => {
            console.log(`  • ${cat.name} (${cat.slug})`);
          });
        }
        
        // Check for tags
        if (product.tags && product.tags.length > 0) {
          console.log('- Tags:');
          product.tags.forEach(tag => {
            console.log(`  • ${tag.name} (${tag.slug})`);
          });
        }
        
        // Check for attributes
        if (product.attributes && product.attributes.length > 0) {
          console.log('- Attributes:');
          product.attributes.forEach(attr => {
            console.log(`  • ${attr.name} (${attr.slug}):`, attr.options ? attr.options.join(', ') : 'No options');
          });
        }
        
        // Check for custom fields/meta data
        if (product.meta_data && product.meta_data.length > 0) {
          console.log('- Meta Data (first 5):');
          product.meta_data.slice(0, 5).forEach(meta => {
            console.log(`  • ${meta.key}: ${meta.value}`);
          });
        }
      });
    }
    
    console.log('\n--- Checking Product Categories ---');
    const categoriesEndpoint = `${siteUrl}/wp-json/${apiVersion}/products/categories`;
    console.log('Categories Endpoint:', categoriesEndpoint);
    
    const categoriesResponse = await axios.get(categoriesEndpoint, {
      auth: {
        username: consumerKey,
        password: consumerSecret
      },
      params: {
        per_page: 20
      },
      timeout: 10000
    });
    
    console.log('✅ Categories endpoint accessible');
    console.log('Status:', categoriesResponse.status);
    console.log('Total categories:', Array.isArray(categoriesResponse.data) ? categoriesResponse.data.length : 'Unknown');
    
    // Look for vehicle-related categories
    if (Array.isArray(categoriesResponse.data)) {
      console.log('\nLooking for vehicle-related categories...');
      const vehicleCategories = categoriesResponse.data.filter(cat => 
        cat.name.toLowerCase().includes('vehicle') || 
        cat.name.toLowerCase().includes('car') ||
        cat.name.toLowerCase().includes('bike') ||
        cat.name.toLowerCase().includes('bmw') ||
        cat.name.toLowerCase().includes('toyota') ||
        cat.name.toLowerCase().includes('mahindra') ||
        cat.slug.toLowerCase().includes('vehicle') || 
        cat.slug.toLowerCase().includes('car') ||
        cat.slug.toLowerCase().includes('bike') ||
        cat.slug.toLowerCase().includes('bmw') ||
        cat.slug.toLowerCase().includes('toyota') ||
        cat.slug.toLowerCase().includes('mahindra')
      );
      
      if (vehicleCategories.length > 0) {
        console.log('✅ Found potential vehicle-related categories:');
        vehicleCategories.forEach(cat => {
          console.log(`  • ${cat.name} (${cat.slug}) - ID: ${cat.id}`);
        });
      } else {
        console.log('No obvious vehicle-related categories found.');
      }
      
      console.log('\nAll categories:');
      categoriesResponse.data.slice(0, 10).forEach(cat => {
        console.log(`  • ${cat.name} (${cat.slug}) - ID: ${cat.id}`);
      });
      if (categoriesResponse.data.length > 10) {
        console.log(`  ... and ${categoriesResponse.data.length - 10} more`);
      }
    }
    
    console.log('\n--- Checking Product Attributes ---');
    const attributesEndpoint = `${siteUrl}/wp-json/${apiVersion}/products/attributes`;
    console.log('Attributes Endpoint:', attributesEndpoint);
    
    try {
      const attributesResponse = await axios.get(attributesEndpoint, {
        auth: {
          username: consumerKey,
          password: consumerSecret
        },
        timeout: 10000
      });
      
      console.log('✅ Attributes endpoint accessible');
      console.log('Status:', attributesResponse.status);
      console.log('Total attributes:', Array.isArray(attributesResponse.data) ? attributesResponse.data.length : 'Unknown');
      
      // Look for vehicle-related attributes
      if (Array.isArray(attributesResponse.data)) {
        console.log('\nLooking for vehicle-related attributes...');
        const vehicleAttributes = attributesResponse.data.filter(attr => 
          attr.name.toLowerCase().includes('vehicle') || 
          attr.name.toLowerCase().includes('car') ||
          attr.name.toLowerCase().includes('make') ||
          attr.name.toLowerCase().includes('model') ||
          attr.slug.toLowerCase().includes('vehicle') || 
          attr.slug.toLowerCase().includes('car') ||
          attr.slug.toLowerCase().includes('make') ||
          attr.slug.toLowerCase().includes('model')
        );
        
        if (vehicleAttributes.length > 0) {
          console.log('✅ Found potential vehicle-related attributes:');
          vehicleAttributes.forEach(attr => {
            console.log(`  • ${attr.name} (${attr.slug}) - ID: ${attr.id}`);
          });
        } else {
          console.log('No obvious vehicle-related attributes found.');
        }
        
        console.log('\nAll attributes:');
        attributesResponse.data.slice(0, 10).forEach(attr => {
          console.log(`  • ${attr.name} (${attr.slug}) - ID: ${attr.id}`);
        });
        if (attributesResponse.data.length > 10) {
          console.log(`  ... and ${attributesResponse.data.length - 10} more`);
        }
      }
    } catch (attrError) {
      console.log('Attributes endpoint error:', attrError.message);
    }
    
    console.log('\n🎉 WordPress API analysis completed!');
    
  } catch (error) {
    console.log('\n❌ WordPress API Test Failed');
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

testWordPressAPI();