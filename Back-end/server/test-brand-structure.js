import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
const wordpressApiKey = process.env.WORDPRESS_API_KEY;
const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';

async function testBrandStructure() {
  try {
    // Fetch first page of products to see their structure
    const url = `${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`;
    const response = await axios.get(url, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        page: 1,
        per_page: 10, // Get first 10 products to check structure
        status: 'publish'
      },
      timeout: 30000
    });

    console.log('Products fetched:', response.data.length);
    
    // Check each product for brand-related information
    for (let i = 0; i < response.data.length; i++) {
      const product = response.data[i];
      console.log(`\\n--- Product ${i+1}: ${product.name} ---`);
      
      // Check name for brand mentions
      console.log('Name:', product.name);
      
      // Check categories
      if (product.categories && product.categories.length > 0) {
        console.log('Categories:', product.categories.map(cat => `${cat.name} (${cat.slug})`));
      }
      
      // Check tags
      if (product.tags && product.tags.length > 0) {
        console.log('Tags:', product.tags.map(tag => `${tag.name} (${tag.slug})`));
      }
      
      // Check attributes
      if (product.attributes && product.attributes.length > 0) {
        console.log('Attributes:');
        product.attributes.forEach(attr => {
          console.log(`  - ${attr.name}:`, attr.options);
        });
      }
      
      // Check meta_data
      if (product.meta_data && product.meta_data.length > 0) {
        console.log('Meta Data:');
        product.meta_data.forEach(meta => {
          console.log(`  - ${meta.key}:`, meta.value);
        });
      }
      
      // Check if this product is related to any of our target brands
      const targetBrands = ['profender', 'bushranger', 'ironman', 'dr nano', 'lightforce', 'option4wd'];
      const productNameLower = product.name.toLowerCase();
      
      let foundBrand = false;
      for (const brand of targetBrands) {
        if (productNameLower.includes(brand)) {
          console.log(`\\n>>> FOUND ${brand.toUpperCase()} in product name! <<<`);
          foundBrand = true;
        }
      }
      
      if (!foundBrand && product.categories) {
        for (const cat of product.categories) {
          if (targetBrands.some(brand => cat.name.toLowerCase().includes(brand))) {
            console.log(`\\n>>> FOUND brand in category: ${cat.name} <<<`);
            foundBrand = true;
          }
        }
      }
      
      if (!foundBrand && product.tags) {
        for (const tag of product.tags) {
          if (targetBrands.some(brand => tag.name.toLowerCase().includes(brand))) {
            console.log(`\\n>>> FOUND brand in tag: ${tag.name} <<<`);
            foundBrand = true;
          }
        }
      }
      
      if (!foundBrand && product.attributes) {
        for (const attr of product.attributes) {
          if (attr.options) {
            for (const option of (Array.isArray(attr.options) ? attr.options : [attr.options])) {
              if (targetBrands.some(brand => option.toLowerCase().includes(brand))) {
                console.log(`\\n>>> FOUND brand in attribute ${attr.name}: ${option} <<<`);
                foundBrand = true;
              }
            }
          }
        }
      }
    }
    
    await checkSpecificBrandProducts();
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

async function checkSpecificBrandProducts() {
  console.log('\\n--- Checking for Profender products specifically ---');
  
  try {
    // Try searching for products with 'profender' in the name
    const searchUrl = `${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`;
    const searchResponse = await axios.get(searchUrl, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        search: 'Profender',  // Search for profender in product names
        per_page: 20,
        status: 'publish'
      },
      timeout: 30000
    });

    console.log(`Found ${searchResponse.data.length} products matching 'Profender':`);
    for (const product of searchResponse.data) {
      console.log(`- ${product.name} (ID: ${product.id})`);
    }
    
    // Also try a broader search
    const broadSearchResponse = await axios.get(searchUrl, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        search: 'brand',  // Search for products with 'brand' in the name
        per_page: 20,
        status: 'publish'
      },
      timeout: 30000
    });
    
    console.log(`\\nFound ${broadSearchResponse.data.length} products matching 'brand':`);
    for (const product of broadSearchResponse.data) {
      console.log(`- ${product.name} (ID: ${product.id})`);
    }
  } catch (error) {
    console.error('Error in specific brand search:', error.message);
  }
}

testBrandStructure();