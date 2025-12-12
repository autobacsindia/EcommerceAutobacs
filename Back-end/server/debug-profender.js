// Debug script to check what's happening with Profender product import
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function debugImport() {
  try {
    console.log('Debugging Profender product import...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    console.log('WordPress Site URL:', wordpressSiteUrl);
    console.log('API Key exists:', !!wordpressApiKey);
    console.log('API Secret exists:', !!wordpressApiSecret);
    
    // Fetch Profender products from WordPress
    console.log('Fetching Profender products from WordPress...');
    const url = `${wordpressSiteUrl.replace(/\/$/, '')}/wp-json/${wordpressApiVersion}/products`;
    console.log('Request URL:', url);
    
    const response = await axios.get(url, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 5,
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    console.log('Response status:', response.status);
    console.log('Found products:', response.data.length);
    
    if (response.data.length > 0) {
      const firstProduct = response.data[0];
      console.log('First product name:', firstProduct.name);
      console.log('First product SKU:', firstProduct.sku);
      console.log('First product price:', firstProduct.regular_price);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

debugImport();