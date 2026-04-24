import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import * as Sentry from "@sentry/node";
import { randomUUID } from "crypto";

// Initialize Sentry FIRST (before any other code)
// This ensures all errors are captured from the start
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
  });
  console.log('[Sentry] Initialized successfully');
} else {
  console.warn('[Sentry] DSN not configured - error tracking disabled');
}

// ── Import domain router (aggregates all /api/v1/* routes) ──────────────────
import apiRouter from './routes/index.js';

// ── Import debug routes (development only) ──────────────────────────────────
import debugRoutes from './routes/debug.js';

// ── Import cron service setter ──────────────────────────────────────────────
import { setCronService } from './routes/scheduledTasks.js';

// Import middleware
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
// Sanitization middleware
import { mongoSanitization, requestSanitization } from "./middleware/sanitizationMiddleware.js";
import { sentryContextMiddleware } from "./middleware/sentryContext.js";
import cookieParser from "cookie-parser";
import csrfProtection from "./middleware/csrfMiddleware.js";
import { redisHealthCheck } from "./middleware/redisHealthCheck.js";
import { 
  apiRateLimit, 
  wishlistRateLimit, 
  frequentAccessRateLimit,
  publicBrowsingRateLimit,
  authenticatedUserRateLimit,
  checkoutRateLimit,
  returnsRateLimit,
  adminRateLimit,
  locationRateLimit,
  contactFormRateLimit,
  consultationRateLimit,
  healthCheckRateLimit,
  metricsRateLimit,
  globalApiRateLimit
} from "./middleware/rateLimitMiddleware.js";

// Import cron service
import CronService from "./services/cronService.js";

// Import adaptive throttling service
import adaptiveThrottlingService from "./services/adaptiveThrottlingService.js";

// NOTE: dotenv.config() is called once in server.js before this module is loaded
const app = express();

// ── Explicit Environment Configuration ──────────────────────────────────────
// Don't rely on Express defaults - explicitly set based on NODE_ENV
const isProd = process.env.NODE_ENV === 'production';
app.set('env', isProd ? 'production' : 'development');

// Trust the first proxy (required for Cloudflare/Railway/Heroku)
// This ensures req.ip correctly identifies the client IP via X-Forwarded-For
// In production, this is critical for rate limiting, security, and logging
app.set('trust proxy', 1);

// ULTRA-SIMPLE TEST ENDPOINT - NO MIDDLEWARE, NO DATABASE
// Use this to verify Express is responding at all
app.get('/ping', (req, res) => {
  res.send('pong');
});

// ── Request ID (Correlation ID for Debugging) ───────────────────────────────
// MUST be first middleware for all logs to include request ID
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── Timeout & Performance Monitoring ────────────────────────────────────────
/**
 * Route-Based Timeout Middleware Factory
 * Use for endpoints that need custom timeout durations
 * 
 * NOTE: This only stops HTTP response, NOT MongoDB queries or external APIs.
 * Those should use their own timeout mechanisms (maxTimeMS, AbortController).
 * 
 * @param {number} ms - Timeout in milliseconds
 * @returns {Function} Express middleware
 */
/**
 * Set request timeout for specific routes
 * Factory function that returns middleware
 * @param {number} ms - Timeout in milliseconds
 * @returns {Function} Express middleware
 */
export function setRequestTimeout(ms) {
  return (req, res, next) => {
    req.setTimeout(ms, () => {
      if (!res.headersSent) {
        console.error(`[TIMEOUT] ${req.method} ${req.originalUrl} exceeded ${ms}ms (Request ID: ${req.id})`);
        
        // Capture in Sentry for monitoring
        if (process.env.SENTRY_DSN) {
          Sentry.withScope((scope) => {
            scope.setTag('request_id', req.id);
            scope.setTag('timeout_ms', ms);
            scope.setTag('route', req.originalUrl);
            Sentry.captureMessage('Request timeout', { level: 'error' });
          });
        }
        
        res.status(504).json({ 
          success: false,
          error: 'Request timeout',
          message: `Request exceeded ${ms}ms time limit`,
          requestId: req.id
        });
      }
    });
    next();
  };
}

