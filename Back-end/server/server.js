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

// Import database configuration
import { connectWithRetry, preFlightIPCheck } from "./config/db.js";

// Import middleware
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
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

// Import Elasticsearch service for connection check
import elasticsearchService from "./services/elasticsearchService.js";

// Import adaptive throttling service
import adaptiveThrottlingService from "./services/adaptiveThrottlingService.js";

dotenv.config();
const app = express();

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

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173', // Vite default
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Data Sanitization against NoSQL query injection
app.use(mongoSanitization);

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

    // Start server
    const PORT = process.env.PORT || 5001;  // Default to 5001 to avoid conflicts
    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ API Documentation: http://localhost:${PORT}/`);

      // Show database connection status
      if (dbConnection) {
        console.log('✓ Database connection established');
      } else {
        console.log('⚠ Database connection not available');
      }
    });
  } catch (error) {
    console.error('✗ Failed to initialize server:', error.message);
    process.exit(1);
  }
}

// Error handling middleware (must be after routes)
app.use(notFound);
app.use(errorHandler);

// Initialize server
initializeServer();
