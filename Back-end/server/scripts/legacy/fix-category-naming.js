// Fix remaining category naming issues
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

async function fixRemainingCategories() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🔧 Fixing remaining category naming issues...');
    
    // The live site uses capitalized names, but we have lowercase ones
    // We need to ensure we have the exact capitalization from the live site
    const capitalizationFixes = {
      'exterior': 'Exterior',
      'interior': 'Interior',
      'performance': 'Performance'
    };
    
    for (const [lowercaseName, correctName] of Object.entries(capitalizationFixes)) {
      console.log(`\n🔧 Checking category: ${correctName}`);
      
      // Look for the lowercase version
      const lowercaseCategory = await Category.findOne({ 
        name: { $regex: new RegExp(`^${lowercaseName}$`, 'i') } 
      });
      
      if (lowercaseCategory) {
        console.log(`   🔍 Found lowercase category: ${lowercaseCategory.name}`);
        
        // Update to correct capitalization
        if (lowercaseCategory.name !== correctName) {
          lowercaseCategory.name = correctName;
          // Update slug to match
          lowercaseCategory.slug = correctName.toLowerCase();
          await lowercaseCategory.save();
          console.log(`   🔄 Updated to: ${correctName}`);
        } else {
          console.log(`   ✅ Already correct: ${correctName}`);
        }
      } else {
        console.log(`   ❌ Not found: ${correctName}`);
      }
    }
    
    console.log('\n✅ Category naming fixes completed!');
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error fixing category naming:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

fixRemainingCategories();