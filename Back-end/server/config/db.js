import mongoose from "mongoose";
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Per-query-type timeout budgets. Apply these at the call site with
// .maxTimeMS(QUERY_TIMEOUTS.listing) or .option({ maxTimeMS: QUERY_TIMEOUTS.aggregation }).
// A global mongoose.set('maxTimeMS') is intentionally NOT used — it kills analytics
// aggregations and import jobs that legitimately need more than 5 s.
export const QUERY_TIMEOUTS = {
  listing:     parseInt(process.env.MONGO_TIMEOUT_LISTING_MS)     || 3000,
  aggregation: parseInt(process.env.MONGO_TIMEOUT_AGGREGATION_MS) || 15000,
  import:      parseInt(process.env.MONGO_TIMEOUT_IMPORT_MS)      || 30000,
};

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
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE) || 10,
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE) || 2,
  heartbeatFrequencyMS: 10000,
  // autoIndex builds every schema index at connect. In prod that risks a FOREGROUND
  // index build (latency/lock spike) the first time a NEW index is deployed on a large
  // collection. Default OFF in prod — existing indexes are already built and critical
  // ones are re-ensured by the explicit createIndex safety-net below. NEW prod indexes
  // must be built via a background migration, not autoIndex. Override with
  // MONGO_AUTOINDEX=true if you knowingly want connect-time syncing. (DB-2)
  autoIndex:
    process.env.MONGO_AUTOINDEX != null
      ? process.env.MONGO_AUTOINDEX === 'true'
      : process.env.NODE_ENV !== 'production',
};

// Enhanced connection retry logic with SSL error handling
// SECURITY: No TLS fallback in production - connection fails if TLS cannot be established
const connectWithRetry = async (retries = 4, interval = 2000) => {
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
        console.error('[SECURITY] TLS connection failed - will NOT fallback to unencrypted connection');
      } else if (errorCategory === 'CERTIFICATE_VALIDATION') {
        console.error('Certificate Validation Error:');
        console.error('- SSL certificate may be expired or invalid');
        console.error('- Contact MongoDB Atlas support or check certificate configuration');
        console.error('[SECURITY] TLS certificate validation failed - connection rejected');
      } else if (errorCategory === 'HOSTNAME_MISMATCH') {
        console.error('Hostname Mismatch Error:');
        console.error('- SSL certificate hostname does not match server hostname');
        console.error('- This may indicate a DNS or certificate configuration issue');
        console.error('[SECURITY] TLS hostname validation failed - connection rejected');
      }
      
      if (i === retries - 1) {
        console.error("✗ MongoDB connection failed after max retries");
        
        // In production, NEVER start without database connection
        if (process.env.NODE_ENV === 'production') {
          console.error('[FATAL] Production environment requires MongoDB connection. Exiting.');
          process.exit(1);
        }
        
        console.warn("⚠ Warning: Starting server without database connection in development mode. Some features may not work properly.");
        return null; // Return null only in development
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
  // Verify critical indexes exist (idempotent — createIndex is a no-op if already present)
  ensureCriticalIndexes();
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

/**
 * Verify that critical MongoDB indexes exist and create them if missing.
 * Uses native driver createIndex() which is idempotent — safe to run on every startup.
 * Mongoose autoIndex covers schema-declared indexes, but this provides an explicit
 * safety net for production environments where autoIndex may be bypassed.
 */
async function ensureCriticalIndexes() {
  try {
    const db = mongoose.connection.db;

    // Product slug — prevents duplicate-content SEO disasters
    await db.collection('products').createIndex(
      { slug: 1 },
      { unique: true, background: true }
    );
    console.log('✓ Product slug unique index confirmed');

    // WarehouseInventory (warehouse, product) unique — the hot path for order fulfillment
    // selectWarehouseForOrder does a findOneAndUpdate on this pair per item per warehouse
    await db.collection('warehouseinventories').createIndex(
      { warehouse: 1, product: 1 },
      { unique: true, background: true }
    );
    // Supporting index for per-warehouse listing queries
    await db.collection('warehouseinventories').createIndex(
      { warehouse: 1, isActive: 1 },
      { background: true }
    );
    console.log('✓ WarehouseInventory indexes confirmed');

    // Warehouse operational query index — used by selectWarehouseForOrder
    await db.collection('warehouses').createIndex(
      { operationalStatus: 1, isActive: 1 },
      { background: true }
    );
    console.log('✓ Warehouse operational index confirmed');

    // MONEY-CRITICAL: Payment gatewayPaymentId unique — the serialization point that
    // makes payment processing idempotent under concurrent/duplicate Razorpay webhooks.
    // Partial on $type:string so legacy/null gatewayPaymentId docs are excluded.
    // NOTE: if pre-existing duplicates exist this build fails — run
    // scripts/fix-payment-gateway-index.js first to dedupe, then this confirms it.
    await db.collection('payments').createIndex(
      { gatewayPaymentId: 1 },
      {
        unique: true,
        partialFilterExpression: { gatewayPaymentId: { $type: 'string' } },
        background: true
      }
    );
    console.log('✓ Payment gatewayPaymentId unique index confirmed');

    // MONEY-CRITICAL: CouponUserUsage (coupon, user) unique — the ONLY thing enforcing
    // a coupon's per-user usage limit. couponUserUsageRepository.incrementGuarded relies
    // on this index throwing E11000 when an at-cap doc already exists; without it the
    // guarded upsert silently inserts a second counter doc and the per-user cap can be
    // redeemed an unbounded number of times. autoIndex is off in production, so this
    // safety net is what actually creates it there.
    // NOTE: if pre-existing duplicate {coupon,user} docs exist this build fails —
    // dedupe (keep the max count) before this can succeed.
    await db.collection('couponuserusages').createIndex(
      { coupon: 1, user: 1 },
      { unique: true, background: true }
    );
    console.log('✓ CouponUserUsage per-user unique index confirmed');

    // Sales-CRM lead worklist sort — serves the default admin leads view (a pool/rep
    // queue ranked by { leadScore, createdAt }). Non-unique perf index; declared on the
    // Lead schema too, but autoIndex is off in prod so this safety net is what actually
    // builds it there. Without it the score sort falls back to a blocking in-memory sort.
    await db.collection('leads').createIndex(
      { assignedRep: 1, leadScore: -1, createdAt: -1 },
      { background: true }
    );
    console.log('✓ Lead worklist score index confirmed');
  } catch (err) {
    // Log but never crash the server over index verification
    console.error('✗ ensureCriticalIndexes error:', err.message);
  }
}

// Export connection function and helper functions
export { connectWithRetry, mongoose, preFlightIPCheck, categorizeSSLError, logConnectionDiagnostics };
