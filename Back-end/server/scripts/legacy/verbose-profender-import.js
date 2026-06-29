// Verbose script to import Profender products
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    console.log('Starting Profender product import...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    console.log(`Connecting to: ${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`);
    
    // Fetch Profender products from WordPress
    console.log('Fetching Profender products from WordPress...');
    const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 20, // We know there are 20 Profender products
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`Found ${wpProducts.length} Profender products`);
    
    let importedCount = 0;
    let failedCount = 0;
    
    // Process each product
    for (let i = 0; i < wpProducts.length; i++) {
      const wpProduct = wpProducts[i];
      console.log(`Processing product ${i + 1}/${wpProducts.length}: ${wpProduct.name}`);
      
      try {
        // Transform product data
        const productData = {
          name: wpProduct.name,
          description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '') : '', // Remove HTML tags
          price: parseFloat(wpProduct.regular_price) || 0,
          sku: wpProduct.sku || `PROFENDER-${Date.now()}-${i}`, // Generate SKU if missing
          stock: parseInt(wpProduct.stock_quantity) || 0,
          brand: 'Profender', // We know these are Profender products
          isActive: wpProduct.status === 'publish',
          isFeatured: wpProduct.featured || false
        };
        
        console.log(`  Product data:`, JSON.stringify(productData, null, 2));
        
        // Handle images
        if (wpProduct.images && Array.isArray(wpProduct.images)) {
          productData.images = wpProduct.images.map((img, index) => ({
            url: img.src,
            alt: img.alt || img.name || `Product image ${index + 1}`,
            isPrimary: index === 0
          }));
        }
        
        // Check if product already exists (by SKU)
        let existingProduct = null;
        if (productData.sku) {
          existingProduct = await Product.findOne({ sku: productData.sku });
          console.log(`  Existing product found: ${!!existingProduct}`);
        }
        
        let savedProduct;
        if (existingProduct) {
          // Update existing product
          savedProduct = await Product.findByIdAndUpdate(
            existingProduct._id,
            productData,
            { new: true, runValidators: true }
          );
          console.log(`  Updated product: ${productData.name}`);
        } else {
          // Create new product
          const product = new Product(productData);
          savedProduct = await product.save();
          console.log(`  Created product: ${productData.name}`);
        }
        
        importedCount++;
        console.log(`  Success! Imported count: ${importedCount}`);
      } catch (error) {
        console.error(`  Failed to import product ${wpProduct.name}:`, error.message);
        console.error(`  Error stack:`, error.stack);
        failedCount++;
      }
    }
    
    console.log(`\n✅ Import completed!`);
    console.log(`Successfully imported: ${importedCount} products`);
    console.log(`Failed to import: ${failedCount} products`);
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error importing Profender products:', error.message);
    console.error('Error stack:', error.stack);
    mongoose.connection.close();
  }
});