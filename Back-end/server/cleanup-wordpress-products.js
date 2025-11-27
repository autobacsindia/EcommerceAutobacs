import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function cleanupProducts() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Find products with HTML tags
    console.log('Finding products with HTML tags...');
    const products = await Product.find({
      description: { $regex: /<[^>]*>/ }
    }).limit(100); // Limit to 100 products for testing
    
    console.log(`Found ${products.length} products with HTML tags`);
    
    if (products.length === 0) {
      console.log('No products need cleanup');
      await mongoose.connection.close();
      return;
    }
    
    // Process products
    let updatedCount = 0;
    const bulkOps = [];
    
    for (const product of products) {
      // Remove HTML tags from description
      const cleanDescription = product.description.replace(/<[^>]*>/g, '');
      
      // Add to bulk operations
      bulkOps.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { description: cleanDescription } }
        }
      });
    }
    
    // Execute bulk update
    if (bulkOps.length > 0) {
      console.log(`Updating ${bulkOps.length} products...`);
      const result = await Product.bulkWrite(bulkOps);
      updatedCount = result.modifiedCount;
      console.log(`Successfully updated ${updatedCount} products`);
    }
    
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
    console.log(`Cleanup completed. Processed ${products.length} products, updated ${updatedCount}`);
  } catch (error) {
    console.error('Error during cleanup:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

cleanupProducts();