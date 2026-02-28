import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import productRoutes from "./routes/products.js";
import scheduledTasksRoutes from "./routes/scheduledTasks.js";
import { setCronService } from "./routes/scheduledTasks.js";
import categoryRoutes from "./routes/categories.js";
import vehicleRoutes from "./routes/vehicles.js";
import cartRoutes from "./routes/cart.js";
import wishlistRoutes from "./routes/wishlist.js";
import userRoutes from "./routes/users.js";
import reviewRoutes from "./routes/reviews.js";
import profileRoutes from "./routes/profile.js";
import paymentMethodRoutes from "./routes/paymentMethods.js";
import locationRoutes from "./routes/location.js";
import warehouseRoutes from "./routes/warehouses.js";
import deliveryZoneRoutes from "./routes/deliveryZones.js";
import razorpayRoutes from "./routes/razorpay.js";
import brandRoutes from "./routes/brands.js";
import wordpressRoutes from "./routes/wordpress.js";
import productQuestionRoutes from "./routes/productQuestions.js";
import tokenIntrospectionRoutes from "./routes/tokenIntrospection.js";
import rateLimitDashboardRoutes from "./routes/rateLimitDashboard.js";
import adaptiveThrottlingRoutes from "./routes/adaptiveThrottling.js";
import dashboardRoutes from "./routes/dashboard.js";
import contactRoutes from "./routes/contact.js";
import returnRoutes from "./routes/returnRoutes.js";

// Import middleware
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import * as Sentry from "@sentry/node";
// Sanitization middleware
import { mongoSanitization, requestSanitization } from "./middleware/sanitizationMiddleware.js";
import cookieParser from "cookie-parser";
import csrfProtection from "./middleware/csrfMiddleware.js";
import { 
  apiRateLimit, 
  wishlistRateLimit, 
  frequentAccessRateLimit,
  publicBrowsingRateLimit,
  authenticatedUserRateLimit,
  checkoutRateLimit,
  adminRateLimit
} from "./middleware/rateLimitMiddleware.js";

// Import cron service
import CronService from "./services/cronService.js";

// Import adaptive throttling service
import adaptiveThrottlingService from "./services/adaptiveThrottlingService.js";

dotenv.config();
const app = express();

// Trust the first proxy (required for Cloudflare/Railway/Heroku)
// This ensures req.ip correctly identifies the client IP via X-Forwarded-For
app.set('trust proxy', 1);

// Initialize cron service
const cronService = new CronService();

// Apply middleware before routes
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://api.razorpay.com", "https://lumberjack.razorpay.com"],
      frameSrc: ["'self'", "https://api.razorpay.com"],
      upgradeInsecureRequests: [],
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

const frontendUrlsEnv = process.env.FRONTEND_URLS;
const frontendUrls = frontendUrlsEnv
  ? frontendUrlsEnv.split(',').map(u => u.trim()).filter(Boolean)
  : [];
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL,
  ...frontendUrls
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    console.log('[CORS] Incoming origin:', origin);
    if (allowedOrigins.indexOf(origin) === -1 && !process.env.Review_App) {
      // In development, we might want to be more lenient or log it
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      var msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-session-id', 'X-Session-Id', 'X-XSRF-TOKEN', 'X-CSRF-Token']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Data Sanitization against NoSQL query injection
// app.use(mongoSanitization);

// Data Sanitization against XSS and trimming
app.use(requestSanitization);

// Test route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Autobacs India API is running",
    version: "1.0.0",
    endpoints: {
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
  });
});

// Handle favicon requests to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/ready', (req, res) => {
  const isReady = mongoose.connection.readyState === 1;
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not ready',
    database: isReady ? 'connected' : 'disconnected'
  });
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.status(200).json({
    status: 'operational',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Mount routes with specific e-commerce rate limiting strategy
// Auth routes already have their own stricter rate limiting (5 req/min)
app.use(["/auth", "/api/auth"], authRoutes);

// Public browsing endpoints (300 req/min, burst 100) - catalog, products, categories
app.use(["/products", "/api/products"], publicBrowsingRateLimit, productRoutes);
app.use(["/categories", "/api/categories"], publicBrowsingRateLimit, categoryRoutes);
app.use(["/vehicles", "/api/vehicles"], publicBrowsingRateLimit, vehicleRoutes);
app.use(["/brands", "/api/brands"], publicBrowsingRateLimit, brandRoutes);
app.use(["/product-questions", "/api/product-questions"], publicBrowsingRateLimit, productQuestionRoutes);

// Authenticated user endpoints (600 req/min, burst 200) - cart, profile, wishlist
app.use(["/cart", "/api/cart"], authenticatedUserRateLimit, cartRoutes);
app.use(["/wishlist", "/api/wishlist"], authenticatedUserRateLimit, wishlistRoutes);
app.use(["/profile", "/api/profile"], authenticatedUserRateLimit, profileRoutes);
app.use(["/users", "/api/users"], authenticatedUserRateLimit, userRoutes);
app.use(["/reviews", "/api/reviews"], authenticatedUserRateLimit, reviewRoutes);

// Checkout/Payment endpoints (60 req/min, burst 20) - prevent duplicate orders
app.use(["/orders", "/api/orders"], checkoutRateLimit, orderRoutes);
app.use(["/returns", "/api/returns"], returnRoutes);
app.use(["/razorpay", "/api/razorpay"], checkoutRateLimit, razorpayRoutes);
app.use(["/payment-methods", "/api/payment-methods"], checkoutRateLimit, paymentMethodRoutes);

// Admin/Management endpoints (120 req/min) - warehouses, delivery zones, scheduled tasks
app.use(["/scheduled-tasks", "/api/scheduled-tasks"], adminRateLimit, scheduledTasksRoutes);
app.use(["/warehouses", "/api/warehouses"], adminRateLimit, warehouseRoutes);
app.use(["/delivery-zones", "/api/delivery-zones"], adminRateLimit, deliveryZoneRoutes);
app.use(["/wordpress", "/api/wordpress"], adminRateLimit, wordpressRoutes);

// Admin-only token introspection endpoints (separate rate limiting inside routes)
app.use("/admin/token", tokenIntrospectionRoutes);

// Admin-only rate limit dashboard endpoints
app.use("/admin/rate-limits/dashboard", rateLimitDashboardRoutes);

// Admin-only adaptive throttling endpoints
app.use("/admin/adaptive-throttling", adaptiveThrottlingRoutes);

// Dashboard endpoints (requires admin authentication)
app.use("/dashboard", adminRateLimit, dashboardRoutes);

// Location service (general rate limiting)
app.use(["/location", "/api/location"], apiRateLimit, locationRoutes);
app.use(["/contact", "/api/contact"], apiRateLimit, contactRoutes);

// Sentry Error Handler (must be before any other error middleware)
Sentry.setupExpressErrorHandler(app);

// Error handling middleware (must be after routes)
app.use(notFound);
app.use(errorHandler);

export { app, cronService, adaptiveThrottlingService, setCronService };
