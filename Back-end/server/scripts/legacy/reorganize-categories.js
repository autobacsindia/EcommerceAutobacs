// Reorganize categories to match live site structure
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from '../../models/Category.js';
import fs from 'fs';

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

async function reorganizeCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🏗️ Reorganizing category hierarchy...');
    
    // First, let's create or update main categories
    for (const [mainCategoryName, subCategories] of Object.entries(CATEGORY_HIERARCHY)) {
      console.log(`\n📂 Processing ${mainCategoryName}...`);
      
      // Find or create main category
      let mainCategory = await Category.findOne({ name: mainCategoryName });
      if (!mainCategory) {
        mainCategory = new Category({
          name: mainCategoryName,
          slug: mainCategoryName.toLowerCase().replace(/\s+/g, '-'),
          description: `Main category for ${mainCategoryName}`,
          parent: null,
          isActive: true,
          order: Object.keys(CATEGORY_HIERARCHY).indexOf(mainCategoryName)
        });
        await mainCategory.save();
        console.log(`   ➕ Created main category: ${mainCategoryName}`);
      } else {
        console.log(`   🔍 Found existing main category: ${mainCategoryName}`);
      }
      
      // Process subcategories
      for (const subCategoryName of subCategories) {
        console.log(`      📁 Processing subcategory: ${subCategoryName}`);
        
        // Find or create subcategory
        let subCategory = await Category.findOne({ name: subCategoryName });
        if (!subCategory) {
          subCategory = new Category({
            name: subCategoryName,
            slug: subCategoryName.toLowerCase().replace(/\s+/g, '-'),
            description: `Subcategory of ${mainCategoryName}`,
            parent: mainCategory._id,
            isActive: true,
            order: subCategories.indexOf(subCategoryName)
          });
          await subCategory.save();
          console.log(`         ➕ Created subcategory: ${subCategoryName}`);
        } else {
          // Update parent if needed
          if (!subCategory.parent || subCategory.parent.toString() !== mainCategory._id.toString()) {
            subCategory.parent = mainCategory._id;
            subCategory.order = subCategories.indexOf(subCategoryName);
            await subCategory.save();
            console.log(`         🔄 Updated subcategory parent: ${subCategoryName}`);
          } else {
            console.log(`         🔍 Found existing subcategory: ${subCategoryName}`);
          }
        }
      }
    }
    
    console.log('\n✅ Category reorganization completed!');
    
    // Show the new hierarchy
    console.log('\n📂 New Category Hierarchy:');
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