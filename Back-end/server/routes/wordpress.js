import express from "express";
import axios from "axios";
import { asyncHandler } from "../middleware/errorMiddleware.js";

const router = express.Router();

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
// @access  Public
router.get("/categories", asyncHandler(async (req, res) => {
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
    console.error('Error fetching WordPress categories:', error.message);
    if (error.response) {
       console.error('Response status:', error.response.status);
       console.error('Response data:', error.response.data);
    }
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch categories from WordPress'
    });
  }
}));

// @route   GET /wordpress/products
// @desc    Get WordPress products (proxy endpoint)
// @access  Public
router.get("/products", asyncHandler(async (req, res) => {
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
    console.error('Error fetching WordPress products:', error.message);
    if (error.response) {
       console.error('Response status:', error.response.status);
       console.error('Response data:', error.response.data);
    }
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch products from WordPress'
    });
  }
}));

// @route   GET /wordpress/products/:id
// @desc    Get single WordPress product (proxy endpoint)
// @access  Public
router.get("/products/:id", asyncHandler(async (req, res) => {
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
    console.error('Error fetching WordPress product:', error.message);
    if (error.response) {
       console.error('Response status:', error.response.status);
       console.error('Response data:', error.response.data);
    }
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch product from WordPress'
    });
  }
}));

export default router;
