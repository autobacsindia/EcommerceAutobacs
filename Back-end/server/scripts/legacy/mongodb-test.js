// Simple MongoDB test
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
  console.log('Connected to MongoDB');
  
  try {
    // Create a simple test product
    console.log('Creating test product...');
    const testProduct = new Product({
      name: 'Test Profender Product',
      description: 'Test product for Profender brand',
      price: 1000,
      sku: 'TEST-PROFENDER-001',
      stock: 10,
      brand: 'Profender',
      isActive: true,
      isFeatured: false
    });
    
    const savedProduct = await testProduct.save();
    console.log('✅ Test product created successfully:', savedProduct.name);
    
    // Clean up - delete the test product
    await Product.deleteOne({ _id: savedProduct._id });
    console.log('✅ Test product cleaned up');
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error creating test product:', error.message);
    console.error('Error stack:', error.stack);
    mongoose.connection.close();
  }
});