// ── Performance Metrics (Sliding Window + Percentiles) ──────────────────────
/**
 * Production-Grade Performance Metrics
 * 
 * Features:
 * - Sliding window (doesn't reset on request)
 * - P50, P95, P99 percentile tracking
 * - Auto-alert thresholds
 * - Top N slowest endpoints
 * - Rate limiting recommendations
 */
class PerformanceMetrics {
  constructor() {
    // Sliding window: last 10 minutes
    this.windowMs = 10 * 60 * 1000;
    
    // All request durations (for percentile calculation)
    this.durations = [];
    
    // Per-endpoint metrics
    this.endpoints = {};
    
    // Alert thresholds
    this.alerts = {
      slowRequestRate: 0.05,    // Alert if > 5% requests are slow
      timeoutRate: 0.02,        // Alert if > 2% requests timeout
      p95Threshold: 3000,       // Alert if P95 > 3s
      p99Threshold: 5000        // Alert if P99 > 5s
    };
    
    // Last alert times (prevent alert spam)
    this.lastAlertTime = {};
    this.alertCooldown = 5 * 60 * 1000; // 5 minutes between alerts
    
    // Start cleanup interval
    this._startCleanup();
  }
  
  // Record a request duration
  record(endpoint, duration, statusCode, method) {
    const now = Date.now();
    
    // Add to global durations
    this.durations.push({ time: now, duration });
    
    // Add to endpoint-specific
    if (!this.endpoints[endpoint]) {
      this.endpoints[endpoint] = {
        count: 0,
        durations: [],
        errors: 0,
        timeouts: 0,
        methods: {}
      };
    }
    
    const ep = this.endpoints[endpoint];
    ep.count++;
    ep.durations.push({ time: now, duration });
    ep.methods[method] = (ep.methods[method] || 0) + 1;
    
    // Track errors (5xx status codes)
    if (statusCode >= 500) {
      ep.errors++;
    }
    
    // Track timeouts (504)
    if (statusCode === 504) {
      ep.timeouts++;
    }
    
    // Check alert thresholds
    this._checkAlerts();
  }
  
  // Calculate percentile
  _percentile(sortedDurations, percentile) {
    if (sortedDurations.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedDurations.length) - 1;
    return sortedDurations[Math.max(0, index)].duration;
  }
  
  // Get metrics for a time window
  getMetrics(windowMs = this.windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    // Filter to window
    const recentDurations = this.durations.filter(d => d.time >= cutoff);
    const sorted = recentDurations.sort((a, b) => a.duration - b.duration);
    
    // Global metrics
    const metrics = {
      total: recentDurations.length,
      window: `${Math.floor(windowMs / 60000)} minutes`,
      percentiles: {
        p50: this._percentile(sorted, 50),
        p95: this._percentile(sorted, 95),
        p99: this._percentile(sorted, 99),
        max: sorted.length > 0 ? sorted[sorted.length - 1].duration : 0
      },
      slowRequests: recentDurations.filter(d => d.duration > 1000).length,
      slowRequestRate: recentDurations.length > 0 
        ? (recentDurations.filter(d => d.duration > 1000).length / recentDurations.length * 100).toFixed(2)
        : '0.00'
    };
    
    // Per-endpoint metrics
    metrics.byEndpoint = {};
    for (const [endpoint, data] of Object.entries(this.endpoints)) {
      const epRecent = data.durations.filter(d => d.time >= cutoff);
      const epSorted = epRecent.sort((a, b) => a.duration - b.duration);
      
      if (epRecent.length > 0) {
        metrics.byEndpoint[endpoint] = {
          count: epRecent.length,
          percentiles: {
            p50: this._percentile(epSorted, 50),
            p95: this._percentile(epSorted, 95),
            p99: this._percentile(epSorted, 99)
          },
          errors: data.errors,
          timeouts: data.timeouts,
          errorRate: ((data.errors / data.count) * 100).toFixed(2),
          methods: data.methods
        };
      }
    }
    
    // Top 5 slowest endpoints (by P95)
    metrics.topSlowest = Object.entries(metrics.byEndpoint)
      .sort((a, b) => b[1].percentiles.p95 - a[1].percentiles.p95)
      .slice(0, 5)
      .map(([endpoint, data]) => ({
        endpoint,
        p95: data.percentiles.p95,
        count: data.count,
        recommendation: this._getRecommendation(endpoint, data)
      }));
    
    // Rate limiting recommendations
    metrics.rateLimitRecommendations = this._getRateLimitRecommendations(metrics.byEndpoint);
    
    return metrics;
  }
  
