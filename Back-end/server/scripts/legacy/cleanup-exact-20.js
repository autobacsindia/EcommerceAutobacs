// Clean up Profender products to have exactly 20
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
    // Find all Profender products
    console.log('🔍 Finding all Profender products...');
    const profenderProducts = await Product.find({ brand: 'Profender' }).sort({ createdAt: 1 });
    console.log(`📊 Found ${profenderProducts.length} Profender products in database`);
    
    if (profenderProducts.length === 20) {
      console.log('✅ Already have exactly 20 products, no action needed');
      mongoose.connection.close();
      return;
    }
    
    if (profenderProducts.length < 20) {
      console.log('⚠️ Have fewer than 20 products, no cleanup needed');
      mongoose.connection.close();
      return;
    }
    
    // Keep only the first 20 products and delete the rest
    const productsToDelete = profenderProducts.slice(20);
    console.log(`🗑️ Need to delete ${productsToDelete.length} excess products`);
    
    let deletedCount = 0;
    for (const product of productsToDelete) {
      await Product.findByIdAndDelete(product._id);
      console.log(`  ➖ Deleted product: ${product.name} (${product.sku})`);
      deletedCount++;
    }
    
    // Final verification
    const finalCount = await Product.countDocuments({ brand: 'Profender' });
    console.log(`\n✅ Cleanup completed!`);
    console.log(`📊 Final count of Profender products: ${finalCount}`);
    
    if (finalCount === 20) {
      console.log('🎉 Successfully cleaned up to exactly 20 products!');
    } else {
      console.log(`⚠️ Expected 20 products, but have ${finalCount}`);
    }
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error cleaning up Profender products:', error.message);
    mongoose.connection.close();
  }
});