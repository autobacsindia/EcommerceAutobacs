import mongoose from "mongoose";
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Mongoose connection options with enhanced SSL/TLS support
const mongooseOptions = {
  serverSelectionTimeoutMS: 5000,  // 5s — fail fast if Atlas nodes are unreachable; connectWithRetry handles startup retries
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  // Do NOT force family:4 — Atlas SRV needs flexible DNS resolution
  
  // Do NOT set tls:false — mongodb+srv handles TLS automatically
  // Only override if explicitly set in env
  ...(process.env.MONGO_TLS === 'true' ? { tls: true } : {}),
  ...(process.env.MONGO_TLS_ALLOW_INVALID_CERTIFICATES === 'true' ? { tlsAllowInvalidCertificates: true } : {}),
  ...(process.env.MONGO_TLS_ALLOW_INVALID_HOSTNAMES === 'true' ? { tlsAllowInvalidHostnames: true } : {}),
  ...(process.env.MONGO_TLS_CA_FILE ? { tlsCAFile: process.env.MONGO_TLS_CA_FILE } : {}),
  ...(process.env.MONGO_TLS_CERTIFICATE_KEY_FILE ? { tlsCertificateKeyFile: process.env.MONGO_TLS_CERTIFICATE_KEY_FILE } : {}),
  
  retryWrites: true,
  maxPoolSize: 20,      // increased from 10 — handles concurrent admin + storefront traffic
  minPoolSize: 5,       // keep warm connections ready; avoids cold-start latency spikes
  heartbeatFrequencyMS: 10000
};

