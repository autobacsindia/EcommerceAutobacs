import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testConnection() {
  try {
    console.log('🔍 Testing MongoDB connection...');
    console.log('MongoDB URI:', process.env.MONGO_URI);
    
    // Try to connect with a shorter timeout
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // 5 second timeout
      socketTimeoutMS: 5000,
    });
    
    console.log('✅ Connected to MongoDB successfully!');
    
    // Test a simple operation
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📋 Available collections:', collections.map(c => c.name));
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Error name:', error.name);
  }
}

testConnection();