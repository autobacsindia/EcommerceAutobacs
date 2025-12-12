// Fixed Profender import script with category handling
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    // Check if we have categories, create default if not
    let categories = await Category.find({});
    let categoryId;
    
    if (categories.length === 0) {
      console.log('No categories found, creating default category...');
      const defaultCategory = new Category({
        name: 'Automotive Parts',
        slug: 'automotive-parts',
        description: 'General automotive parts and accessories'
      });
      const savedCategory = await defaultCategory.save();
      categoryId = savedCategory._id;
      console.log(`Created default category with ID: ${categoryId}`);
    } else {
      categoryId = categories[0]._id;
      console.log(`Using existing category: ${categories[0].name} (${categoryId})`);
    }
    
    console.log('Starting Profender product import...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
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
          description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '') : '',
          shortDescription: wpProduct.short_description ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) : '',
          price: parseFloat(wpProduct.regular_price) || 0,
          sku: wpProduct.sku || `PROFENDER-${Date.now()}-${i}`,
          stock: parseInt(wpProduct.stock_quantity) || 0,
          brand: 'Profender',
          category: categoryId, // Use the category we found or created
          isActive: wpProduct.status === 'publish',
          isFeatured: wpProduct.featured || false
        };
        
        // Handle images
        if (wpProduct.images && Array.isArray(wpProduct.images)) {
          productData.images = wpProduct.images.map((img, index) => ({
            url: img.src,
            alt: img.alt || img.name || `Product image ${index + 1}`,
            isPrimary: index === 0
          }));
        }
        
        // Handle specifications/attributes
        if (wpProduct.attributes && Array.isArray(wpProduct.attributes)) {
          productData.specifications = wpProduct.attributes.map(attr => ({
            key: attr.name,
            value: Array.isArray(attr.options) ? attr.options.join(', ') : attr.options
          }));
        }
        
        // Check if product already exists (by SKU)
        let existingProduct = null;
        if (productData.sku) {
          existingProduct = await Product.findOne({ sku: productData.sku });
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
        failedCount++;
      }
    }
    
    console.log(`\n✅ Import completed!`);
    console.log(`Successfully imported: ${importedCount} products`);
    console.log(`Failed to import: ${failedCount} products`);
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error importing Profender products:', error.message);
    console.error('Error details:', error.stack);
    mongoose.connection.close();
  }
});