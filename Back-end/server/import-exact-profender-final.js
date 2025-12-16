// Import exact Profender products with correct categories from live site
import dotenv from 'dotenv';
import axios from 'axios';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Define category priority - more specific categories should come first
const CATEGORY_PRIORITY = [
  // Very specific product type categories
  'Snorkel', 'Bullbar', 'Canopy', 'Bumper', 'Grill', 'Bonnet Hood', 'Tailgate Cover',
  'Body Kit', 'Conversion Kit', 'Suspension Kit', 'Lift Kit', 'Light Bar', 'Driving Lights',
  'LED Lights', 'Headlights', 'Tail Light', 'Brake Kit', 'Coilovers', 'Shock Absorbers',
  'Spoiler', 'Diffusers', 'Air Intake', 'Exhaust', 'Winch', 'Awning',
  
  // Vehicle-specific categories (when not combined with other specific types)
  'Toyota', 'Ford', 'Mahindra', 'BMW', 'Honda', 'Land Rover', 'Mini Cooper',
  'Jeep', 'Nissan', 'Mazda', 'Volkswagen', 'Mercedes-Benz', 'Audi',
  
  // Feature-based categories
  'Performance', 'Lighting', 'Exterior', 'Interior', 'Engine Parts', 'Suspension',
  'Brake System', 'Electronics', 'Audio', 'Protection Kit', 'Accessories',
  
  // General categories
  'Body Parts', 'Exterior Accessories', 'Parts',
  
  // Fallback categories (least specific)
  'Autobacs India', 'Other'
];

async function selectBestCategory(categories) {
  // If only one category, return it
  if (categories.length === 1) {
    return categories[0];
  }
  
  // Sort categories by priority
  const sortedCategories = [...categories].sort((a, b) => {
    const indexA = CATEGORY_PRIORITY.findIndex(name => 
      a.name.toLowerCase().includes(name.toLowerCase()));
    const indexB = CATEGORY_PRIORITY.findIndex(name => 
      b.name.toLowerCase().includes(name.toLowerCase()));
    
    // If neither is in priority list, they're equal
    if (indexA === -1 && indexB === -1) return 0;
    
    // If only A is in priority list, A comes first
    if (indexA !== -1 && indexB === -1) return -1;
    
    // If only B is in priority list, B comes first
    if (indexA === -1 && indexB !== -1) return 1;
    
    // Both are in priority list, sort by priority
    return indexA - indexB;
  });
  
  return sortedCategories[0]; // Return highest priority category
}

async function createMissingCategories(wpProducts) {
  console.log('🔍 Creating missing categories...');
  let categoriesCreated = 0;
  
  // Collect all unique categories from WordPress products
  const allCategories = new Set();
  wpProducts.forEach(product => {
    if (product.categories) {
      product.categories.forEach(cat => {
        allCategories.add(JSON.stringify({ name: cat.name, slug: cat.slug, description: cat.description || `Category for ${cat.name}` }));
      });
    }
  });
  
  console.log(`📊 Found ${allCategories.size} unique categories in WordPress data`);
  
  // Create missing categories
  for (const catJson of allCategories) {
    const categoryData = JSON.parse(catJson);
    
    // Check if category already exists
    const existingCategory = await Category.findOne({ 
      $or: [
        { name: categoryData.name },
        { slug: categoryData.slug }
      ]
    });
    
    if (!existingCategory) {
      // Create new category
      const newCategory = new Category(categoryData);
      await newCategory.save();
      categoriesCreated++;
      console.log(`   ➕ Created category: ${categoryData.name}`);
    }
  }
  
  console.log(`✅ Created ${categoriesCreated} new categories`);
  return categoriesCreated;
}

