// Verify Profender products on live site
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function verifyProfenderProducts() {
  try {
    console.log('🔍 Verifying Profender products on live site...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    console.log(`🔗 Connecting to: ${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`);
    
    // Fetch Profender products from WordPress
    console.log('🌐 Fetching Profender products from WordPress...');
    const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 100, // Get all products
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products on the live site`);
    
    // Display first few products
    console.log('\n📦 First 5 Profender products:');
    for (let i = 0; i < Math.min(5, wpProducts.length); i++) {
      const product = wpProducts[i];
      console.log(`  ${i + 1}. ${product.name}`);
      console.log(`     Price: ${product.regular_price || 'N/A'}`);
      console.log(`     SKU: ${product.sku || 'N/A'}`);
      
      // Check brand attribute
      if (product.attributes) {
        const brandAttr = product.attributes.find(attr => 
          attr.name.toLowerCase() === 'brand' || attr.name.toLowerCase() === 'manufacturer');
        if (brandAttr) {
          console.log(`     Brand Attribute: ${Array.isArray(brandAttr.options) ? brandAttr.options[0] : brandAttr.options}`);
        }
      }
      console.log('');
    }
    
    return wpProducts.length;
  } catch (error) {
    console.error('💥 Error verifying Profender products:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return 0;
  }
}

// Run verification
verifyProfenderProducts().then(count => {
  console.log(`\n✅ Verification complete. Found ${count} Profender products on the live site.`);
});