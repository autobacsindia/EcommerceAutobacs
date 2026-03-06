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
    // This ensures Railway Health Checks pass immediately and prevents 502 Bad Gateway
    const PORT = process.env.PORT || 8080;

    // Bind explicitly to '::' (IPv6) to ensure Railway's proxy can route traffic from outside the container
    const server = app.listen(PORT, '::', () => {
      console.log(`✓ Server running on port ${PORT} (::)`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ API Documentation: http://localhost:${PORT}/`);
    });

    server.on('error', (err) => {
      console.error('✗ Server listen error:', err);
      process.exit(1);
    });

    // Perform pre-flight IP check
    const ipCheckPassed = await preFlightIPCheck();

    if (!ipCheckPassed) {
      console.warn('⚠ Warning: IP mismatch detected. Starting server anyway, but database connection may fail.');
      console.warn('Run "npm run diagnose-ip" for assistance with IP whitelist issues.');
    }

    // Initial connection using the new retry logic
    const dbConnection = await connectWithRetry();

    if (dbConnection) {
      console.log('✓ Database connection established');
    } else {
      console.log('⚠ Database connection not available');
    }

    // Test Elasticsearch connection
    console.log('\n--- Elasticsearch Connection Check ---');
    const esStatus = await elasticsearchService.testConnection();

    if (esStatus.connected) {
      console.log('✓ Elasticsearch features enabled');
    } else if (esStatus.enabled) {
      console.log('⚠ Elasticsearch enabled but not connected - using MongoDB fallback');
    }
    console.log('---------------------------------------\n');

    // Initialize cron jobs after everything is set up
    console.log('Initializing services...');
    cronService.initializeCronJobs();
    setCronService(cronService);

    // Initialize adaptive throttling service with error handling
    console.log('Initializing adaptive throttling service...');
    try {
      await adaptiveThrottlingService.initialize();
      console.log('✓ Adaptive Throttling Service initialized successfully');
    } catch (throttleError) {
      console.error('⚠ Failed to initialize adaptive throttling service:', throttleError.message);
      console.error('Full error:', throttleError);
      // Don't exit - continue without this service
    }

    console.log('\n=== Server Initialization Complete ===');
    console.log('Server is ready to accept connections');
    console.log('Health check: http://localhost:' + PORT + '/health');
    console.log('Ready check: http://localhost:' + PORT + '/ready');
    console.log('=====================================\n');

  } catch (error) {
    console.error('✗ Failed to initialize server:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Initialize server
initializeServer();
