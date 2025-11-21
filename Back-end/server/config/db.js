import mongoose from "mongoose";
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Mongoose connection options with optimized retry configuration
const mongooseOptions = {
  family: 4, // Use IPv4, skip trying IPv6
  serverSelectionTimeoutMS: 5000, // Reduced timeout for faster feedback
  socketTimeoutMS: 10000, // Close sockets after 10 seconds of inactivity
  
  // SSL/TLS specific options
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
      if (err.message.includes('IP') || err.message.includes('whitelist')) {
        console.error('IP Whitelist Issue Detected:');
        console.error('- Make sure your current IP address is added to the MongoDB Atlas IP whitelist.');
        console.error('- Your current IP may have changed since the last whitelist update.');
        console.error('- Consider using 0.0.0.0/0 temporarily for development (NOT recommended for production).');
        console.error('- Run "npm run diagnose-ip" to check your current IP and get update instructions.');
        console.error('- Documentation: MongoDB_IP_Whitelist_Update.md');
      } else if (err.name === 'MongoNetworkError' && err.message.includes('SSL')) {
        console.error('SSL/TLS connection issue detected. Consider checking:');
        console.error('- Node.js version compatibility with MongoDB Atlas');
        console.error('- Network connectivity to MongoDB servers');
        console.error('- Firewall/proxy settings');
        console.error('- Certificate validation requirements');
      } else if (err.message.includes('authentication') || err.message.includes('Auth')) {
        console.error('Authentication Issue Detected:');
        console.error('- Verify MongoDB URI credentials are correct');
        console.error('- Check if the user exists and has proper permissions');
      }
      
      if (i === retries - 1) {
        console.error("✗ MongoDB connection failed after max retries");
        throw err;
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
  if (err.name === 'MongoNetworkError' && (err.message.includes('IP') || err.message.includes('whitelist'))) {
    console.error('IP Whitelist Issue: Make sure your current IP address is added to the MongoDB Atlas IP whitelist.');
    console.error('Note: Your IP address may have changed. Current IP should be whitelisted.');
    console.error('Run "npm run diagnose-ip" to check your current IP and get update instructions.');
    console.error('Documentation: MongoDB_IP_Whitelist_Update.md');
  } else if (err.name === 'MongoNetworkError' && err.message.includes('SSL')) {
    console.error('SSL/TLS connection issue detected. Consider checking:');
    console.error('- Node.js version compatibility with MongoDB Atlas');
    console.error('- Network connectivity to MongoDB servers');
    console.error('- Firewall/proxy settings');
    console.error('- Certificate validation requirements');
  }
});

// Pre-flight IP check before connecting
async function preFlightIPCheck() {
  try {
    console.log('Performing pre-flight IP check...');
    const { stdout } = await execPromise('node utils/mongodb-ip-diagnostic.js --json');
    
    // Parse the JSON output to check for IP mismatch
    const jsonLine = stdout.split('\n').find(line => line.trim().startsWith('{'));
    if (!jsonLine) {
      console.warn('⚠ Could not parse diagnostic output');
      return true;
    }
    
    let diagnosticData;
    try {
      diagnosticData = JSON.parse(jsonLine);
    } catch (parseError) {
      console.warn('⚠ Failed to parse JSON from diagnostic output:', parseError.message);
      return true;
    }
    
    if (diagnosticData.mismatchDetected) {
      console.warn('⚠ IP Address Mismatch Detected During Pre-flight Check!');
      console.warn(`  Documented IP: ${diagnosticData.documentedIP}`);
      console.warn(`  Current IP:    ${diagnosticData.currentIP}`);
      
      // Attempt to automatically add IP if Atlas API credentials are available
      if (process.env.MONGODB_ATLAS_PUBLIC_API_KEY && 
          process.env.MONGODB_ATLAS_PRIVATE_API_KEY &&
          process.env.MONGODB_ATLAS_PROJECT_ID &&
          process.env.MONGODB_ATLAS_CLUSTER_NAME) {
        console.log('Attempting to automatically add current IP to whitelist...');
        try {
          // Import and use MongoDBWhitelistManager
          const { default: MongoDBWhitelistManager } = await import('../utils/mongodb-whitelist-manager.js');
          const manager = new MongoDBWhitelistManager();
          await manager.addCurrentIP('Auto-added by pre-flight check', 24);
          console.log('✓ IP automatically added to whitelist. Please restart the application.');
          return false; // Still return false to indicate the app should be restarted
        } catch (whitelistError) {
          console.error('✗ Failed to automatically add IP to whitelist:', whitelistError.message);
        }
      }
      
      console.warn('  Please update your MongoDB Atlas IP whitelist before proceeding.');
      console.warn('  Run "npm run diagnose-ip" for detailed instructions.');
      return false;
    }
    
    console.log('✓ Pre-flight IP check passed');
    return true;
  } catch (error) {
    console.warn('⚠ Pre-flight IP check failed:', error.message);
    console.warn('Continuing with database connection...');
    return true; // Continue even if pre-flight check fails
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('✓ Mongoose connection closed through app termination');
  process.exit(0);
});

// Export connection function
export { connectWithRetry, mongoose, preFlightIPCheck };