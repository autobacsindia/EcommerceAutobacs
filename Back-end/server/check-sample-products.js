import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function checkSampleProducts() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Look for sample products (these might have been created with specific names or SKUs)
    const sampleProducts = await Product.find({
      $or: [
        { name: /Sample Product/i },
        { sku: /SAMPLE/i },
        { description: /This is a sample/i }
      ]
    });
    
    console.log(`Found ${sampleProducts.length} sample products:`);
    sampleProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (SKU: ${product.sku || 'N/A'}) - ${product.description.substring(0, 50)}...`);
    });
    
    // If no sample products found with those criteria, let's check for recently added products
    if (sampleProducts.length === 0) {
      const recentProducts = await Product.find({}).sort({ createdAt: -1 }).limit(20);
      console.log('\nRecent products (last 20):');
      recentProducts.forEach((product, index) => {
        console.log(`${index + 1}. ${product.name} (SKU: ${product.sku || 'N/A'}) - Created: ${product.createdAt}`);
      });
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

checkSampleProducts();