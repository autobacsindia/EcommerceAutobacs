import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load environment variables
dotenv.config();

console.log('Testing MongoDB connection...');
console.log('Node.js version:', process.version);
console.log('Environment variables loaded:');
console.log('- MONGO_URI:', process.env.MONGO_URI ? 'Present' : 'Missing');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'Not set');

// Test the connection
async function testConnection() {
  try {
    console.log('\n--- Testing MongoDB connection ---');
    // Use a longer timeout for this test
    const mongooseOptions = {
      serverSelectionTimeoutMS: 10000, // Increased timeout
      socketTimeoutMS: 20000,
    };
    
    try {
      await mongoose.connect(process.env.MONGO_URI, mongooseOptions);
      console.log('✓ MongoDB connection test successful');
      console.log('✓ Connected to database:', mongoose.connection.name);
      await mongoose.connection.close();
      process.exit(0);
    } catch (err) {
      console.error('✗ MongoDB connection test failed:', err.message);
      
      // Additional diagnostic information
      if (err.name === 'MongoNetworkError') {
        console.error('\nDiagnostic suggestions:');
        console.error('1. Check if MongoDB is running');
        console.error('2. Verify MongoDB is listening on port 27017');
        console.error('3. Check if firewall is blocking the connection');
        console.error('4. Verify the connection string is correct');
        console.error('5. Try starting MongoDB with the start-mongodb-final.ps1 script');
      }
      
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Test failed:', error.message);
    process.exit(1);
  }
}

testConnection();