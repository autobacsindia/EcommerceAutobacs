// Reorganize categories to match live site structure (improved version)
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Define the category hierarchy based on the live site structure
const CATEGORY_HIERARCHY = {
  // Main categories from the live site taxonomy
  'Accessories': [],
  'Exterior': [
    'Body Parts',
    'Body Kits',
    'Bumper',
    'Exterior Accessories',
    'Grill',
    'Snorkel',
    'Tailgate Cover',
    'Bonnet Hood',
    'Conversion Kit',
    'Facelift Conversion Kit',
    'Front Bumper Grill',
    'Headlight',
    'LED lights',
    'Lighting',
    'Performance',
    'Protection Kit',
    'Spoiler',
    'Diffusers'
  ],
  'Interior': [],
  'Performance': [],
  'Suspension': [],
  'Lighting': [
    'LED lights',
    'Headlight',
    'Tail Light',
    'Driving Lights',
    'Light Bar'
  ],
  'Body Kits': [
    'Conversion Kit',
    'Facelift Conversion Kit'
  ],
  'Protection Kit': [],
  'Roof Top': [],
  'Portable Fridge': [],
  'Winch': [],
  'X-JACK': [],
  'Other': []
};

async function createOrUpdateCategory(name, parent = null, order = 0) {
  // Generate slug
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  
  // Try to find existing category
  let category = await Category.findOne({ name: name });
  
  if (!category) {
    // Try to find by slug if name doesn't match
    category = await Category.findOne({ slug: slug });
  }
  
  if (!category) {
    // Create new category
    category = new Category({
      name: name,
      slug: slug,
      description: parent ? `Subcategory of ${parent.name}` : `Main category for ${name}`,
      parent: parent ? parent._id : null,
      isActive: true,
      order: order
    });
    await category.save();
    console.log(`         ➕ Created category: ${name}`);
  } else {
    // Update existing category
    let updated = false;
    
    // Update parent if needed
    if (parent && (!category.parent || category.parent.toString() !== parent._id.toString())) {
      category.parent = parent._id;
      updated = true;
    }
    
    // Update order if needed
    if (category.order !== order) {
      category.order = order;
      updated = true;
    }
    
    // Update description if needed
    const expectedDescription = parent ? `Subcategory of ${parent.name}` : `Main category for ${name}`;
    if (category.description !== expectedDescription) {
      category.description = expectedDescription;
      updated = true;
    }
    
    if (updated) {
      await category.save();
      console.log(`         🔄 Updated category: ${name}`);
    } else {
      console.log(`         🔍 Found existing category: ${name}`);
    }
  }
  
  return category;
}

async function reorganizeCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🏗️ Reorganizing category hierarchy...');
    
    // Create a map to store created categories
    const categoryMap = new Map();
    
    // First, create or update all main categories
    console.log('\n📂 Creating/Updating Main Categories...');
    for (const [mainCategoryName, subCategories] of Object.entries(CATEGORY_HIERARCHY)) {
      console.log(`\n🏛️ Processing main category: ${mainCategoryName}`);
      
      const mainCategory = await createOrUpdateCategory(
        mainCategoryName, 
        null, 
        Object.keys(CATEGORY_HIERARCHY).indexOf(mainCategoryName)
      );
      
      categoryMap.set(mainCategoryName, mainCategory);
    }
    
    // Then, create or update all subcategories
    console.log('\n📂 Creating/Updating Subcategories...');
    for (const [mainCategoryName, subCategories] of Object.entries(CATEGORY_HIERARCHY)) {
      const mainCategory = categoryMap.get(mainCategoryName);
      
      if (subCategories.length > 0) {
        console.log(`\n📁 Processing subcategories for: ${mainCategoryName}`);
        
        for (const subCategoryName of subCategories) {
          console.log(`   📁 Processing: ${subCategoryName}`);
          
          const subCategory = await createOrUpdateCategory(
            subCategoryName,
            mainCategory,
            subCategories.indexOf(subCategoryName)
          );
          
          categoryMap.set(`${mainCategoryName}::${subCategoryName}`, subCategory);
        }
      }
    }
    
    console.log('\n✅ Category reorganization completed!');
    
    // Show the new hierarchy
    console.log('\n📂 Final Category Hierarchy:');
    const topLevelCategories = await Category.find({ parent: null }).sort({ order: 1 });
    
    for (const mainCat of topLevelCategories) {
      console.log(`\n🏛️ ${mainCat.name}`);
      const subCats = await Category.find({ parent: mainCat._id }).sort({ order: 1 });
      if (subCats.length > 0) {
        subCats.forEach(subCat => {
          console.log(`   📁 ${subCat.name}`);
        });
      } else {
        console.log('   (No subcategories)');
      }
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error reorganizing categories:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

reorganizeCategories();