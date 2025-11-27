import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function runCleanup() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Find products with HTML tags
    console.log('Finding products with HTML tags...');
    const products = await Product.find({
      description: { $regex: /<[^>]*>/ }
    }).limit(10);
    
    console.log(`Found ${products.length} products with HTML tags`);
    
    // Show before and after for a few products
    for (let i = 0; i < Math.min(3, products.length); i++) {
      const product = products[i];
      console.log(`\n--- Product ${i + 1}: ${product.name} ---`);
      console.log('Before (first 100 chars):');
      console.log(product.description.substring(0, 100));
      
      // Simple HTML removal
      const cleanDescription = product.description.replace(/<[^>]*>/g, '');
      console.log('After (first 100 chars):');
      console.log(cleanDescription.substring(0, 100));
    }
    
    await mongoose.connection.close();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

runCleanup();