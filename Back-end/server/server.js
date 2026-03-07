import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectWithRetry, preFlightIPCheck } from "./config/db.js";
import elasticsearchService from "./services/elasticsearchService.js";
import { app, cronService, adaptiveThrottlingService, setCronService } from "./app.js";
import { initSentry } from "./config/sentry.js";
import net from "net";

dotenv.config();

// Initialize Sentry early in the boot process
initSentry();

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (err) => {
  console.error('✗ Uncaught Exception:', err);
  console.error('Stack trace:', err.stack);
  
  // Attempt graceful shutdown
  setTimeout(() => {
    console.log('✗ Process terminated due to uncaught exception');
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('✗ Unhandled Rejection at:', promise);
  console.error('✗ Reason:', reason);
  
  // Log but don't exit - this allows the app to continue
  if (process.env.NODE_ENV === 'development') {
    console.error('Full stack:', reason instanceof Error ? reason.stack : reason);
  }
});

// Enhanced MongoDB connection with better options and retry logic
const mongooseOptions = {
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of default 30s
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  family: 4 // Use IPv4, skip trying IPv6
};

// Connection event listeners
mongoose.connection.on('connected', () => {
  console.log('✓ Mongoose connected to MongoDB');

  // Initialize cron jobs after database connection is established
  cronService.initializeCronJobs();

  // Set the cron service instance for the scheduled tasks routes
  setCronService(cronService);

  // Initialize adaptive throttling service
  adaptiveThrottlingService.initialize().catch(err => {
    console.error('Failed to initialize adaptive throttling service:', err);
  });
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠ Mongoose disconnected from MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('✗ Mongoose connection error:', err);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('✓ Mongoose connection closed through app termination');
  process.exit(0);
});

// Initialize server with pre-flight IP check
async function initializeServer() {
  try {
    console.log('=== Starting Autobacs Backend Server ===');
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Port configuration:', process.env.PORT || 'default (8080)');
    
    // Start server directly on the provided port BEFORE heavy DB operations
    const PORT = process.env.PORT || 8080;
    const HOST = '0.0.0.0'; // Explicitly bind to all interfaces

    const server = app.listen(PORT, HOST, () => {
      console.log(`✓ Server running on ${HOST}:${PORT}`);
      console.log(`✓ Public URL: https://ecommerceautobacs-production.up.railway.app`);
      console.log(`✓ Health check: http://${HOST}:${PORT}/health`);
      console.log(`✓ Ready check: http://${HOST}:${PORT}/ready`);
      
      // Log the actual server address for verification
      const addr = server.address();
      console.log(`✓ Bound to: ${addr.address}:${addr.port} (family: ${addr.family})`);
    });

    server.on('error', (err) => {
      console.error('✗ Server listen error:', err);
      process.exit(1);
    });

    // Set timeouts to prevent hanging
    server.timeout = 30000;
    server.headersTimeout = 31000;

    // Log incoming requests
    server.on('request', (req, res) => {
      console.log(`📩 Incoming: ${req.method} ${req.url}`);
    });

    // Initialize database (non-blocking)
    console.log('\n⏳ Initializing database...');
    const ipCheckPassed = await preFlightIPCheck();
    if (!ipCheckPassed) {
      console.warn('⚠ IP mismatch but continuing');
    }

    const dbConnection = await connectWithRetry();
    if (dbConnection) {
      console.log('✓ Database connected');
    }

    // Elasticsearch in background
    console.log('⏳ Services initializing...');
    elasticsearchService.testConnection().catch(() => {});

    // Delay non-critical services
    setTimeout(() => {
      cronService.initializeCronJobs();
      setCronService(cronService);
      console.log('✓ Cron jobs initialized');
    }, 100);

    setTimeout(async () => {
      try {
        await adaptiveThrottlingService.initialize();
        console.log('✓ Adaptive throttling initialized');
      } catch (e) {
        console.log('⚠ Throttling skipped');
      }
    }, 200);

    console.log('\n=== Server Ready ===\n');

  } catch (error) {
    console.error('✗ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Initialize server
initializeServer();

