// Clean up duplicate Profender products
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
    // Find all Profender products
    console.log('🔍 Finding all Profender products...');
    const profenderProducts = await Product.find({ brand: 'Profender' }).sort({ createdAt: 1 });
    console.log(`📊 Found ${profenderProducts.length} Profender products`);
    
    if (profenderProducts.length <= 20) {
      console.log('✅ Already have 20 or fewer products, no cleanup needed');
      mongoose.connection.close();
      return;
    }
    
    // Keep only the first 20 products and delete the rest
    const productsToDelete = profenderProducts.slice(20);
    console.log(`🗑️ Need to delete ${productsToDelete.length} duplicate products`);
    
    for (const product of productsToDelete) {
      await Product.findByIdAndDelete(product._id);
      console.log(`  ➖ Deleted product: ${product.name} (${product.sku})`);
    }
    
    // Final verification
    const finalCount = await Product.countDocuments({ brand: 'Profender' });
    console.log(`\n✅ Cleanup completed!`);
    console.log(`📊 Final count of Profender products: ${finalCount}`);
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error cleaning up Profender products:', error.message);
    mongoose.connection.close();
  }
});