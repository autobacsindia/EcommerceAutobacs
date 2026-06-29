// Check exact product name differences
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
    // Find the problematic BMW product
    const bmwProduct = await Product.findOne({ 
      name: { $regex: /BMW 3 Series/i },
      brand: 'Profender'
    });
    
    if (bmwProduct) {
      console.log('🔍 Found BMW product in database:');
      console.log(`   Database name: "${bmwProduct.name}"`);
      console.log(`   Length: ${bmwProduct.name.length}`);
      
      // The expected name from live site
      const expectedName = "BMW 3 Series GT F34 Body Kit with M4 style Front Bumper, Rear Bumper & Side Skirts";
      console.log(`\n📋 Expected name: "${expectedName}"`);
      console.log(`   Length: ${expectedName.length}`);
      
      // Check for differences
      console.log('\n🔍 Character-by-character comparison:');
      for (let i = 0; i < Math.max(bmwProduct.name.length, expectedName.length); i++) {
        const dbChar = i < bmwProduct.name.length ? bmwProduct.name[i] : '<END>';
        const expChar = i < expectedName.length ? expectedName[i] : '<END>';
        
        if (dbChar !== expChar) {
          console.log(`   Position ${i}: DB="${dbChar}" vs Expected="${expChar}"`);
        }
      }
      
      // Check for HTML entities
      if (bmwProduct.name.includes('&amp;')) {
        console.log('\n⚠️ Found HTML entity "&amp;" in database name');
        console.log('   This should be "&" to match the live site');
      }
    } else {
      console.log('❌ Could not find BMW 3 Series product in database');
    }
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error checking product names:', error.message);
    mongoose.connection.close();
  }
});