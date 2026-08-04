/**
 * Admin Stats Route
 *
 * Powers the counters in the admin header (AdminLayoutClient).
 * Routes: GET /api/v1/admin/stats
 *
 * History: these counters read 0 forever because the queries matched
 * `orderStatus`, a field that does not exist on the Order model (it is `status`),
 * and on legacy enum values (`pending`/`confirmed`) that were migrated out in
 * scripts/migrate-order-status-phase2.js. A no-match filter returns 0 rather than
 * erroring, so the bug was invisible. Status groupings now come from the shared
 * utils/orderStatusGroups.js so this can't drift from the analytics screens again.
 */

import express from 'express';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { SALE_STATUSES, PENDING_FULFILLMENT_STATUSES } from '../utils/orderStatusGroups.js';
import { QUERY_TIMEOUTS } from '../config/db.js';
import cacheService from '../services/cacheService.js';

const router = express.Router();

// Every open admin tab polls this every 30s. The numbers are a glanceable
// summary, not an audit trail, so a short shared cache keeps a room full of
// admins from turning it into a steady stream of collection scans.
const STATS_TTL_SECONDS = 30;

// Apply auth middleware to all routes
router.use(protect, admin);

async function computeStats() {
  const [
    totalOrders,
    pendingOrders,
    revenueRows,
    totalProducts,
    totalUsers,
  ] = await Promise.all([
    // Real orders only — abandoned checkouts (awaiting_payment) are CRM leads, not orders.
    Order.countDocuments({ status: { $in: SALE_STATUSES } }).maxTimeMS(QUERY_TIMEOUTS.listing),

    // Open orders: paid/placed but not delivered yet — the admin's work queue.
    Order.countDocuments({ status: { $in: PENDING_FULFILLMENT_STATUSES } })
      .maxTimeMS(QUERY_TIMEOUTS.listing),

    // Realised revenue (rupees — Order.totalAmount is rupees, not paise).
    Order.aggregate([
      { $match: { status: { $in: SALE_STATUSES } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation }),

    Product.countDocuments({ isActive: true }).maxTimeMS(QUERY_TIMEOUTS.listing),

    User.countDocuments().maxTimeMS(QUERY_TIMEOUTS.listing),
  ]);

  return {
    totalOrders,
    pendingOrders,
    // Round to paise so float summation can't surface 1234.5600000000002.
    totalRevenue: Math.round((revenueRows[0]?.total || 0) * 100) / 100,
    totalProducts,
    totalUsers,
    // The statuses behind each number, so the UI can deep-link the tiles to the
    // matching Orders view instead of hardcoding a second copy of the grouping.
    filters: {
      pendingOrders: [...PENDING_FULFILLMENT_STATUSES],
      totalRevenue: [...SALE_STATUSES],
    },
  };
}

/**
 * @route   GET /api/v1/admin/stats
 * @desc    Get admin dashboard statistics
 * @access  Admin only
 */
router.get('/stats', async (req, res) => {
  try {
    // get/set (rather than wrap) on purpose: cacheService swallows its own Redis
    // errors, so an outage degrades this to "uncached" instead of "broken", and a
    // failing DB query is never retried a second time under load.
    const key = cacheService.generateKey('admin:stats');
    let stats = await cacheService.get(key);

    if (!stats) {
      stats = await computeStats();
      await cacheService.set(key, stats, STATS_TTL_SECONDS, ['orders', 'products', 'users']);
    }

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin statistics',
      error: error.message,
    });
  }
});

export default router;
