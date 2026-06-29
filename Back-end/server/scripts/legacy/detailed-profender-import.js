// Detailed logging version of Profender import
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
    // Check if we have categories, create default if not
    console.log('🔍 Checking for existing categories...');
    let categories = await Category.find({});
    let categoryId;
    
    if (categories.length === 0) {
      console.log('🆕 No categories found, creating default category...');
      const defaultCategory = new Category({
        name: 'Automotive Parts',
        slug: 'automotive-parts',
        description: 'General automotive parts and accessories'
      });
      const savedCategory = await defaultCategory.save();
      categoryId = savedCategory._id;
      console.log(`✅ Created default category with ID: ${categoryId}`);
    } else {
      categoryId = categories[0]._id;
      console.log(`✅ Using existing category: ${categories[0].name} (${categoryId})`);
    }
    
    console.log('🚀 Starting Profender product import...');
    
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
        per_page: 20, // We know there are 20 Profender products
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products`);
    
    if (wpProducts.length === 0) {
      console.log('⚠️ No Profender products found. Let\'s check what brands exist...');
      
      // Let's check what products we can get without brand filtering
      console.log('🔄 Fetching first 5 products to see what brands exist...');
      const allProductsResponse = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
        auth: {
          username: wordpressApiKey,
          password: wordpressApiSecret
        },
        params: {
          per_page: 5,
          status: 'publish'
        },
        timeout: 30000
      });
      
      const sampleProducts = allProductsResponse.data;
      console.log(`📋 Sample products found: ${sampleProducts.length}`);
      
      sampleProducts.forEach((product, index) => {
        console.log(`  ${index + 1}. ${product.name}`);
        if (product.attributes) {
          const brandAttr = product.attributes.find(attr => 
            attr.name.toLowerCase() === 'brand' || attr.name.toLowerCase() === 'manufacturer');
          if (brandAttr) {
            console.log(`     Brand: ${Array.isArray(brandAttr.options) ? brandAttr.options[0] : brandAttr.options}`);
          } else {
            console.log('     No brand attribute found');
          }
        }
      });
      
      mongoose.connection.close();
      return;
    }
    
    let importedCount = 0;
    let failedCount = 0;
    
    // Process each product
    for (let i = 0; i < wpProducts.length; i++) {
      const wpProduct = wpProducts[i];
      console.log(`\n📦 Processing product ${i + 1}/${wpProducts.length}: ${wpProduct.name}`);
      
      try {
        // Transform product data
        const productData = {
          name: wpProduct.name,
          description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '') : '',
          shortDescription: wpProduct.short_description ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) : wpProduct.name.substring(0, 200),
          price: parseFloat(wpProduct.regular_price) || 0,
          sku: wpProduct.sku || `PROFENDER-${Date.now()}-${i}`,
          stock: parseInt(wpProduct.stock_quantity) || 0,
          brand: 'Profender',
          category: categoryId,
          isActive: wpProduct.status === 'publish',
          isFeatured: wpProduct.featured || false
        };
        
        console.log(`   💰 Price: ${productData.price}`);
        console.log(`   📦 SKU: ${productData.sku}`);
        console.log(`   📦 Stock: ${productData.stock}`);
        
        // Handle images
        if (wpProduct.images && Array.isArray(wpProduct.images)) {
          productData.images = wpProduct.images.map((img, index) => ({
            url: img.src,
            alt: img.alt || img.name || `Product image ${index + 1}`,
            isPrimary: index === 0
          }));
          console.log(`   🖼️ Images: ${productData.images.length}`);
        }
        
        // Handle specifications/attributes
        if (wpProduct.attributes && Array.isArray(wpProduct.attributes)) {
          productData.specifications = wpProduct.attributes.map(attr => ({
            key: attr.name,
            value: Array.isArray(attr.options) ? attr.options.join(', ') : attr.options
          }));
          console.log(`   📋 Specifications: ${productData.specifications.length}`);
        }
        
        // Check if product already exists (by SKU)
        let existingProduct = null;
        if (productData.sku) {
          existingProduct = await Product.findOne({ sku: productData.sku });
          console.log(`   🔍 Existing product found: ${!!existingProduct}`);
        }
        
        let savedProduct;
        if (existingProduct) {
          // Update existing product
          savedProduct = await Product.findByIdAndUpdate(
            existingProduct._id,
            productData,
            { new: true, runValidators: true }
          );
          console.log(`   ✅ Updated product: ${productData.name}`);
        } else {
          // Create new product
          const product = new Product(productData);
          savedProduct = await product.save();
          console.log(`   ➕ Created product: ${productData.name}`);
        }
        
        importedCount++;
        console.log(`   📈 Progress: ${importedCount}/${wpProducts.length} products imported`);
      } catch (error) {
        console.error(`   ❌ Failed to import product ${wpProduct.name}:`, error.message);
        failedCount++;
      }
    }
    
    console.log(`\n🎉 Import completed!`);
    console.log(`✅ Successfully imported: ${importedCount} products`);
    console.log(`❌ Failed to import: ${failedCount} products`);
    
    // Final verification
    console.log('\n🔍 Verifying import...');
    const profenderProducts = await Product.find({ brand: 'Profender' });
    console.log(`📊 Final count of Profender products: ${profenderProducts.length}`);
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error importing Profender products:', error.message);
    console.error('📋 Error details:', error.stack);
    mongoose.connection.close();
  }
});