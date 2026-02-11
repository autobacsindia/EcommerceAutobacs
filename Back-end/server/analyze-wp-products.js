import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

async function analyzeWpProducts() {
  try {
    console.log('Connecting to WordPress...');
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';

    const statuses = ['publish', 'draft', 'pending', 'private', 'future'];
    
    for (const status of statuses) {
        const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
            auth: { username: wordpressApiKey, password: wordpressApiSecret },
            params: { per_page: 1, status: status },
            timeout: 30000
        });
        const total = parseInt(response.headers['x-wp-total']) || 0;
        console.log(`Status '${status}': ${total} products`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

analyzeWpProducts();
