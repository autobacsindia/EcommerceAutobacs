import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
const wordpressApiKey = process.env.WORDPRESS_API_KEY;
const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';

async function testProfenderSearch() {
  try {
    // Search for products with 'profender' in the name
    const url = `${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`;
    const response = await axios.get(url, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        search: 'profender',  // Search for profender in product names
        per_page: 10,
        status: 'publish'
      },
      timeout: 30000
    });

    console.log('Found', response.data.length, 'products matching "profender":');
    for (const product of response.data) {
      console.log('- Product:', product.name);
      console.log('  ID:', product.id);
      console.log('  Categories:', product.categories.map(cat => cat.name));
      console.log('  Attributes:', product.attributes ? product.attributes.map(attr => ({name: attr.name, options: attr.options})) : 'None');
      console.log('');
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testProfenderSearch();import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
const wordpressApiKey = process.env.WORDPRESS_API_KEY;
const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';

async function testProfenderSearch() {
  try {
    // Search for products with 'profender' in the name
    const url = `${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`;
    const response = await axios.get(url, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        search: 'profender',  // Search for profender in product names
        per_page: 10,
        status: 'publish'
      },
      timeout: 30000
    });

    console.log('Found', response.data.length, 'products matching "profender":');
    for (const product of response.data) {
      console.log('- Product:', product.name);
      console.log('  ID:', product.id);
      console.log('  Categories:', product.categories.map(cat => cat.name));
      console.log('  Attributes:', product.attributes ? product.attributes.map(attr => ({name: attr.name, options: attr.options})) : 'None');
      console.log('');
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testProfenderSearch();