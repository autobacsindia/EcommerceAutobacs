import mongoose from "mongoose";
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Mongoose connection options adjusted for direct IP connection
const mongooseOptions = {
  serverSelectionTimeoutMS: 5000, // Reduced timeout for faster feedback
  socketTimeoutMS: 10000, // Close sockets after 10 seconds of inactivity
  
  // SSL/TLS specific options - disabled for direct IP connection
  tls: process.env.MONGO_TLS === 'true',
  tlsAllowInvalidCertificates: process.env.MONGO_TLS_ALLOW_INVALID_CERTIFICATES === 'true',
  tlsAllowInvalidHostnames: false,
  
  // Enhanced retry configuration
  retryWrites: true,
  maxPoolSize: 10,
  heartbeatFrequencyMS: 5000
};

// Connection retry logic with exponential backoff (reduced retries for faster feedback)
const connectWithRetry = async (retries = 3, interval = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, mongooseOptions);
      console.log("✓ MongoDB connected successfully");
      return mongoose.connection;
    } catch (err) {
      console.error(`✗ MongoDB connection attempt ${i + 1} failed:`, err.message);
      
      // Specific error handling for common issues
      if (err.message.includes('ECONNREFUSED')) {
        console.error('Connection Refused:');
        console.error('- Make sure MongoDB is running on the specified IP and port.');
        console.error('- Check firewall settings to ensure port 27017 is accessible.');
        console.error('- Verify the IP address and port are correct.');
      } else if (err.message.includes('authentication') || err.message.includes('Auth')) {
        console.error('Authentication Issue Detected:');
        console.error('- Verify MongoDB URI credentials are correct');
        console.error('- Check if the user exists and has proper permissions');
      }
      
      if (i === retries - 1) {
        console.error("✗ MongoDB connection failed after max retries");
        console.warn("⚠ Warning: Starting server without database connection. Some features may not work properly.");
        return null; // Return null instead of throwing error
      }
      // Exponential backoff
      const delay = interval * Math.pow(2, i);
      console.log(`Retrying in ${delay / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Connection event listeners
mongoose.connection.on('connected', () => {
  console.log('✓ Mongoose connected to MongoDB');
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠ Mongoose disconnected from MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('✗ Mongoose connection error:', err);
  
  // Specific handling for common errors
  if (err.name === 'MongoNetworkError' && err.message.includes('ECONNREFUSED')) {
    console.error('Connection Refused: Make sure MongoDB is running on the specified IP and port.');
    console.error('Check firewall settings to ensure port 27017 is accessible.');
  } else if (err.message.includes('authentication') || err.message.includes('Auth')) {
    console.error('Authentication Issue: Verify MongoDB URI credentials are correct.');
  }
});

// Pre-flight IP check is not needed for direct IP connections
async function preFlightIPCheck() {
  // For direct IP connections, we don't need to check Atlas IP whitelisting
  console.log('Direct IP connection - skipping Atlas IP whitelist check');
  return true;
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('✓ Mongoose connection closed through app termination');
  process.exit(0);
});

// Export connection function
export { connectWithRetry, mongoose, preFlightIPCheck };