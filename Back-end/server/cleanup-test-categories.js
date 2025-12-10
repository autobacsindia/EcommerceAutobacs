import mongoose from "mongoose";
import dotenv from "dotenv";
import Category from "./models/Category.js";

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function cleanupTestCategories() {
  try {
    console.log('Cleaning up test categories...');
    
    // Delete test categories
    const result = await Category.deleteMany({
      slug: { $in: ['test-category-1', 'test-category-2'] }
    });
    
    console.log(`Deleted ${result.deletedCount} test categories`);
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error cleaning up test categories:', error);
    mongoose.connection.close();
  }
}

// Run the cleanup
cleanupTestCategories();