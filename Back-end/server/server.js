import dotenv from "dotenv";
dotenv.config();

import { connectWithRetry, preFlightIPCheck } from "./config/db.js";
import elasticsearchService from "./services/elasticsearchService.js";
import { app, cronService, adaptiveThrottlingService, setCronService } from "./app.js";
import { initSentry } from "./config/sentry.js";
import { validateEnvironment, logEnvironmentInfo } from "./config/validateEnv.js";
import { startNotificationWorker } from "./queue/workers/notificationWorker.js";
import { startOrderWorker } from "./queue/workers/orderWorker.js";
import { closeQueues } from "./queue/queues.js";
import mongoose from "mongoose";

// ── Centralized Environment Validation ─────────────────────────────────────
// Validates ALL critical environment variables in one place
// This replaces scattered individual checks throughout the codebase
validateEnvironment();
logEnvironmentInfo();

// ── Production Environment Safety Check ─────────────────────────────────────
// Platform-agnostic: works on Railway, Vercel, AWS, Heroku, CI/CD, etc.
// Prevents accidental deployment with NODE_ENV=development to ANY production platform
const isProductionPlatform = 
  process.env.RAILWAY_ENVIRONMENT ||  // Railway
  process.env.VERCEL_ENV === 'production' ||  // Vercel
  process.env.NODE_ENV === 'production' ||  // Explicit production
  process.env.CI === 'true' ||  // CI/CD pipelines
  process.env.AWS_EXECUTION_ENV ||  // AWS Lambda/ECS
  process.env.DYNO ||  // Heroku
  process.env.CONTAINER ||  // Generic container
  (process.env.DEPLOYMENT_TARGET && process.env.DEPLOYMENT_TARGET !== 'local');  // Custom deployments

if (isProductionPlatform && process.env.NODE_ENV !== 'production') {
  console.error('✗ FATAL: Invalid NODE_ENV in production environment');
  console.error('  NODE_ENV must be "production" when deploying to any platform');
  console.error('  Current NODE_ENV:', process.env.NODE_ENV || 'undefined');
  console.error('  Detected platform:', {
    railway: !!process.env.RAILWAY_ENVIRONMENT,
    vercel: process.env.VERCEL_ENV,
    ci: process.env.CI,
    aws: !!process.env.AWS_EXECUTION_ENV,
    heroku: !!process.env.DYNO,
    container: !!process.env.CONTAINER
  });
  console.error('');
  console.error('  FIX: Set NODE_ENV=production in your deployment platform environment variables');
  process.exit(1);
}

// Positive assertion for debugging
console.log('[Startup] Environment check: NODE_ENV=', process.env.NODE_ENV || 'undefined', ' | RAILWAY_ENVIRONMENT=', process.env.RAILWAY_ENVIRONMENT || 'undefined', ' | VERCEL_ENV=', process.env.VERCEL_ENV || 'undefined');
  
if (process.env.NODE_ENV === 'production') {
  console.log('[Startup] ✓ Production mode verified - security hardening enabled');
    
  // Advanced: Warn if .env file is detected in production (should use platform variables)
  const fs = await import('fs');
  const path = await import('path');
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    console.warn('[Startup] ⚠ .env file detected in production - this should not be used');
    console.warn('[Startup] ⚠ Production should use platform environment variables only');
  }
} else {
  console.warn('[Startup] ⚠ Running in development mode:', process.env.NODE_ENV || 'development');
  console.warn('[Startup] ⚠ Debug routes enabled, verbose error messages active');
}

// Initialize Sentry early
initSentry();

// ── Global error guards ─────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('✗ Uncaught Exception:', err.stack || err);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  console.error('✗ Unhandled Rejection:', reason instanceof Error ? reason.stack : reason);
});

