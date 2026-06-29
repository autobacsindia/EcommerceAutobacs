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

async function listAllCategories() {
  try {
    const categories = await Category.find().sort({ name: 1 });
    console.log(`Found ${categories.length} categories:`);
    
    categories.forEach((category, index) => {
      console.log(`${index + 1}. ${category.name} (${category._id})`);
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error listing categories:', error.message);
    mongoose.connection.close();
  }
}

listAllCategories();