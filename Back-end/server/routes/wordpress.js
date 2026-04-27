import express from "express";
import axios from "axios";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import rateLimit from 'express-rate-limit';

const router = express.Router();

// SECURITY: Admin-only routes will have protect+admin applied individually
// Public proxy endpoints (categories, products) don't need auth

// Rate limiting for sync endpoints (prevent abuse)
const syncRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 sync requests per 15 min
  message: { 
    success: false, 
    message: 'Too many sync requests. Please try again later.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// WordPress API configuration from environment variables
const WORDPRESS_SITE_URL = process.env.WORDPRESS_SITE_URL || '';
const WORDPRESS_API_VERSION = process.env.WORDPRESS_API_VERSION || 'wc/v3';
const WORDPRESS_CONSUMER_KEY = process.env.WORDPRESS_API_KEY || '';
const WORDPRESS_CONSUMER_SECRET = process.env.WORDPRESS_API_SECRET || '';

// Create axios instance for WordPress API
const createWordPressClient = () => {
  if (!WORDPRESS_SITE_URL || !WORDPRESS_CONSUMER_KEY || !WORDPRESS_CONSUMER_SECRET) {
    console.warn('WordPress API not configured. Please check environment variables.');
    return null;
  }
  
  return axios.create({
    baseURL: `${WORDPRESS_SITE_URL}/wp-json`,
    auth: {
      username: WORDPRESS_CONSUMER_KEY,
      password: WORDPRESS_CONSUMER_SECRET
    },
    timeout: 60000 // Increased timeout for stability
  });
};

const wordpressClient = createWordPressClient();

// Helper for retrying requests
const fetchWithRetry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    
    // Don't retry client errors (4xx) except 429 or 408
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      if (error.response.status !== 429 && error.response.status !== 408) {
        throw error;
      }
    }
    
    console.warn(`WordPress API request failed. Retrying in ${delay}ms... (${retries} retries left). Error: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRetry(fn, retries - 1, delay * 2); // Exponential backoff
  }
};

// @route   GET /wordpress/categories
// @desc    Get WordPress product categories (proxy endpoint)
// @access  Public (read-only proxy)
router.get("/categories", syncRateLimit, asyncHandler(async (req, res) => {
  if (!wordpressClient) {
    return res.status(503).json({
      success: false,
      message: 'WordPress API not configured'
    });
  }
  
  try {
    const { per_page = 100, page = 1 } = req.query;
    
    const response = await fetchWithRetry(() => wordpressClient.get(
      `/${WORDPRESS_API_VERSION}/products/categories`,
      {
        params: {
          per_page: parseInt(per_page),
          page: parseInt(page)
        }
      }
    ));
    
    res.json({
      success: true,
      categories: response.data,
      total: response.headers['x-wp-total'] || response.data.length,
      totalPages: response.headers['x-wp-totalpages'] || 1
    });
  } catch (error) {
    console.error('[WordPress] Error fetching categories:', error.message);
    // SECURITY: Don't log response data (may contain sensitive info)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch categories from WordPress'
    });
  }
}));

// @route   GET /wordpress/products
// @desc    Get WordPress products (proxy endpoint)
// @access  Public (read-only proxy)
router.get("/products", syncRateLimit, asyncHandler(async (req, res) => {
  if (!wordpressClient) {
    return res.status(503).json({
      success: false,
      message: 'WordPress API not configured'
    });
  }
  
  try {
    const { 
      per_page = 20, 
      page = 1, 
      search = '', 
      category = '',
      orderby = 'date',
      order = 'desc'
    } = req.query;
    
    const params = {
      per_page: parseInt(per_page),
      page: parseInt(page),
      orderby,
      order
    };
    
    if (search) {
      params.search = search;
    }
    
    if (category) {
      params.category = category;
    }
    
    const response = await fetchWithRetry(() => wordpressClient.get(
      `/${WORDPRESS_API_VERSION}/products`,
      { params }
    ));
    
    res.json({
      success: true,
      products: response.data,
      total: parseInt(response.headers['x-wp-total'] || 0),
      totalPages: parseInt(response.headers['x-wp-totalpages'] || 1)
    });
  } catch (error) {
    console.error('[WordPress] Error fetching products:', error.message);
    // SECURITY: Don't log response data (may contain sensitive info)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch products from WordPress'
    });
  }
}));

// @route   GET /wordpress/products/:id
// @desc    Get single WordPress product (proxy endpoint)
// @access  Public (read-only proxy)
router.get("/products/:id", syncRateLimit, asyncHandler(async (req, res) => {
  if (!wordpressClient) {
    return res.status(503).json({
      success: false,
      message: 'WordPress API not configured'
    });
  }
  
  try {
    const { id } = req.params;
    
    const response = await fetchWithRetry(() => wordpressClient.get(
      `/${WORDPRESS_API_VERSION}/products/${id}`
    ));
    
    res.json({
      success: true,
      product: response.data
    });
  } catch (error) {
    console.error('[WordPress] Error fetching product:', error.message);
    // SECURITY: Don't log response data (may contain sensitive info)
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch product from WordPress'
    });
  }
}));

// @route   POST /wordpress/sync/products
// @desc    Manually trigger product sync (admin only)
// @access  Private/Admin
router.post("/sync/products", protect, admin, asyncHandler(async (req, res) => {
  try {
    const { triggerManualSync } = await import('../services/wordpressSyncService.js');
    
    const result = await triggerManualSync();
    
    res.json({
      success: true,
      message: 'Sync completed successfully',
      data: result
    });
  } catch (error) {
    console.error('[WordPress] Manual sync failed:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to sync products'
    });
  }
}));

export default router;
