import mongoose from 'mongoose';
import Product from './models/Product.js';

async function testConnection() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/autobacs');
    console.log('Connected successfully!');
    
    // Count products
    const count = await Product.countDocuments();
    console.log(`Found ${count} products`);
    
    // Close connection
    await mongoose.connection.close();
    console.log('Connection closed');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testConnection();