// Enhanced connection retry logic with SSL error handling and fallback mechanisms
const connectWithRetry = async (retries = 4, interval = 2000) => {
  // Store original options for potential fallback
  const originalOptions = { ...mongooseOptions };
  
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, mongooseOptions);
      console.log("✓ MongoDB connected successfully");
      return mongoose.connection;
    } catch (err) {
      console.error(`✗ MongoDB connection attempt ${i + 1} failed:`, err.message);
      
      // Enhanced error categorization and handling
      const errorCategory = categorizeSSLError(err);
      
      // Log detailed diagnostic information
      logConnectionDiagnostics(err, mongooseOptions, i + 1);
      
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
      } else if (errorCategory === 'INTERNAL_SSL_ERROR') {
        console.error('SSL/TLS Internal Error Detected:');
        console.error('- This may indicate server-side SSL configuration issues');
        console.error('- Check MongoDB server SSL certificate validity');
        console.error('- Verify network connectivity during SSL handshake');
        
        // Implement fallback strategy based on attempt number
        if (i === 0) {
          console.log('Attempting fallback: Disabling TLS...');
          mongooseOptions.tls = false;
        } else if (i === 1 && originalOptions.tls !== false) {
          console.log('Attempting fallback: Allowing invalid certificates...');
          mongooseOptions.tls = originalOptions.tls;
          mongooseOptions.tlsAllowInvalidCertificates = true;
        } else if (i === 2) {
          console.log('Attempting fallback: Allowing invalid hostnames...');
          mongooseOptions.tlsAllowInvalidHostnames = true;
        }
      } else if (errorCategory === 'CERTIFICATE_VALIDATION') {
        console.error('Certificate Validation Error:');
        console.error('- SSL certificate may be expired or invalid');
        console.error('- Consider setting MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true for development');
        
        // Implement certificate validation fallback
        if (i === 0) {
          console.log('Attempting fallback: Allowing invalid certificates...');
          mongooseOptions.tlsAllowInvalidCertificates = true;
        }
      } else if (errorCategory === 'HOSTNAME_MISMATCH') {
        console.error('Hostname Mismatch Error:');
        console.error('- SSL certificate hostname does not match server hostname');
        console.error('- Consider setting MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true for development');
        
        // Implement hostname validation fallback
        if (i === 0) {
          console.log('Attempting fallback: Allowing invalid hostnames...');
          mongooseOptions.tlsAllowInvalidHostnames = true;
        }
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

// Enhanced connection event listeners with SSL error handling
mongoose.connection.on('connected', () => {
  console.log('✓ Mongoose connected to MongoDB');
  // Log successful connection details for monitoring
  logSuccessfulConnection(mongooseOptions);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠ Mongoose disconnected from MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('✗ Mongoose connection error:', err);
  
  // Enhanced error handling with categorization
  const errorCategory = categorizeSSLError(err);
  
  // Specific handling for common errors
  if (err.name === 'MongoNetworkError' && err.message.includes('ECONNREFUSED')) {
    console.error('Connection Refused: Make sure MongoDB is running on the specified IP and port.');
    console.error('Check firewall settings to ensure port 27017 is accessible.');
  } else if (err.message.includes('authentication') || err.message.includes('Auth')) {
    console.error('Authentication Issue: Verify MongoDB URI credentials are correct.');
  } else if (errorCategory === 'INTERNAL_SSL_ERROR') {
    console.error('SSL/TLS Internal Error: Check server SSL configuration and certificates.');
  } else if (errorCategory === 'CERTIFICATE_VALIDATION') {
    console.error('Certificate Validation Error: SSL certificate may be expired or invalid.');
  } else if (errorCategory === 'HOSTNAME_MISMATCH') {
    console.error('Hostname Mismatch Error: SSL certificate hostname does not match server.');
  }
});

// Pre-flight IP check is not needed for direct IP connections
async function preFlightIPCheck() {
  // For direct IP connections, we don't need to check Atlas IP whitelisting
  console.log('Direct IP connection - skipping Atlas IP whitelist check');
  return true;
}

// Helper function to categorize SSL errors
const categorizeSSLError = (error) => {
  if (!error || !error.message) return 'UNKNOWN_ERROR';
  
  // Certificate validation errors
  if (error.message.includes('CERTIFICATE_VERIFY_FAILED') || 
      error.message.includes('certificate verify failed') ||
      error.message.includes('self signed certificate') ||
      error.message.includes('unable to get local issuer certificate')) {
    return 'CERTIFICATE_VALIDATION';
  } 
  // Internal SSL errors (the specific error from the issue)
  else if (error.message.includes('TLSV1_ALERT_INTERNAL_ERROR') ||
           error.message.includes('SSL routines:OPENSSL_internal')) {
    return 'INTERNAL_SSL_ERROR';
  }
  // Hostname mismatch errors
  else if (error.message.includes('hostname/IP doesn\'t match certificate') ||
           error.message.includes('IP address mismatch') ||
           error.message.includes('hostname mismatch')) {
    return 'HOSTNAME_MISMATCH';
  }
  // Protocol mismatch errors
  else if (error.message.includes('unknown protocol') ||
           error.message.includes('unsupported protocol') ||
           error.message.includes('wrong version number')) {
    return 'PROTOCOL_MISMATCH';
  }
  // Connection reset during SSL handshake
  else if (error.message.includes('socket hang up') ||
           error.message.includes('Connection reset') ||
           error.message.includes('ECONNRESET')) {
    return 'CONNECTION_RESET';
  }
  
  return 'UNKNOWN_SSL_ERROR';
};

// Helper function to log connection diagnostics
const logConnectionDiagnostics = (error, options, attemptNumber) => {
  console.log(`\n=== SSL Connection Diagnostics (Attempt ${attemptNumber}) ===`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Error Category: ${categorizeSSLError(error)}`);
  console.log(`Error Message: ${error.message}`);
  console.log(`TLS Enabled: ${options.tls}`);
  console.log(`Allow Invalid Certificates: ${options.tlsAllowInvalidCertificates}`);
  console.log(`Allow Invalid Hostnames: ${options.tlsAllowInvalidHostnames}`);
  
  // Log stack trace for debugging
  if (error.stack) {
    console.log(`Stack Trace: ${error.stack.substring(0, 500)}${error.stack.length > 500 ? '...' : ''}`);
  }
  console.log('=====================================\n');
};

// Helper function to log successful connections
const logSuccessfulConnection = (options) => {
  console.log('\n=== Successful MongoDB Connection ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`TLS Enabled: ${options.tls}`);
  console.log(`Allow Invalid Certificates: ${options.tlsAllowInvalidCertificates}`);
  console.log(`Allow Invalid Hostnames: ${options.tlsAllowInvalidHostnames}`);
  console.log('=====================================\n');
};

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('✓ Mongoose connection closed through app termination');
  process.exit(0);
});

// Export connection function and helper functions
export { connectWithRetry, mongoose, preFlightIPCheck, categorizeSSLError, logConnectionDiagnostics };
