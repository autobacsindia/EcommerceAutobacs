// Analyze Profender products on live site
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function analyzeProfenderProducts() {
  try {
    console.log('🔍 Analyzing Profender products on live site...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    console.log(`🔗 Connecting to: ${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`);
    
    // Fetch first 20 Profender products from WordPress
    console.log('🌐 Fetching first 20 Profender products from WordPress...');
    const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 20, // Get exactly 20 products as mentioned
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products`);
    
    // Display all products with their details
    console.log('\n📦 Profender Products:');
    for (let i = 0; i < wpProducts.length; i++) {
      const product = wpProducts[i];
      console.log(`\n${i + 1}. ${product.name}`);
      console.log(`   Price: ${product.price || product.regular_price || 'N/A'}`);
      console.log(`   SKU: ${product.sku || 'N/A'}`);
      console.log(`   Stock: ${product.stock_quantity || 'N/A'}`);
      
      // Check brand attribute
      if (product.attributes) {
        const brandAttr = product.attributes.find(attr => 
          attr.name.toLowerCase() === 'brand' || attr.name.toLowerCase() === 'manufacturer');
        if (brandAttr) {
          console.log(`   Brand Attribute: ${Array.isArray(brandAttr.options) ? brandAttr.options[0] : brandAttr.options}`);
        }
      }
      
      // Check categories
      if (product.categories && product.categories.length > 0) {
        const categories = product.categories.map(cat => cat.name).join(', ');
        console.log(`   Categories: ${categories}`);
      }
    }
    
    // Check if these match the examples provided
    const exampleProducts = [
      'Profender 2 Inch Lift Kit For Hilux',
      'Profender 2-Inch Lift Kit with Shocks for Isuzu – Off-Road Ready!',
      'Profender Heavy Duty Upper Control Arm',
      'profender king series full kit suspension for ford endeavour'
    ];
    
    console.log('\n🔍 Checking for example products:');
    exampleProducts.forEach(example => {
      const found = wpProducts.some(product => 
        product.name.toLowerCase().includes(example.toLowerCase().replace('profender', '').trim())
      );
      console.log(`  ${found ? '✅' : '❌'} ${example}`);
    });
    
    return wpProducts;
  } catch (error) {
    console.error('💥 Error analyzing Profender products:', error.message);
    if (error.response) {
      console.error('📋 Response status:', error.response.status);
      // Don't log response data as it might be large
    }
    return [];
  }
}

// Run analysis
analyzeProfenderProducts().then(products => {
  console.log(`\n✅ Analysis complete. Found ${products.length} Profender products.`);
});