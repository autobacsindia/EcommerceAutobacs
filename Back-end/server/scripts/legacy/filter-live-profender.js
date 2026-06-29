// Filter live Profender products by specific categories
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

async function filterLiveProfenderProducts() {
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
    
    // Categories/slugs mentioned in the request
    const relevantKeywords = [
      'lift kit', 'suspension', 'performance', 'exterior', 'control arm', 
      'coil', 'nitro gas', 'upper control', 'shock absorber'
    ];
    
    console.log('\n🔍 Filtering for products matching relevant keywords...');
    
    // Filter products that match our categories
    const filteredProducts = wpProducts.filter(product => {
      const productName = product.name.toLowerCase();
      const productDescription = (product.description || '').toLowerCase();
      const productShortDescription = (product.short_description || '').toLowerCase();
      
      // Check if product matches any of our keywords
      return relevantKeywords.some(keyword => 
        productName.includes(keyword) || 
        productDescription.includes(keyword) || 
        productShortDescription.includes(keyword)
      );
    });
    
    console.log(`\n🎯 Found ${filteredProducts.length} Profender products matching relevant categories:`);
    
    filteredProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
    });
    
    // Check specifically for the King Series suspension products
    console.log('\n🏆 Checking for King Series suspension products...');
    const kingSeriesProducts = wpProducts.filter(product => 
      product.name.toLowerCase().includes('king') && 
      product.name.toLowerCase().includes('series') &&
      product.name.toLowerCase().includes('suspension')
    );
    
    console.log(`\nFound ${kingSeriesProducts.length} King Series suspension products:`);
    kingSeriesProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
    });
    
    // Count products by category
    console.log('\n📊 Product count by category:');
    const categoryCount = {};
    
    wpProducts.forEach(product => {
      if (product.categories && product.categories.length > 0) {
        product.categories.forEach(category => {
          categoryCount[category.name] = (categoryCount[category.name] || 0) + 1;
        });
      }
    });
    
    Object.entries(categoryCount)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`   ${category}: ${count}`);
      });
      
  } catch (error) {
    console.error('💥 Error filtering live Profender products:', error.message);
  }
}

// Run filter
filterLiveProfenderProducts();