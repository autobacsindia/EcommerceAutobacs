import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function importProfenderProducts() {
  try {
    console.log('Starting Profender brand product import...');
    
    // WordPress API credentials from environment variables
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL;
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    
    if (!wordpressSiteUrl || !wordpressApiKey || !wordpressApiSecret) {
      console.error('Missing WordPress API credentials in environment variables');
      process.exit(1);
    }
    
    // Make the API call to import Profender products through our backend
    const importUrl = `http://localhost:${process.env.PORT || 5000}/api/products/import/brand/Profender`;
    
    console.log(`Making request to: ${importUrl}`);
    
    // For this to work, we need to authenticate with our backend
    // We'll need to login first to get a token
    console.log('Note: This script requires authentication. Please ensure you have valid admin credentials.');
    
    const response = await axios.post(importUrl, {}, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 second timeout
    });
    
    console.log('Import response:', response.data);
    
    if (response.data.success) {
      console.log('✅ Profender products imported successfully!');
      console.log(`Summary: ${JSON.stringify(response.data.summary, null, 2)}`);
    } else {
      console.error('❌ Failed to import Profender products:', response.data.message);
    }
  } catch (error) {
    console.error('❌ Error importing Profender products:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Status code:', error.response.status);
    }
  }
}

// Run the import
importProfenderProducts();