  // Get optimization recommendation for endpoint
  _getRecommendation(endpoint, data) {
    if (data.percentiles.p95 > 5000) {
      return 'CRITICAL: Consider async processing or caching';
    }
    if (data.percentiles.p95 > 3000) {
      return 'HIGH: Add database indexes or query optimization';
    }
    if (data.percentiles.p95 > 2000) {
      return 'MEDIUM: Review N+1 queries or add caching';
    }
    if (data.errorRate > 5) {
      return 'WARNING: High error rate, investigate failures';
    }
    return 'OK';
  }
  
  // Get rate limiting recommendations
  _getRateLimitRecommendations(endpoints) {
    const recommendations = [];
    
    for (const [endpoint, data] of Object.entries(endpoints)) {
      // Slow endpoints need stricter limits
      if (data.percentiles.p95 > 2000) {
        recommendations.push({
          endpoint,
          currentLimit: 'default',
          recommendedLimit: Math.max(10, Math.floor(60 / (data.percentiles.p95 / 1000))),
          reason: `P95 latency is ${data.percentiles.p95}ms`,
          windowMs: 60000
        });
      }
      
      // High error rate endpoints need circuit breaker
      if (data.errorRate > 10) {
        recommendations.push({
          endpoint,
          action: 'circuit_breaker',
          recommendedLimit: 5,
          reason: `Error rate is ${data.errorRate}%`,
          windowMs: 60000
        });
      }
    }
    
    return recommendations;
  }
  
  // Check alert thresholds
  _checkAlerts() {
    const now = Date.now();
    const metrics = this.getMetrics(5 * 60 * 1000); // Last 5 minutes
    
    if (metrics.total < 10) return; // Need minimum data
    
    // Check slow request rate
    const slowRate = parseFloat(metrics.slowRequestRate) / 100;
    if (slowRate > this.alerts.slowRequestRate) {
      this._triggerAlert('high_slow_request_rate', {
        rate: metrics.slowRequestRate,
        threshold: (this.alerts.slowRequestRate * 100) + '%',
        total: metrics.total
      });
    }
    
    // Check P95
    if (metrics.percentiles.p95 > this.alerts.p95Threshold) {
      this._triggerAlert('high_p95_latency', {
        p95: metrics.percentiles.p95,
        threshold: this.alerts.p95Threshold
      });
    }
    
    // Check P99
    if (metrics.percentiles.p99 > this.alerts.p99Threshold) {
      this._triggerAlert('high_p99_latency', {
        p99: metrics.percentiles.p99,
        threshold: this.alerts.p99Threshold
      });
    }
  }
  
  // Trigger alert (with cooldown)
  _triggerAlert(type, data) {
    const now = Date.now();
    
    // Check cooldown
    if (this.lastAlertTime[type] && 
        (now - this.lastAlertTime[type]) < this.alertCooldown) {
      return; // Still in cooldown
    }
    
    this.lastAlertTime[type] = now;
    
    // Log alert
    console.error(`[⚠️ METRIC ALERT] ${type}:`, data);
    
    // Send to Sentry
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setTag('alert_type', type);
        scope.setLevel('warning');
        scope.setContext('metrics', data);
        Sentry.captureMessage(`Performance Alert: ${type}`, { level: 'warning' });
      });
    }
  }
  
  // Cleanup old data (prevent memory leak)
  _startCleanup() {
    setInterval(() => {
      const cutoff = Date.now() - this.windowMs;
      
      // Clean global durations
      this.durations = this.durations.filter(d => d.time >= cutoff);
      
      // Clean endpoint durations
      for (const endpoint of Object.keys(this.endpoints)) {
        this.endpoints[endpoint].durations = 
          this.endpoints[endpoint].durations.filter(d => d.time >= cutoff);
      }
    }, 60000); // Cleanup every minute
  }
}

