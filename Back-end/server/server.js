import dotenv from "dotenv";
dotenv.config();

import { connectWithRetry, preFlightIPCheck } from "./config/db.js";
import elasticsearchService from "./services/elasticsearchService.js";
import { app, cronService, adaptiveThrottlingService, setCronService } from "./app.js";
import { initSentry } from "./config/sentry.js";
import mongoose from "mongoose";

// ── JWT Secret strength validation ─────────────────────────────────────────
const _jwtSecret = process.env.JWT_SECRET || '';
console.log(`[Startup] JWT_SECRET length: ${_jwtSecret.length} chars`);
if (_jwtSecret.length < 64) {
  const msg = `✗ FATAL: JWT_SECRET is missing or too short (${_jwtSecret.length} chars, minimum 64). ` +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"';
  console.error(msg);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  } else {
    console.warn('[Startup] ⚠ Continuing with weak JWT_SECRET in non-production environment.');
  }
} else {
  console.log('[Startup] ✓ JWT_SECRET strength OK');
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

    // 4. Elasticsearch in background (optional, non-fatal)
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

