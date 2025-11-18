import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import productRoutes from "./routes/products.js";
import cartRoutes from "./routes/cart.js";
import wishlistRoutes from "./routes/wishlist.js";
import categoryRoutes from "./routes/categories.js";
import vehicleRoutes from "./routes/vehicles.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import { apiRateLimit } from "./middleware/rateLimitMiddleware.js";

dotenv.config();
const app = express();

// Apply middleware before routes
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting to all routes
app.use(apiRateLimit);

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
      orders: "/orders"
    }
  });
});

// Mount routes after middleware
app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/categories", categoryRoutes);
app.use("/vehicles", vehicleRoutes);
app.use("/cart", cartRoutes);
app.use("/wishlist", wishlistRoutes);
app.use("/orders", orderRoutes);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✓ MongoDB connected successfully"))
.catch(err => {
  console.error("✗ MongoDB connection error:", err.message);
  process.exit(1);
});

// Error handling middleware (must be after routes)
app.use(notFound);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ API Documentation: http://localhost:${PORT}/`);
});