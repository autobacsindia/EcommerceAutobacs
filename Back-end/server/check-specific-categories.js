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

async function checkSpecificCategories() {
  try {
    console.log('Checking for specific categories:');
    
    // Check for audio category
    const audioCategory = await Category.findOne({ slug: 'audio' });
    if (audioCategory) {
      console.log(`Found audio category: ${audioCategory.name} (${audioCategory.slug}) - ID: ${audioCategory._id}`);
    } else {
      console.log('No category with slug "audio" found');
    }
    
    // Check for lights category
    const lightsCategory = await Category.findOne({ slug: 'lights' });
    if (lightsCategory) {
      console.log(`Found lights category: ${lightsCategory.name} (${lightsCategory.slug}) - ID: ${lightsCategory._id}`);
    } else {
      console.log('No category with slug "lights" found');
    }
    
    // Check for speaker category (which we found earlier)
    const speakerCategory = await Category.findOne({ slug: 'speaker' });
    if (speakerCategory) {
      console.log(`Found speaker category: ${speakerCategory.name} (${speakerCategory.slug}) - ID: ${speakerCategory._id}`);
    }
    
    // Check for lighting category (close match to lights)
    const lightingCategory = await Category.findOne({ slug: 'lighting' });
    if (lightingCategory) {
      console.log(`Found lighting category: ${lightingCategory.name} (${lightingCategory.slug}) - ID: ${lightingCategory._id}`);
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error checking categories:', error.message);
    mongoose.connection.close();
  }
}

checkSpecificCategories();