const performanceMetrics = new PerformanceMetrics();

// ── Request Logging & Performance Tracking ─────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    const endpoint = req.route?.path || req.originalUrl.split('?')[0];

    // Record in performance metrics (for percentiles & alerts)
    performanceMetrics.record(endpoint, duration, res.statusCode, req.method);

    // Log slow requests (over 1 second)
    if (duration > 1000) {
      // Warning: Slow request (> 1s)
      console.warn('[SLOW_REQUEST]', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        duration: `${duration}ms`,
        statusCode: res.statusCode,
        ip: req.ip
      });

      // Capture in Sentry for trending
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setTag('request_id', req.id);
          scope.setTag('route', req.originalUrl);
          scope.setTag('duration_ms', duration);
          scope.setContext('performance', {
            duration,
            endpoint,
            method: req.method
          });
          
          // Critical: Very slow request (> 5s)
          if (duration > 5000) {
            console.error('[CRITICAL_SLOW_REQUEST]', {
              requestId: req.id,
              path: req.originalUrl,
              duration: `${duration}ms`
            });
            Sentry.captureMessage('Critical slow request', { level: 'error' });
          } else {
            Sentry.captureMessage('Slow request', { level: 'warning' });
          }
        });
      }
    }

    // SECURITY: Never log sensitive data in production
    // Only log basic request info (no bodies, no tokens, no secrets)
    if (!isProd) {
      // Development: verbose logging for debugging
      console.log(`[${timestamp}] [${req.id}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    } else {
      // Production: minimal logging (no request bodies, no sensitive data)
      // Only log if there's an error or it's a slow request
      if (duration > 1000 || res.statusCode >= 400) {
        console.log(`[${timestamp}] [${req.id}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      }
    }
  });

  next();
});

// ── Global Request Timeout (30s default) ────────────────────────────────────
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    if (!res.headersSent) {
      console.error(`[TIMEOUT] ${req.method} ${req.originalUrl} exceeded 30000ms (global default) [Request ID: ${req.id}]`);
      
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setTag('request_id', req.id);
          scope.setTag('timeout_type', 'global_default');
          Sentry.captureMessage('Global request timeout', { level: 'error' });
        });
      }
      
      res.status(504).json({ 
        success: false,
        error: 'Gateway timeout',
        message: 'Request exceeded 30 second time limit',
        requestId: req.id
      });
    }
  });
  next();
});

// CORS preflight is handled below after corsOptions is defined

// CronService is instantiated here so server.js can import and control it.
// initializeCronJobs() is called by server.js AFTER the DB connects — not here.
const cronService = new CronService();

// Apply middleware before routes
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // NOTE: 'unsafe-inline' required by Razorpay checkout script injection.
      // Once Razorpay supports nonce/hash, remove 'unsafe-inline' here.
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",  // Required for Razorpay (temporary until nonce/hash support)
        "https://checkout.razorpay.com",
        // Third-party scripts (limit to trusted domains only)
        "https://cdn.logrocket.com",        // LogRocket session replay
        "https://*.sentry-cdn.com",          // Sentry error tracking
        "https://www.googletagmanager.com",  // Google Analytics/Tag Manager
        "https://www.google-analytics.com"   // Google Analytics
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: [
        "'self'",
        "https://api.razorpay.com",
        "https://lumberjack.razorpay.com",
        "https://*.logrocket.com",           // LogRocket
        "https://*.sentry.io",               // Sentry
        "https://www.google-analytics.com"   // Google Analytics
      ],
      frameSrc: ["'self'", "https://api.razorpay.com"],
      // Block Flash, Java, and other plugin content
      objectSrc: ["'none'"],
      // Prevent base-tag hijacking attacks
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
      // Report CSP violations to endpoint for monitoring
      // NOTE: report-uri is deprecated in favor of report-to, but has better browser support
      reportUri: "/api/v1/security/csp-report",
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept === 'text/event-stream' || req.path.includes('/stream')) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

