import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function checkHtmlProducts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Find products with HTML tags in descriptions
    const products = await Product.find({ 
      description: { $regex: /<[^>]*>/ } 
    });
    
    console.log(`Products with HTML tags in descriptions: ${products.length}`);
    
    if (products.length > 0) {
      console.log('\nSample products:');
      products.slice(0, 3).forEach((product, index) => {
        console.log(`${index + 1}. ${product.name}`);
        console.log(`   Description: ${product.description.substring(0, 100)}...`);
        console.log(`   Current categories: ${product.categories && product.categories.length > 0 ? product.categories.map(c => c.name).join(', ') : 'None'}`);
        console.log('---');
      });
    } else {
      console.log('No products with HTML tags found.');
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

checkHtmlProducts();