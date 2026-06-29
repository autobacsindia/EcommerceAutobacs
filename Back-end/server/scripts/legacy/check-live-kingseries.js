// Check for King Series products on live site
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function checkLiveKingSeries() {
  try {
    console.log('🌐 Fetching Profender products from live site...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    // Fetch all Profender products from WordPress
    const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 100, // Get all products to be sure
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products on live site`);
    
    // Filter for King Series products
    const kingSeries = wpProducts.filter(p => p.name.toLowerCase().includes('king series'));
    
    console.log(`\n🏆 Found ${kingSeries.length} King Series products on live site:`);
    kingSeries.forEach(p => console.log(`- ${p.name}`));
    
  } catch (error) {
    console.error('💥 Error checking live King Series products:', error.message);
  }
}

// Run check
checkLiveKingSeries();