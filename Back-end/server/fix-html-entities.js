// Fix HTML entities in product names
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
    // Find all Profender products with HTML entities
    const profenderProducts = await Product.find({ 
      brand: 'Profender',
      name: { $regex: '&amp;' }
    });
    
    console.log(`🔍 Found ${profenderProducts.length} Profender products with HTML entities`);
    
    for (const product of profenderProducts) {
      const oldName = product.name;
      const newName = oldName.replace(/&amp;/g, '&');
      
      console.log(`\n🔧 Fixing product: "${oldName}"`);
      console.log(`   New name: "${newName}"`);
      
      // Update the product name
      product.name = newName;
      await product.save();
      
      console.log('   ✅ Updated successfully');
    }
    
    if (profenderProducts.length === 0) {
      console.log('✅ No products with HTML entities found');
    }
    
    // Final verification
    console.log('\n🔍 Verifying fix...');
    const updatedProducts = await Product.find({ 
      brand: 'Profender',
      name: { $regex: '&amp;' }
    });
    
    if (updatedProducts.length === 0) {
      console.log('✅ All HTML entities fixed successfully');
    } else {
      console.log(`⚠️ Still ${updatedProducts.length} products with HTML entities remaining`);
    }
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error fixing HTML entities:', error.message);
    mongoose.connection.close();
  }
});