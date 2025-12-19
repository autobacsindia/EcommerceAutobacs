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

async function testCategoryFix() {
  try {
    // Test 1: Look for category with slug 'bodykit' (what frontend expects)
    console.log('Testing search for category with slug "bodykit":');
    let category = await Category.findOne({ slug: 'bodykit', isActive: true });
    console.log('Direct search result:', category ? `${category.name} (${category.slug})` : 'Not found');
    
    // Test 2: Look for category with slug 'body-kits' (what actually exists)
    console.log('\nTesting search for category with slug "body-kits":');
    category = await Category.findOne({ slug: 'body-kits', isActive: true });
    console.log('Direct search result:', category ? `${category.name} (${category.slug})` : 'Not found');
    
    // Test 3: Simulate the transformation logic that should happen in the route
    console.log('\nSimulating route transformation logic:');
    const requestedSlug = 'bodykit';
    console.log(`Requested slug: ${requestedSlug}`);
    
    // First try direct match
    category = await Category.findOne({ slug: requestedSlug, isActive: true });
    console.log(`Direct match: ${category ? `${category.name} (${category.slug})` : 'Not found'}`);
    
    // If not found, try with hyphenated version
    if (!category) {
      let hyphenatedSlug = requestedSlug;
      
      if (requestedSlug === 'bodykit') {
        hyphenatedSlug = 'body-kits';  // Our fix
      } else if (requestedSlug === 'lights') {
        hyphenatedSlug = 'light-s';
      }
      
      console.log(`Transformed to hyphenated slug: ${hyphenatedSlug}`);
      
      if (hyphenatedSlug !== requestedSlug) {
        category = await Category.findOne({ slug: hyphenatedSlug, isActive: true });
        console.log(`Hyphenated match: ${category ? `${category.name} (${category.slug})` : 'Not found'}`);
      }
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error testing category fix:', error.message);
    mongoose.connection.close();
  }
}

testCategoryFix();