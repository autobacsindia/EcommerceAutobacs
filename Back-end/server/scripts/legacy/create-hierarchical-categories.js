import mongoose from "mongoose";
import dotenv from "dotenv";
import Category from "../../models/Category.js";

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define the category structure
const categoryStructure = [
  {
    name: "EXTERIOR",
    slug: "exterior",
    description: "External modifications and accessories for your vehicle",
    order: 1
  },
  {
    name: "INTERIOR",
    slug: "interior",
    description: "Internal cabin upgrades and accessories",
    order: 2
  },
  {
    name: "PERFORMANCE",
    slug: "performance",
    description: "Performance enhancement parts and upgrades",
    order: 3
  },
  {
    name: "ACCESSORIES",
    slug: "accessories",
    description: "General automotive accessories and miscellaneous items",
    order: 4
  }
];

const subCategoryStructure = [
  {
    name: "BODY KIT",
    slug: "body-kit",
    description: "Complete body kits and body panels",
    parent: "EXTERIOR",
    order: 1
  },
  {
    name: "LIGHTS",
    slug: "lights",
    description: "Headlights, taillights, and lighting accessories",
    parent: "EXTERIOR",
    order: 2
  },
  {
    name: "AUDIO",
    slug: "audio",
    description: "Car audio systems, speakers, and sound enhancement",
    parent: "INTERIOR",
    order: 1
  },
  {
    name: "SUSPENSION",
    slug: "suspension",
    description: "Suspension systems and components",
    parent: "PERFORMANCE",
    order: 1
  }
];

async function createCategories() {
  try {
    console.log('Creating main categories...');
    
    // Create main categories first
    const createdMainCategories = [];
    for (const cat of categoryStructure) {
      // Check if category already exists
      const existing = await Category.findOne({ slug: cat.slug });
      if (existing) {
        console.log(`Category ${cat.name} already exists`);
        createdMainCategories.push(existing);
      } else {
        const newCategory = new Category(cat);
        const saved = await newCategory.save();
        console.log(`Created category: ${cat.name}`);
        createdMainCategories.push(saved);
      }
    }
    
    console.log('Creating subcategories...');
    
    // Create subcategories
    for (const subCat of subCategoryStructure) {
      // Find the parent category
      const parentCategory = createdMainCategories.find(cat => cat.name === subCat.parent);
      
      if (parentCategory) {
        // Check if subcategory already exists
        const existing = await Category.findOne({ slug: subCat.slug });
        if (existing) {
          console.log(`Subcategory ${subCat.name} already exists`);
        } else {
          const newSubCategory = new Category({
            ...subCat,
            parent: parentCategory._id
          });
          await newSubCategory.save();
          console.log(`Created subcategory: ${subCat.name} under ${subCat.parent}`);
        }
      } else {
        console.log(`Parent category ${subCat.parent} not found for ${subCat.name}`);
      }
    }
    
    console.log('Category creation completed!');
    
    // List all categories
    const allCategories = await Category.find({}).populate('parent', 'name');
    console.log('\nAll categories:');
    allCategories.forEach(cat => {
      console.log(`${cat.name} (${cat.slug}) ${cat.parent ? `-> ${cat.parent.name}` : ''}`);
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error creating categories:', error);
    mongoose.connection.close();
  }
}

// Run the category creation
createCategories();