// Test SSL Connection Script with Enhanced Error Handling
import { connectWithRetry, mongoose, categorizeSSLError, logConnectionDiagnostics } from "../../config/db.js";
import dotenv from "dotenv";

dotenv.config();

console.log("Testing MongoDB SSL Connection with Enhanced Error Handling...");
console.log("Using connection string:", process.env.MONGO_URI);
console.log("TLS Enabled:", process.env.MONGO_TLS === 'true');
console.log("Allow Invalid Certificates:", process.env.MONGO_TLS_ALLOW_INVALID_CERTIFICATES === 'true');
console.log("Allow Invalid Hostnames:", process.env.MONGO_TLS_ALLOW_INVALID_HOSTNAMES === 'true');

// Test the SSL error categorization function
console.log("\n=== Testing SSL Error Categorization ===");

const testErrors = [
  { message: "736128:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR:.." },
  { message: "certificate verify failed" },
  { message: "hostname/IP doesn't match certificate" },
  { message: "unknown protocol" },
  { message: "socket hang up" },
  { message: "ECONNREFUSED" }
];

testErrors.forEach((error, index) => {
  const category = categorizeSSLError(error);
  console.log(`Test ${index + 1}: ${category} - "${error.message}"`);
});

console.log("========================================\n");

// Test actual connection with enhanced error handling
const testConnection = async () => {
  try {
    console.log("Attempting to connect to MongoDB with enhanced SSL error handling...");
    const connection = await connectWithRetry(4, 2000);
    
    if (connection) {
      console.log("✓ MongoDB connection test completed successfully");
      
      // Test a simple operation
      try {
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log(`✓ Successfully listed ${collections.length} collections`);
      } catch (opErr) {
        console.error("✗ Error performing database operation:", opErr.message);
      }
      
      // Close the connection
      await mongoose.connection.close();
      console.log("✓ Connection closed successfully");
    } else {
      console.log("⚠ MongoDB connection test completed with fallback or failure");
    }
    
    process.exit(0);
  } catch (err) {
    console.error("✗ MongoDB connection test failed:", err.message);
    
    // Log detailed diagnostics
    logConnectionDiagnostics(err, {
      tls: process.env.MONGO_TLS === 'true',
      tlsAllowInvalidCertificates: process.env.MONGO_TLS_ALLOW_INVALID_CERTIFICATES === 'true',
      tlsAllowInvalidHostnames: process.env.MONGO_TLS_ALLOW_INVALID_HOSTNAMES === 'true'
    }, 1);
    
    process.exit(1);
  }
};

testConnection();