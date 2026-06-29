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

async function searchAudioCategories() {
  try {
    const categories = await Category.find().sort({ name: 1 });
    console.log('Searching for audio categories:');
    
    categories.forEach((category, index) => {
      if (category.name.toLowerCase().includes('audio') || 
          category.name.toLowerCase().includes('sound') ||
          category.name.toLowerCase().includes('speaker') ||
          category.slug.toLowerCase().includes('audio') || 
          category.slug.toLowerCase().includes('sound') ||
          category.slug.toLowerCase().includes('speaker')) {
        console.log(`${index + 1}. ${category.name} (slug: ${category.slug}) - ID: ${category._id}`);
      }
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error searching categories:', error.message);
    mongoose.connection.close();
  }
}

searchAudioCategories();