async function importExactProfenderProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('🚀 Starting exact Profender product import...');
    
    // WordPress API credentials
    const wordpressSiteUrl = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
    const wordpressApiKey = process.env.WORDPRESS_API_KEY;
    const wordpressApiSecret = process.env.WORDPRESS_API_SECRET;
    const wordpressApiVersion = process.env.WORDPRESS_API_VERSION || 'wc/v3';
    
    // Fetch Profender products from WordPress
    console.log('🌐 Fetching Profender products from WordPress...');
    const response = await axios.get(`${wordpressSiteUrl}/wp-json/${wordpressApiVersion}/products`, {
      auth: {
        username: wordpressApiKey,
        password: wordpressApiSecret
      },
      params: {
        per_page: 20,
        status: 'publish',
        attribute: 'brand',
        attribute_term: 'Profender'
      },
      timeout: 30000
    });
    
    const wpProducts = response.data;
    console.log(`📊 Found ${wpProducts.length} Profender products on live site`);
    
    // Create any missing categories
    await createMissingCategories(wpProducts);
    
    let importedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    
    // Process each product
    for (let i = 0; i < wpProducts.length; i++) {
      const wpProduct = wpProducts[i];
      console.log(`\n📦 Processing product ${i + 1}/${wpProducts.length}: ${wpProduct.name}`);
      
      try {
        // Handle categories - select the best category from multiple options
        let categoryId = null;
        if (wpProduct.categories && wpProduct.categories.length > 0) {
          // Select the best category based on priority
          const bestCategory = await selectBestCategory(wpProduct.categories);
          console.log(`   📂 Best category: ${bestCategory.name} (out of ${wpProduct.categories.length} options)`);
          
          // Find the category in our database
          const category = await Category.findOne({ 
            $or: [
              { name: bestCategory.name },
              { slug: bestCategory.slug }
            ]
          });
          
          if (category) {
            categoryId = category._id;
            console.log(`   🔍 Using existing category: ${category.name} (${category._id})`);
          } else {
            console.log(`   ⚠️  Category not found: ${bestCategory.name}`);
          }
        }
        
        // Transform product data
        const productData = {
          name: wpProduct.name,
          description: wpProduct.description ? wpProduct.description.replace(/<[^>]*>/g, '') : '',
          shortDescription: wpProduct.short_description ? wpProduct.short_description.replace(/<[^>]*>/g, '').substring(0, 200) : wpProduct.name.substring(0, 200),
          price: parseFloat(wpProduct.price || wpProduct.regular_price) || 0,
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
        
        // Check if product already exists (by name since SKU might be missing)
        let existingProduct = await Product.findOne({ 
          name: productData.name,
          brand: 'Profender'
        });
        
        console.log(`   🔍 Existing product found: ${!!existingProduct}`);
        
        let savedProduct;
        if (existingProduct) {
          // Update existing product with correct category
          savedProduct = await Product.findByIdAndUpdate(
            existingProduct._id,
            productData,
            { new: true, runValidators: true }
          );
          console.log(`   ✅ Updated product: ${productData.name}`);
          updatedCount++;
        } else {
          // Create new product
          const product = new Product(productData);
          savedProduct = await product.save();
          console.log(`   ➕ Created product: ${productData.name}`);
          importedCount++;
        }
        
        console.log(`   📈 Progress: ${importedCount} imported, ${updatedCount} updated`);
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
    const profenderProducts = await Product.find({ brand: 'Profender' }).populate('categories', 'name');
    console.log(`📊 Final count of Profender products: ${profenderProducts.length}`);
    
    // Show category distribution
    console.log('\n📊 Category Distribution:');
    const categoryCounts = {};
    profenderProducts.forEach(product => {
      const categoryName = product.category ? product.category.name : 'Uncategorized';
      categoryCounts[categoryName] = (categoryCounts[categoryName] || 0) + 1;
    });
    
    // Sort categories by count (descending)
    const sortedCategories = Object.entries(categoryCounts)
      .sort(([,a], [,b]) => b - a);
    
    sortedCategories.forEach(([category, count]) => {
      console.log(`   ${category}: ${count} products`);
    });
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error importing Profender products:', error.message);
    console.error('📋 Error details:', error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run import
importExactProfenderProducts();