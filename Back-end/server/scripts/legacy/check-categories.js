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

async function checkCategories() {
  try {
    const categories = await Category.find();
    console.log('Categories count:', categories.length);
    if (categories.length > 0) {
      console.log('Sample categories:');
      categories.slice(0, 5).forEach(category => {
        console.log(`- ${category.name} (${category._id})`);
      });
    }
    mongoose.connection.close();
  } catch (error) {
    console.error('Error checking categories:', error.message);
    mongoose.connection.close();
  }
}

checkCategories();