app.use(cookieParser());

// Apply CSRF protection globally
// This will set the XSRF-TOKEN cookie and validate headers for state-changing requests
app.use(csrfProtection);

// ── CORS Configuration ──────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// CORS Security Configuration
// ──────────────────────────────────────────────────────────────────────────────

// Origin validation helper - prevents malicious origins in FRONTEND_URLS
const isValidOrigin = (url) => {
  // Must be https:// in production, http:// allowed in dev
  const pattern = isProd 
    ? /^https:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?$/
    : /^(https?|http):\/\/[a-zA-Z0-9.-]+(:[0-9]+)?$/;
  
  return pattern.test(url) && !url.includes('*') && !url.includes(' ');
};

// Subdomain validation - explicitly allow controlled subdomains
const isAllowedSubdomain = (origin) => {
  // Extract base domain from FRONTEND_URL if configured
  if (!process.env.FRONTEND_URL) return false;
  
  try {
    const baseUrl = new URL(process.env.FRONTEND_URL);
    const baseDomain = baseUrl.hostname;
    
    // Check if origin is a subdomain of the base domain
    // e.g., www.autobacs.com is subdomain of autobacs.com
    return origin.endsWith(`.${baseDomain}`);
  } catch {
    return false;
  }
};

// Centralized allowed origins list (validated in ALL environments)
// SECURITY: No dynamic origins in production - all must be explicitly whitelisted
// This prevents malicious frontends from calling your API
// NOTE: isProd is already defined at line 66

// Parse and validate FRONTEND_URLS with strict validation
const parsedFrontendUrls = process.env.FRONTEND_URLS
  ? process.env.FRONTEND_URLS.split(',')
      .map(u => u.trim())
      .filter(u => {
        const isValid = isValidOrigin(u);
        if (!isValid && u) {
          console.error(`[CORS SECURITY] Rejected invalid origin in FRONTEND_URLS: "${u}"`);
        }
        return isValid;
      })
  : [];

const allowedOrigins = [
  // Localhost origins for development ONLY
  ...(isProd ? [] : [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ]),
  // Production frontend URLs (must be set in environment variables)
  ...(process.env.FRONTEND_URL && isValidOrigin(process.env.FRONTEND_URL) 
    ? [process.env.FRONTEND_URL] 
    : []),
  // Additional frontend URLs (validated and sanitized)
  ...parsedFrontendUrls
].filter(Boolean);

// Log warning if no production origins configured
if (isProd && !process.env.FRONTEND_URL) {
  console.error('[SECURITY WARNING] FRONTEND_URL not set in production - CORS will block all origins');
}

// Log rejected origins from FRONTEND_URLS (security monitoring)
if (isProd && parsedFrontendUrls.length > 0) {
  console.log(`[CORS] Validated ${parsedFrontendUrls.length} origin(s) from FRONTEND_URLS`);
}

if (isProd) {
  console.log(`[CORS] Production mode - allowing ${allowedOrigins.length} origin(s):`, allowedOrigins);
} else {
  console.log(`[CORS] Development mode - allowing ${allowedOrigins.length} origin(s) including localhost`);
}

