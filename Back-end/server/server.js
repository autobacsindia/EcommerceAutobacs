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
    // Perform pre-flight IP check
    const ipCheckPassed = await preFlightIPCheck();

    if (!ipCheckPassed) {
      console.warn('⚠ Warning: IP mismatch detected. Starting server anyway, but database connection may fail.');
      console.warn('Run "npm run diagnose-ip" for assistance with IP whitelist issues.');
    }

    // Initial connection using the new retry logic
    const dbConnection = await connectWithRetry();

    // Test Elasticsearch connection
    console.log('\n--- Elasticsearch Connection Check ---');
    const esStatus = await elasticsearchService.testConnection();

    if (esStatus.connected) {
      console.log('✓ Elasticsearch features enabled');
    } else if (esStatus.enabled) {
      console.log('⚠ Elasticsearch enabled but not connected - using MongoDB fallback');
    }
    console.log('---------------------------------------\n');

    // Start server with port fallback if in use
    const railwayPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
    const candidates = [
      railwayPort,
      5000, 5001, 5002
    ].filter(Boolean);

    const isPortAvailable = (port) => {
      return new Promise((resolve) => {
        const tester = net.createServer()
          .once('error', () => resolve(false))
          .once('listening', () => tester.close(() => resolve(true)))
          .listen(port, '0.0.0.0');
      });
    };

    let selectedPort = null;
    for (const p of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const available = await isPortAvailable(p);
      if (available) {
        selectedPort = p;
        break;
      } else {
        console.warn(`⚠ Port ${p} unavailable (in use).`);
      }
    }

    if (!selectedPort) {
      throw new Error('No available ports to start server');
    }

    await new Promise((resolve) => {
      const server = app.listen(selectedPort, '0.0.0.0', () => {
        console.log(`✓ Server running on port ${selectedPort}`);
        console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`✓ API Documentation: http://localhost:${selectedPort}/`);
        if (dbConnection) {
          console.log('✓ Database connection established');
        } else {
          console.log('⚠ Database connection not available');
        }
        resolve();
      });
      server.on('error', (err) => {
        console.error('✗ Server listen error:', err);
        process.exit(1);
      });
    });
  } catch (error) {
    console.error('✗ Failed to initialize server:', error.message);
    process.exit(1);
  }
}

// Initialize server
initializeServer();
