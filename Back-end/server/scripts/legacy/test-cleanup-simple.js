import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

// Load environment variables
dotenv.config();

async function testCleanup() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Find a few products with HTML tags to test with
    const products = await Product.find({ 
      description: { $regex: /<[^>]*>/ } 
    }).limit(5);
    
    console.log(`Found ${products.length} products with HTML tags`);
    
    if (products.length > 0) {
      console.log('\nTesting HTML tag removal:');
      
      for (const product of products) {
        console.log(`\nProduct: ${product.name}`);
        console.log('Original description (first 100 chars):');
        console.log(product.description.substring(0, 100) + '...');
        
        // Simple HTML tag removal for testing
        const cleanDescription = product.description.replace(/<[^>]*>/g, '');
        console.log('Cleaned description (first 100 chars):');
        console.log(cleanDescription.substring(0, 100) + '...');
      }
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

testCleanup();