const corsOptions = {
  origin: function(origin, callback) {
    // Allow non-browser requests (Postman, curl, mobile apps)
    // NOTE: This does NOT bypass authentication - all endpoints still require auth where needed
    if (!origin) return callback(null, true);

    // Normalize origin (remove trailing slash)
    const normalizedOrigin = origin.replace(/\/$/, '');

    // Check against explicit whitelist
    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    // Check for allowed subdomains (controlled wildcard)
    if (isProd && isAllowedSubdomain(normalizedOrigin)) {
      console.log(`[CORS] Allowed subdomain: ${normalizedOrigin}`);
      return callback(null, true);
    }

    // Block unauthorized origins (even in development)
    // SECURITY: This goes to logging aggregation in production
    if (isProd) {
      // In production, use structured logging for security events
      console.error(`[CORS BLOCKED] Unauthorized origin: ${origin} | Path: ${req?.url || 'unknown'} | IP: ${req?.ip || 'unknown'}`);
      
      // TODO: Integrate with Sentry/Datadog for security alerting
      // Example: sentry.captureMessage(`CORS blocked: ${origin}`, { level: 'warning' });
    } else {
      console.warn('[CORS BLOCKED] Unauthorized origin:', origin);
    }
    
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-session-id', 'X-Session-Id', 'X-XSRF-TOKEN', 'X-CSRF-Token'],
  maxAge: process.env.NODE_ENV === 'production' ? 7200 : 0  // Cache preflight 2h in prod
};

// Handle ALL preflight OPTIONS requests immediately before any other middleware
app.options('*', cors(corsOptions));

app.use(cors(corsOptions));
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

// ── CRITICAL: Razorpay Webhook Route (MUST be before other parsers) ─────────
// Webhook requires raw body for signature verification (express.raw)
// This MUST be mounted BEFORE the global JSON parser above
import razorpayWebhook from './middleware/razorpayWebhook.js';
app.use('/api/v1/razorpay/webhook', express.raw({ type: 'application/json' }), razorpayWebhook);

// Sentry context middleware - adds user/request context to error tracking
// Must be AFTER body parsing but BEFORE routes
app.use(sentryContextMiddleware);

// Data Sanitization against NoSQL query injection
app.use(mongoSanitization);

// Data Sanitization against XSS and trimming
app.use(requestSanitization);

// Test route - MUST RESPOND QUICKLY - Enhanced for Railway
app.get("/", (req, res) => {
  try {
    const responseData = {
      success: true,
      message: "Autobacs India API is running",
      version: "1.0.3",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 8080,
      endpoints: {
        health: "/health",
        ready: "/ready",
        apiStatus: "/api/status",
        auth: "/auth",
        products: "/products",
        categories: "/categories",
        vehicles: "/vehicles",
        cart: "/cart",
        wishlist: "/wishlist",
        orders: "/orders",
        location: "/location",
        warehouses: "/warehouses",
        deliveryZones: "/delivery-zones",
        razorpay: "/razorpay",
        brands: "/brands",
        wordpress: "/wordpress",
        admin: {
          tokenIntrospection: "/admin/token",
          rateLimitDashboard: "/admin/rate-limits/dashboard",
          adaptiveThrottling: "/admin/adaptive-throttling",
          dashboard: "/dashboard"
        }
      }
    };
    res.status(200).json(responseData);
  } catch (error) {
    console.error('[ROOT] Error in root route:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Handle favicon requests to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Privacy Policy page (required for Google OAuth)
app.get('/privacy', (req, res) => {
  res.type('html').send(`
    <!DOCTYPE html>
    <html>
    <head><title>Privacy Policy - Autobacs India</title></head>
    <body>
      <h1>Privacy Policy</h1>
      <p>Last updated: April 2026</p>
      <p>Autobacs India respects your privacy and is committed to protecting your personal data.</p>
      <h2>Information We Collect</h2>
      <p>We collect information you provide directly, such as account information, payment details, and communication preferences.</p>
      <h2>How We Use Your Information</h2>
      <p>We use your information to process orders, improve our services, and communicate with you.</p>
      <h2>Data Security</h2>
      <p>We implement appropriate security measures to protect your personal information.</p>
      <h2>Contact Us</h2>
      <p>For privacy-related questions, contact us at info@autobacsindia.com</p>
    </body>
    </html>
  `);
});

// Terms of Service page (required for Google OAuth)
app.get('/terms', (req, res) => {
  res.type('html').send(`
    <!DOCTYPE html>
    <html>
    <head><title>Terms of Service - Autobacs India</title></head>
    <body>
      <h1>Terms of Service</h1>
      <p>Last updated: April 2026</p>
      <p>By accessing and using the Autobacs India website, you accept and agree to be bound by these terms.</p>
      <h2>Use of Website</h2>
      <p>You may use this website for lawful purposes only.</p>
      <h2>Orders and Payments</h2>
      <p>All orders are subject to availability and acceptance. Prices are subject to change without notice.</p>
      <h2>Limitation of Liability</h2>
      <p>Autobacs India shall not be liable for any indirect, incidental, or consequential damages.</p>
      <h2>Contact Us</h2>
      <p>For questions about these terms, contact us at info@autobacsindia.com</p>
    </body>
    </html>
  `);
});

// Health check endpoints - Enhanced for Railway
app.get('/health', healthCheckRateLimit, redisHealthCheck, (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: req.redisHealthy ? 'connected' : 'disconnected', // NEW!
    nodeVersion: process.version,
    platform: process.platform
  };
  
  // If Redis is down in production, mark as degraded (but don't return 503)
  // This prevents load balancer from killing the service entirely
  if (process.env.NODE_ENV === 'production' && !req.redisHealthy) {
    healthData.status = 'degraded';
    console.warn('[HealthCheck] System running in degraded mode (Redis unavailable)');
    // Return 200 with degraded status - allows monitoring but doesn't kill LB
    return res.status(200).json(healthData);
  }
  
  res.status(200).json(healthData);
});

app.get('/ready', healthCheckRateLimit, (req, res) => {
  const isReady = mongoose.connection.readyState === 1;
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not ready',
    database: isReady ? 'connected' : 'disconnected'
  });
});

// Performance metrics endpoint (admin only in production)
app.get('/api/v1/metrics/performance', metricsRateLimit, (req, res) => {
  const metrics = performanceMetrics.getMetrics();
  
  res.json({
    success: true,
    metrics,
    timestamp: new Date().toISOString()
  });
});

// API status endpoint
app.get('/api/v1/status', (req, res) => {
  res.status(200).json({
    status: 'operational',
    version: '1.0.0',
    apiVersion: 'v1',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Debug endpoint — development only (never expose in production)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1/debug', debugRoutes);
}

// ── Route mounting — /api/v1/* ──────────────────────────────────────────────
// Single domain-driven router aggregates all API routes with proper middleware.
// See routes/index.js for domain grouping and rate limit configuration.
//
// Architecture:
// - Auth Domain: /auth/*, /admin/token/*
// - Product Domain: /products/*, /categories/*, /brands/*, /vehicles/*
// - User Domain: /users/*, /profile/*, /cart/*, /wishlist/*, /reviews/*
// - Order Domain: /orders/*, /returns/*, /razorpay/*, /payment-methods/*
// - Admin Domain: /dashboard/*, /warehouses/*, /delivery-zones/*, /wordpress/*
// - Location Domain: /location/*
// - Contact Domain: /contact/*, /consultation/*
// - Monitoring Domain: /admin/rate-limits/*, /admin/redis, /admin/adaptive-throttling
//
// Adding v2 later: import apiRouterV2 and mount at /api/v2/*

// Apply global rate limiter as safety net (500 req/15min per IP)
app.use('/api/v1', globalApiRateLimit);

app.use('/api/v1', apiRouter);

// ── Error handling ──────────────────────────────────────────────────────────────
// Correct middleware order:
//   routes → Sentry (captures thrown errors) → notFound (converts unmatched to AppError 404)
//        → errorHandler (formats & sends all errors consistently)

// 1. Sentry must come first so it can capture errors before they are formatted
Sentry.setupExpressErrorHandler(app);

// 2. notFound converts any unmatched request into an AppError(404) and calls next(error)
app.use(notFound);

// 3. errorHandler formats every AppError (including 404s) into a consistent JSON response
app.use(errorHandler);

export { app, cronService, adaptiveThrottlingService, setCronService };
