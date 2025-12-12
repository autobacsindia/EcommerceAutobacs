import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function testWordPressAPI() {
  try {
    console.log('Testing WordPress API connection...');
    
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    if (!wordpressSiteUrl || !wordpressApiKey || !wordpressApiSecret) {
      console.error('Missing WordPress API credentials in environment variables');
      process.exit(1);
    }
    
    // Test basic connection to WordPress API
    console.log('Testing basic WordPress API connection...');
    const testUrl = `${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`;
    
    const response = await axios.get(testUrl, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 5,
        status: 'publish'
      },
      timeout: 30000
    });
    
    console.log(`✅ Connected successfully! Found ${response.data.length} products`);
    
    // Now test fetching products by brand
    console.log('Testing brand-specific product fetch...');
    const brandTestUrl = `${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`;
    
    const brandResponse = await axios.get(brandTestUrl, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 10,
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    console.log(`✅ Brand search successful! Found ${brandResponse.data.length} Profender products`);
    
    // Display some product information
    if (brandResponse.data.length > 0) {
      console.log('\nFirst Profender product:');
      const firstProduct = brandResponse.data[0];
      console.log(`- Name: ${firstProduct.name}`);
      console.log(`- Price: ${firstProduct.price}`);
      console.log(`- SKU: ${firstProduct.sku || 'N/A'}`);
      
      // Check if brand attribute is present
      if (firstProduct.attributes && firstProduct.attributes.length > 0) {
        console.log('- Attributes:');
        firstProduct.attributes.forEach(attr => {
          console.log(`  * ${attr.name}: ${Array.isArray(attr.options) ? attr.options.join(', ') : attr.options}`);
        });
      }
    }
    
    return { 
      success: true, 
      totalProducts: brandResponse.data.length,
      products: brandResponse.data.slice(0, 3) // Return first 3 products
    };
  } catch (error) {
    console.error('❌ Error testing WordPress API:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return { success: false, error: error.message };
  }
}

// Run the test
testWordPressAPI();