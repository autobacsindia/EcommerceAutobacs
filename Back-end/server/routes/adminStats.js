/**
 * Admin Stats Route
 * 
 * Provides basic statistics for the admin dashboard sidebar
 * Routes: GET /api/v1/admin/stats
 */

import express from 'express';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect, admin);

/**
 * @route   GET /api/v1/admin/stats
 * @desc    Get admin dashboard statistics
 * @access  Admin only
 */
router.get('/stats', async (req, res) => {
  try {
    // Fetch stats in parallel for performance
    const [
      totalOrders,
      pendingOrders,
      totalRevenue,
      totalProducts,
      totalUsers
    ] = await Promise.all([
      // Total orders
      Order.countDocuments(),
      
      // Pending orders (not delivered/cancelled)
      Order.countDocuments({ 
        orderStatus: { $in: ['pending', 'confirmed', 'processing', 'shipped'] }
      }),
      
      // Total revenue (delivered orders only)
      Order.aggregate([
        { $match: { orderStatus: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]).option({ maxTimeMS: 8000 }),
      
      // Total active products
      Product.countDocuments({ isActive: true }),
      
      // Total users
      User.countDocuments()
    ]);

    res.json({
      success: true,
      stats: {
        totalOrders,
        pendingOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        totalProducts,
        totalUsers
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin statistics',
      error: error.message
    });
  }
});

export default router;
