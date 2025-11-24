import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

console.log('Connecting to MongoDB to count products...');

async function countProducts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
    
    console.log('✓ Connected to MongoDB');
    console.log('Database name:', mongoose.connection.name);
    console.log('MONGO_URI:', process.env.MONGO_URI);
    
    // Show connection details
    console.log('Connection host:', mongoose.connection.host);
    console.log('Connection port:', mongoose.connection.port);
    
    // List all collections in the database
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Database collections:', collections.map(c => c.name));
    
    // Check for raw documents regardless of schema
    const rawCount = await mongoose.connection.db.collection('products').countDocuments({});
    console.log('Raw product documents:', rawCount);
    
    // Count all products using Mongoose
    const totalProducts = await Product.countDocuments({});
    console.log(`Total products in database: ${totalProducts}`);
    
    // If raw documents exist but Mongoose query returns 0, there's a schema mismatch
    if (rawCount > 0 && totalProducts === 0) {
      console.log('SCHEMA MISMATCH DETECTED: Documents exist but do not match Mongoose model');
      // Show sample document structure
      const sample = await mongoose.connection.db.collection('products').findOne({});
      console.log('Sample document:', JSON.stringify(sample, null, 2));
    }
    
    // If we have products, show some details
    if (totalProducts > 0) {
      console.log('\n--- Sample Products ---');
      const sampleProducts = await Product.find({}).limit(5).select('name price stock isActive isFeatured');
      sampleProducts.forEach((product, index) => {
        console.log(`${index + 1}. ${product.name} - $${product.price} (Stock: ${product.stock}, Active: ${product.isActive}, Featured: ${product.isFeatured})`);
      });
      
      // Show additional counts
      const activeProducts = await Product.countDocuments({ isActive: true });
      console.log(`\nActive products: ${activeProducts}`);
      
      const inactiveProducts = await Product.countDocuments({ isActive: false });
      console.log(`Inactive products: ${inactiveProducts}`);
      
      const featuredProducts = await Product.countDocuments({ isFeatured: true });
      console.log(`Featured products: ${featuredProducts}`);
      
      const inStockProducts = await Product.countDocuments({ stock: { $gt: 0 } });
      console.log(`Products in stock: ${inStockProducts}`);
      
      const outOfStockProducts = await Product.countDocuments({ stock: 0 });
      console.log(`Products out of stock: ${outOfStockProducts}`);
    } else {
      console.log('No products found in the database.');
      console.log('Checking if there are any documents at all in the products collection...');
      
      // Try a more general query
      const allDocs = await mongoose.connection.db.collection('products').countDocuments({});
      console.log(`Total documents in products collection: ${allDocs}`);
      
      if (allDocs > 0) {
        console.log('There are documents in the collection but they might not match the Mongoose model.');
        console.log('Showing raw document structure:');
        const sampleDoc = await mongoose.connection.db.collection('products').findOne({});
        console.log(JSON.stringify(sampleDoc, null, 2));
      }
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

countProducts();