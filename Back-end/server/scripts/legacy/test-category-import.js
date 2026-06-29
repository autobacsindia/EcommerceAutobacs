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

// Simple test categories
const testCategories = [
  {
    name: "Test Category 1",
    slug: "test-category-1",
    description: "A test category for import testing",
    order: 1
  },
  {
    name: "Test Category 2",
    slug: "test-category-2",
    description: "Another test category for import testing",
    order: 2
  }
];

async function testImport() {
  try {
    console.log('Testing category import...');
    
    for (const cat of testCategories) {
      // Check if category already exists
      const existing = await Category.findOne({ slug: cat.slug });
      if (existing) {
        console.log(`Category ${cat.name} already exists`);
      } else {
        const newCategory = new Category(cat);
        const saved = await newCategory.save();
        console.log(`Created category: ${cat.name} with ID: ${saved._id}`);
      }
    }
    
    console.log('Test import completed!');
    
    // List all categories
    const allCategories = await Category.find({});
    console.log('\nAll categories:');
    allCategories.forEach(cat => {
      console.log(`${cat.name} (${cat.slug})`);
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error during test import:', error);
    mongoose.connection.close();
  }
}

// Run the test
testImport();