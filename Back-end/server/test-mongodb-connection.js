import dotenv from 'dotenv';
import { connectWithRetry } from './config/db.js';

// Load environment variables
dotenv.config();

console.log('Testing MongoDB connection...');
console.log('Node.js version:', process.version);
console.log('Environment variables loaded:');
console.log('- MONGO_URI:', process.env.MONGO_URI ? 'Present' : 'Missing');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'Not set');

// Test the connection
connectWithRetry(3, 3000)
  .then(() => {
    console.log('✓ MongoDB connection test successful');
    process.exit(0);
  })
  .catch((err) => {
    console.error('✗ MongoDB connection test failed:', err.message);
    
    // Additional diagnostic information
    if (err.name === 'MongoNetworkError') {
      console.error('\nDiagnostic suggestions:');
      console.error('1. Check if MongoDB Atlas IP whitelist includes your current IP');
      console.error('2. Verify MongoDB URI credentials are correct');
      console.error('3. Ensure network connectivity to MongoDB servers');
      console.error('4. Check if corporate firewall is blocking connection');
      console.error('5. Try connecting with MongoDB Compass to isolate the issue');
    }
    
    process.exit(1);
  });