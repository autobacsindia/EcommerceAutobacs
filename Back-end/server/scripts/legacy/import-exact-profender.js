// Import exact Profender products matching the specific request
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

async function importExactProfenderProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
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
    
    // Specific categories mentioned in the request
    const targetCategories = [
      'Lift Kit', 'Motor Vehicle Suspension Parts', 'Suspension Kit', 
      'Upper Control Arms', 'Exterior', 'Performance', 'Suspension',
      'Coil Suspension', 'Nitro Gas Shock Absorbers', 'Nitro Gas Suspension',
      'Coil Suspension', 'Suspension Kit'
    ];
    
    // Specific keywords mentioned in the request
    const targetKeywords = [
      'lift kit', 'suspension', 'performance', 'exterior', 'control arm', 
      'coil', 'nitro gas', 'upper control', 'shock absorber', 'suspension kit'
    ];
    
    console.log('\n🔍 Filtering for products matching target categories and keywords...');
    
    // Filter products that match our specific targets
    const targetProducts = wpProducts.filter(product => {
      const productName = product.name.toLowerCase();
      const productDescription = (product.description || '').toLowerCase();
      const productShortDescription = (product.short_description || '').toLowerCase();
      const productCategories = product.categories ? product.categories.map(cat => cat.name.toLowerCase()) : [];
      
      // Check if product matches any of our target keywords or categories
      const matchesKeyword = targetKeywords.some(keyword => 
        productName.includes(keyword) || 
        productDescription.includes(keyword) || 
        productShortDescription.includes(keyword)
      );
      
      const matchesCategory = productCategories.some(cat => 
        targetCategories.some(targetCat => cat.includes(targetCat.toLowerCase()))
      );
      
      // Special focus on suspension and lift kit products
      const isSuspensionRelated = productName.includes('suspension') || 
                                productName.includes('lift kit') || 
                                productName.includes('shock absorber') ||
                                productName.includes('control arm');
      
      return matchesKeyword || matchesCategory || isSuspensionRelated;
    });
    
    console.log(`🎯 Found ${targetProducts.length} target Profender products:`);
    
    targetProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
    });
    
    // If we have more than 20 products, let's prioritize the most relevant ones
    let finalProducts = targetProducts;
    if (targetProducts.length > 20) {
      console.log(`\n✂️ Limiting to 20 most relevant products...`);
      
      // Prioritize products with "King Series", "Suspension", "Lift Kit" in name
      finalProducts = targetProducts.sort((a, b) => {
        const aPriority = (a.name.includes('King Series') ? 100 : 0) +
                         (a.name.includes('Suspension') ? 50 : 0) +
                         (a.name.includes('Lift Kit') ? 30 : 0) +
                         (a.name.includes('Shock') ? 20 : 0);
                         
        const bPriority = (b.name.includes('King Series') ? 100 : 0) +
                         (b.name.includes('Suspension') ? 50 : 0) +
                         (b.name.includes('Lift Kit') ? 30 : 0) +
                         (b.name.includes('Shock') ? 20 : 0);
                         
        return bPriority - aPriority;
      }).slice(0, 20);
      
      console.log(`\n⭐ Prioritized 20 most relevant products:`);
      finalProducts.forEach((product, index) => {
        console.log(`${index + 1}. ${product.name}`);
      });
    }
    
    // Import each target product
    let importedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    
    for (const wpProduct of finalProducts) {
      console.log(`\n📦 Processing: ${wpProduct.name}`);
      
      try {
        // Handle categories - select the best category from multiple options
        let categoryId = null;
        if (wpProduct.categories && wpProduct.categories.length > 0) {
          // Look for suspension, lift kit, or performance related categories first
          const relevantCategory = wpProduct.categories.find(cat => 
            cat.name.toLowerCase().includes('suspension') || 
            cat.name.toLowerCase().includes('lift') ||
            cat.name.toLowerCase().includes('performance') ||
            cat.name.toLowerCase().includes('kit') ||
            cat.name.toLowerCase().includes('shock')
          );
          
          const categoryName = relevantCategory ? relevantCategory.name : wpProduct.categories[0].name;
          
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
    const profenderProducts = await Product.find({ brand: 'Profender', isActive: true });
    console.log(`📊 Final count of active Profender products: ${profenderProducts.length}`);
    
    // Show all active Profender products
    console.log('\n📚 All active Profender products:');
    profenderProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error importing exact Profender products:', error.message);
    console.error('📋 Error details:', error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run import
importExactProfenderProducts();