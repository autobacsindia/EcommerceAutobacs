import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
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

// Import database configuration
import { connectWithRetry, preFlightIPCheck } from "./config/db.js";

// Import middleware
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import { apiRateLimit, wishlistRateLimit } from "./middleware/rateLimitMiddleware.js";

// Import cron service
import CronService from "./services/cronService.js";

// Import Elasticsearch service for connection check
import elasticsearchService from "./services/elasticsearchService.js";

dotenv.config();
const app = express();

// Initialize cron service
const cronService = new CronService();

// Apply middleware before routes
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      deliveryZones: "/delivery-zones"
    }
  });
});

// Handle favicon requests to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Mount routes with specific middleware
// Auth routes already have their own stricter rate limiting
app.use("/auth", authRoutes);
// Apply general rate limiting to other routes
app.use("/products", apiRateLimit, productRoutes);
app.use("/categories", apiRateLimit, categoryRoutes);
app.use("/vehicles", apiRateLimit, vehicleRoutes);
app.use("/cart", apiRateLimit, cartRoutes);
app.use("/wishlist", wishlistRateLimit, wishlistRoutes);
app.use("/orders", apiRateLimit, orderRoutes);
app.use("/scheduled-tasks", apiRateLimit, scheduledTasksRoutes);
app.use("/users", apiRateLimit, userRoutes);
app.use("/reviews", apiRateLimit, reviewRoutes);
app.use("/profile", apiRateLimit, profileRoutes);
app.use("/payment-methods", apiRateLimit, paymentMethodRoutes);
app.use("/location", apiRateLimit, locationRoutes);
app.use("/warehouses", apiRateLimit, warehouseRoutes);
app.use("/delivery-zones", apiRateLimit, deliveryZoneRoutes);

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
    const PORT = process.env.PORT || 5000;  // Default to 5000 to match frontend expectations
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