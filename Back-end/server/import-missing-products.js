// Import specific missing Profender products
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

async function importMissingProfenderProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('🚀 Starting import of specific missing Profender products...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    // Fetch all Profender products from WordPress to find the specific ones
    console.log('🌐 Fetching all Profender products from WordPress...');
    const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 50, // Get all products to be sure
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products on live site`);
    
    // Identify the specific products we need to import
    const targetProducts = [
      "Profender King Series Full Kit Suspension For Toyota fortuner",
      "profender king series full kit suspension for ford endeavour"
    ];
    
    console.log('\n🔍 Looking for specific products...');
    const productsToImport = wpProducts.filter(wpProduct => 
      targetProducts.some(target => 
        wpProduct.name.toLowerCase().includes(target.toLowerCase().replace('profender ', ''))
      )
    );
    
    console.log(`🎯 Found ${productsToImport.length} target products to import`);
    
    if (productsToImport.length === 0) {
      console.log('⚠️ No matching products found. Let\'s check what products we have:');
      wpProducts.forEach((p, i) => {
        console.log(`${i + 1}. ${p.name}`);
      });
      await mongoose.connection.close();
      return;
    }
    
    // Import each target product
    let importedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    
    for (const wpProduct of productsToImport) {
      console.log(`\n📦 Processing: ${wpProduct.name}`);
      
      try {
        // Handle categories - select the best category from multiple options
        let categoryId = null;
        if (wpProduct.categories && wpProduct.categories.length > 0) {
          // For suspension and lift kit products, we want specific categories
          const categoryName = wpProduct.categories.find(cat => 
            cat.name.toLowerCase().includes('suspension') || 
            cat.name.toLowerCase().includes('lift') ||
            cat.name.toLowerCase().includes('kit')
          )?.name || wpProduct.categories[0].name;
          
          // Find or create category
          let category = await Category.findOne({ 
            $or: [
              { name: categoryName },
              { slug: categoryName.toLowerCase().replace(/\s+/g, '-') }
            ]
          });
          
          if (!category) {
            // Create new category
            console.log(`   ➕ Creating new category: ${categoryName}`);
            category = new Category({
              name: categoryName,
              slug: categoryName.toLowerCase().replace(/\s+/g, '-'),
              description: `Category for ${categoryName}`
            });
            await category.save();
            console.log(`   ✅ Created category with ID: ${category._id}`);
          } else {
            console.log(`   🔍 Found existing category: ${category.name} (${category._id})`);
          }
          
          categoryId = category._id;
        }
        
        // Transform product data
        const productData = {
          name: wpProduct.name,
          description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '') : '',
          shortDescription: wpProduct.short_description ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) : wpProduct.name.substring(0, 200),
          price: parseFloat(wpProduct.price || wpProduct.regular_price) || 0,
          sku: wpProduct.sku || `PROFENDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          stock: parseInt(wpProduct.stock_quantity) || 0,
          brand: 'Profender',
          category: categoryId,
          isActive: wpProduct.status === 'publish',
          isFeatured: wpProduct.featured || false
        };
        
        console.log(`   💰 Price: ${productData.price}`);
        console.log(`   📦 SKU: ${productData.sku}`);
        console.log(`   📦 Stock: ${productData.stock}`);
        console.log(`   📂 Category ID: ${productData.category || 'None'}`);
        
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
        
        // Check if product already exists
        let existingProduct = await Product.findOne({ 
          name: productData.name,
          brand: 'Profender'
        });
        
        console.log(`   🔍 Existing product found: ${!!existingProduct}`);
        
        if (existingProduct) {
          // Update existing product
          await Product.findByIdAndUpdate(
            existingProduct._id,
            productData,
            { new: true, runValidators: true }
          );
          console.log(`   ✅ Updated product: ${productData.name}`);
          updatedCount++;
        } else {
          // Create new product
          const product = new Product(productData);
          await product.save();
          console.log(`   ➕ Created product: ${productData.name}`);
          importedCount++;
        }
        
      } catch (error) {
        console.error(`   ❌ Failed to import product ${wpProduct.name}:`, error.message);
        failedCount++;
      }
    }
    
    console.log(`\n🎉 Import completed!`);
    console.log(`✅ Successfully imported: ${importedCount} new products`);
    console.log(`✅ Successfully updated: ${updatedCount} existing products`);
    console.log(`❌ Failed to import: ${failedCount} products`);
    
    // Final verification
    console.log('\n🔍 Verifying import...');
    const profenderProducts = await Product.find({ brand: 'Profender' });
    console.log(`📊 Final count of Profender products: ${profenderProducts.length}`);
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error importing missing Profender products:', error.message);
    console.error('📋 Error details:', error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run import
importMissingProfenderProducts();