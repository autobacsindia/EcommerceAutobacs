// Update product-category mappings to use new hierarchical structure
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Define mapping from old category names to new hierarchical categories
const CATEGORY_MAPPING = {
  'ACCESSORIES': 'ACCESSORIES',
  'Bumper': 'Bumper',
  'driving lights cover': 'driving lights cover',
  'Engine Parts': 'Engine Parts',
  'Body Kits': 'Body Kits',
  'Conversion Kit': 'Conversion Kit',
  'projector headlights': 'projector headlights',
  'EXTERIOR': 'EXTERIOR',
  'Front Bumper Grill': 'Front Bumper Grill',
  'PERFORMANCE': 'PERFORMANCE',
  'Snorkel': 'Snorkel',
  'Other': 'Other',
  'Front Grill': 'Front Grill',
  'Bonnet Hood': 'Bonnet Hood'
};

async function updateProductCategoryMappings() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🔄 Updating product-category mappings...');
    
    // Get all Profender products
    const products = await Product.find({ brand: 'Profender' });
    console.log(`📊 Found ${products.length} Profender products`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const product of products) {
      console.log(`\n📦 Processing: ${product.name}`);
      
      // Get current category (first one if multiple)
      if (product.categories && product.categories.length > 0) {
        const currentCategory = await Category.findById(product.categories[0]);
        if (currentCategory) {
          console.log(`   Current category: ${currentCategory.name}`);
          
          // Check if we need to update the category
          if (CATEGORY_MAPPING[currentCategory.name]) {
            // Find the new category in the hierarchy
            const newCategoryName = CATEGORY_MAPPING[currentCategory.name];
            const newCategory = await Category.findOne({ name: newCategoryName });
            
            // Update the product's first category (keeping other categories)
            if (product.categories && product.categories.length > 0) {
              product.categories[0] = newCategory._id;
            } else {
              product.categories = [newCategory._id];
            }
            await product.save();
            console.log(`   🔄 Updated category: ${currentCategory.name} → ${newCategory.name}`);
            updatedCount++;
          } else {
            console.log(`   ⚠️  No mapping found for category: ${currentCategory.name}`);
            skippedCount++;
          }
        } else {
          console.log(`   ❌ Current category not found`);
          skippedCount++;
        }
      } else {
        console.log(`   ⚠️  No category assigned`);
        skippedCount++;
      }
    }
    
    console.log(`\n✅ Update completed!`);
    console.log(`   🔄 Updated: ${updatedCount} products`);
    console.log(`   ✅ Skipped: ${skippedCount} products`);
    
    // Show final product-category mapping
    console.log('\n📊 Final Product-Category Mapping:');
    const updatedProducts = await Product.find({ brand: 'Profender' })
      .populate('categories', 'name')
      .sort({ name: 1 });
    
    const categoryProductCount = {};
    updatedProducts.forEach(product => {
      const categoryNames = product.categories && product.categories.length > 0 
        ? product.categories.map(cat => cat.name).join(', ')
        : 'Uncategorized';
      if (!categoryProductCount[categoryNames]) {
        categoryProductCount[categoryNames] = [];
      }
      categoryProductCount[categoryNames].push(product.name);
    });
    
    Object.entries(categoryProductCount).forEach(([category, productNames]) => {
      console.log(`\n📁 ${category}: ${productNames.length} products`);
      productNames.slice(0, 3).forEach(name => {
        console.log(`   • ${name}`);
      });
      if (productNames.length > 3) {
        console.log(`   ... and ${productNames.length - 3} more`);
      }
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error updating product-category mappings:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

updateProductCategoryMappings();