// ── Single bootstrap: DB → services → HTTP ─────────────────────────────────────
async function bootstrap() {
  try {
    console.log('=== Starting Autobacs Backend Server ===');
    console.log('Environment:', process.env.NODE_ENV || 'development');

    // 1. Connect database first — everything depends on it
    console.log('⏳ Connecting to database...');
    const ipCheckPassed = await preFlightIPCheck();
    if (!ipCheckPassed) console.warn('⚠ IP pre-flight mismatch, continuing anyway');

    await connectWithRetry();
    console.log('✓ Database connected');

    // ── MongoDB Connection Pool Monitoring ─────────────────────────────────────
    // Monitor connection pool health to detect leaks and exhaustion
    mongoose.connection.on('connectionPoolCreated', (event) => {
      console.log(`[MongoDB] Connection pool created: ${event.address}`);
    });

    mongoose.connection.on('connectionPoolReady', (event) => {
      console.log(`[MongoDB] Connection pool ready: ${event.address}`);
    });

    mongoose.connection.on('connectionCreated', (event) => {
      console.log(`[MongoDB] Connection created: ${event.address} (ID: ${event.connectionId})`);
    });

    mongoose.connection.on('connectionReady', (event) => {
      // Connection established and ready for use
    });

    mongoose.connection.on('connectionClosed', (event) => {
      if (event.reason && event.reason.message) {
        console.warn(`[MongoDB] Connection closed: ${event.address} (ID: ${event.connectionId}) - ${event.reason.message}`);
      }
    });

    mongoose.connection.on('connectionCheckOutStarted', (event) => {
      // Application requested a connection from pool
    });

    mongoose.connection.on('connectionCheckOutFailed', (event) => {
      console.error(`[MongoDB] Connection checkout failed: ${event.address} - ${event.reason}`);
    });

    mongoose.connection.on('connectionCheckedOut', (event) => {
      // Connection checked out from pool (in use)
    });

    mongoose.connection.on('connectionCheckedIn', (event) => {
      // Connection returned to pool
    });

    mongoose.connection.on('connectionPoolCleared', (event) => {
      console.warn(`[MongoDB] Connection pool cleared: ${event.address}`);
    });

    // Periodic pool stats logging (every 5 minutes)
    setInterval(() => {
      const pool = mongoose.connection.client?.topology?.s?.pool;
      if (pool) {
        const stats = {
          totalConnections: pool.totalConnectionCount || 0,
          availableConnections: pool.availableConnectionCount || 0,
          currentConnections: pool.currentConnectionCount || 0,
          pendingConnections: pool.pendingConnectionCount || 0,
          maxPoolSize: pool.options?.maxPoolSize || 100,
          minPoolSize: pool.options?.minPoolSize || 0
        };

        // Alert if pool is nearly exhausted
        const utilizationRate = (stats.currentConnections / stats.maxPoolSize) * 100;
        if (utilizationRate > 80) {
          console.error(`[MongoDB] ⚠️ Connection pool utilization HIGH: ${utilizationRate.toFixed(1)}% (${stats.currentConnections}/${stats.maxPoolSize})`);
        } else if (utilizationRate > 60) {
          console.warn(`[MongoDB] Connection pool utilization elevated: ${utilizationRate.toFixed(1)}%`);
        }
      }
    }, 300000); // Every 5 minutes

    // 2. Start cron jobs now that DB is ready
    cronService.initializeCronJobs();
    setCronService(cronService);
    console.log('✓ Cron jobs started');

    // 3. Start adaptive throttling (non-fatal if it fails)
    try {
      await adaptiveThrottlingService.initialize();
      console.log('✓ Adaptive throttling initialized');
    } catch (e) {
      console.warn('⚠ Adaptive throttling skipped:', e.message);
    }

    // 4. CRITICAL: Redis health check (required in production)
    if (process.env.NODE_ENV === 'production' && process.env.REDIS_URL) {
      try {
        // Import Redis client from rate limiter
        const { default: Redis } = await import('ioredis');
        const testClient = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          commandTimeout: 2000,
          tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
        });

        await testClient.ping();
        await testClient.quit();
        console.log('✓ Redis connection verified');
      } catch (err) {
        console.error('✗ FATAL: Redis is required in production but connection failed');
        console.error('  Error:', err.message);
        console.error('');
        console.error('  FIX: Ensure Redis is running and REDIS_URL is correctly configured');
        process.exit(1);
      }
    } else if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
      console.error('✗ FATAL: REDIS_URL environment variable is required in production');
      console.error('');
      console.error('  FIX: Provision Redis (e.g., Upstash) and set REDIS_URL + REDIS_TOKEN');
      process.exit(1);
    } else {
      console.log('✓ Redis check skipped (development mode)');
    }

    // 5. Start queue workers (non-fatal — disabled when REDIS_URL is absent)
    try {
      startNotificationWorker();
      startOrderWorker();
      console.log('✓ Queue workers started');
    } catch (e) {
      console.warn('⚠ Queue workers skipped:', e.message);
    }

    // 6. Elasticsearch in background (optional, non-fatal)
    elasticsearchService.testConnection().catch(() => {});

    // 5. Start HTTP server last, after all services are ready
    const PORT = process.env.PORT || 8080;
    const HOST = '0.0.0.0';

    const server = app.listen(PORT, HOST, () => {
      const addr = server.address();
      console.log(`✓ HTTP server listening on ${addr.address}:${addr.port}`);
      console.log('✓ Health: /health | Ready: /ready');
      console.log('=== Server Ready ===');
    });

    server.on('error', (err) => {
      console.error('✗ HTTP server error:', err);
      process.exit(1);
    });

    // Reasonable timeouts
    server.timeout = 30000;
    server.headersTimeout = 31000;

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`⏹ ${signal} received, shutting down gracefully...`);
      server.close(async () => {
        try {
          await closeQueues();
          console.log('✓ Queues closed');
        } catch (_) {}
        try {
          await mongoose.connection.close();
          console.log('✓ DB connection closed');
        } catch (_) {}
        process.exit(0);
      });
      // Force exit after 10 s if close hangs
      setTimeout(() => process.exit(1), 10000);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('✗ Bootstrap failed:', error.message);
    process.exit(1);
  }
}

bootstrap();

