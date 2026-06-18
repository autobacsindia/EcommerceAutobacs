import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Contact from '../models/Contact.js';
import { QUERY_TIMEOUTS } from '../config/db.js';

// Statuses that count as a realised sale (money made). Excludes pending, failed,
// cancelled and refunded. Shared by revenue and top-products so they stay consistent
// — important now that historical WooCommerce orders (ADR-005) include many cancelled/failed.
const SALE_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered'];

/**
 * Dashboard Analytics Service
 * Provides real-time business metrics and analytics
 */
class DashboardAnalyticsService {
  constructor() {
    this.lastAnalyticsData = null;
    this.lastCalculationTime = 0;
    this.CACHE_TTL = 10000; // 10 s — matches SSE analytics interval
  }

  /**
   * Get comprehensive analytics data
   * @returns {Promise<Object>} Analytics metrics
   */
  async getAnalytics() {
    // Return cached data if still valid
    const now = Date.now();
    if (this.lastAnalyticsData && (now - this.lastCalculationTime) < this.CACHE_TTL) {
      return this.lastAnalyticsData;
    }

    try {
      const [sales, orders, customers, system, messages] = await Promise.all([
        this.getSalesAnalytics(),
        this.getOrdersAnalytics(),
        this.getCustomerAnalytics(),
        this.getSystemPerformance(),
        this.getMessagesAnalytics()
      ]);

      const analyticsData = {
        timestamp: now,
        sales,
        orders,
        customers,
        system,
        messages
      };

      // Cache the result
      this.lastAnalyticsData = analyticsData;
      this.lastCalculationTime = now;

      return analyticsData;
    } catch (error) {
      console.error('Error getting analytics:', error);
      return this.getFallbackAnalytics();
    }
  }

  /**
   * Get sales analytics
   * @returns {Promise<Object>} Sales metrics
   */
  async getSalesAnalytics() {
    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Get today's revenue
      const todayRevenue = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfToday },
            status: { $in: SALE_STATUSES }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' },
            count: { $sum: 1 }
          }
        }
      ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });

      // Get week-to-date revenue
      const weekRevenue = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfWeek },
            status: { $in: SALE_STATUSES }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' },
            count: { $sum: 1 }
          }
        }
      ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });

      // Get month-to-date revenue
      const monthRevenue = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfMonth },
            status: { $in: SALE_STATUSES }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' },
            count: { $sum: 1 }
          }
        }
      ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });

      const todayData = todayRevenue[0] || { total: 0, count: 0 };
      const weekData = weekRevenue[0] || { total: 0, count: 0 };
      const monthData = monthRevenue[0] || { total: 0, count: 0 };

      // Calculate average order value
      const averageOrderValue = todayData.count > 0 
        ? Math.round(todayData.total / todayData.count * 100) / 100 
        : 0;

      // Calculate conversion rate (simplified - would need session tracking)
      const conversionRate = 2.5; // Placeholder

      return {
        revenueToday: Math.round(todayData.total * 100) / 100,
        revenueWeek: Math.round(weekData.total * 100) / 100,
        revenueMonth: Math.round(monthData.total * 100) / 100,
        ordersToday: todayData.count,
        ordersWeek: weekData.count,
        ordersMonth: monthData.count,
        averageOrderValue,
        conversionRate
      };
    } catch (error) {
      console.error('Error getting sales analytics:', error);
      return {
        revenueToday: 0,
        revenueWeek: 0,
        revenueMonth: 0,
        ordersToday: 0,
        ordersWeek: 0,
        ordersMonth: 0,
        averageOrderValue: 0,
        conversionRate: 0
      };
    }
  }

  /**
   * Get orders analytics
   * @returns {Promise<Object>} Orders metrics
   */
  async getOrdersAnalytics() {
    try {
      // Get order status breakdown
      const statusBreakdown = await Order.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });

      const breakdown = {};
      statusBreakdown.forEach(item => {
        breakdown[item._id] = item.count;
      });

      // Get pending orders count (orders older than 1 hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const pendingOldOrders = await Order.countDocuments({
        status: 'pending',
        createdAt: { $lt: oneHourAgo }
      });

      // Get recent order updates
      const recentOrders = await Order.find()
        .sort({ updatedAt: -1 })
        .limit(5)
        .select('_id orderNumber status totalAmount user createdAt')
        .populate('user', 'name email')
        .lean();

      return {
        statusBreakdown: {
          pending: breakdown.pending || 0,
          confirmed: breakdown.confirmed || 0,
          processing: breakdown.processing || 0,
          shipped: breakdown.shipped || 0,
          delivered: breakdown.delivered || 0,
          cancelled: breakdown.cancelled || 0,
          refunded: breakdown.refunded || 0
        },
        pendingOldOrders,
        recentOrders: recentOrders.map(order => ({
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          amount: Math.round(order.totalAmount * 100) / 100,
          customerName: order.user?.name || 'Unknown',
          createdAt: order.createdAt
        }))
      };
    } catch (error) {
      console.error('Error getting orders analytics:', error);
      return {
        statusBreakdown: {},
        pendingOldOrders: 0,
        recentOrders: []
      };
    }
  }

  /**
   * Get customer analytics
   * @returns {Promise<Object>} Customer metrics
   */
  async getCustomerAnalytics() {
    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // New registrations today
      const newUsersToday = await User.countDocuments({
        createdAt: { $gte: startOfToday }
      });

      // Active customers in last 24 hours (users who placed orders)
      const activeCustomers = await Order.distinct('user', {
        createdAt: { $gte: last24Hours }
      });

      // Total customers
      const totalCustomers = await User.countDocuments({
        role: { $ne: 'admin' }
      });

      return {
        newToday: newUsersToday,
        activeLast24h: activeCustomers.length,
        total: totalCustomers
      };
    } catch (error) {
      console.error('Error getting customer analytics:', error);
      return {
        newToday: 0,
        activeLast24h: 0,
        total: 0
      };
    }
  }

  /**
   * Get system performance metrics
   * @returns {Promise<Object>} System metrics
   */
  async getSystemPerformance() {
    try {
      // Get product inventory alerts
      const lowStockProducts = await Product.countDocuments({
        stock: { $lt: 10, $gt: 0 }
      });

      const outOfStockProducts = await Product.countDocuments({
        stock: 0
      });

      return {
        inventory: {
          lowStock: lowStockProducts,
          outOfStock: outOfStockProducts
        },
        apiRequests: 0, // Placeholder - would need request tracking
        errorRate: 0 // Placeholder - would need error tracking
      };
    } catch (error) {
      console.error('Error getting system performance:', error);
      return {
        inventory: {
          lowStock: 0,
          outOfStock: 0
        },
        apiRequests: 0,
        errorRate: 0
      };
    }
  }

  /**
   * Get messages analytics
   * @returns {Promise<Object>} Messages metrics
   */
  async getMessagesAnalytics() {
    try {
      const statusBreakdown = await Contact.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });

      const breakdown = {
        new: 0,
        read: 0,
        replied: 0,
        closed: 0
      };

      statusBreakdown.forEach(item => {
        if (Object.prototype.hasOwnProperty.call(breakdown, item._id)) {
          breakdown[item._id] = item.count;
        }
      });

      const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

      // Get recent messages
      const recentMessages = await Contact.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('_id name subject status createdAt')
        .lean();

      return {
        total,
        breakdown,
        recentMessages
      };
    } catch (error) {
      console.error('Error getting messages analytics:', error);
      return {
        total: 0,
        breakdown: { new: 0, read: 0, replied: 0, closed: 0 },
        recentMessages: []
      };
    }
  }

  /**
   * Get top performing products
   * @param {number} limit - Number of products to return
   * @returns {Promise<Array>} Top products
   */
  async getTopProducts(limit = 5) {
    try {
      const topProducts = await Order.aggregate([
        { $match: { status: { $in: SALE_STATUSES } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            totalOrders: { $sum: 1 },
            totalQuantity: { $sum: '$items.quantity' },
            totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
          }
        },
        { $sort: { totalOrders: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $project: {
            productId: '$_id',
            name: '$product.name',
            totalOrders: 1,
            totalQuantity: 1,
            totalRevenue: 1
          }
        }
      ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });

      return topProducts;
    } catch (error) {
      console.error('Error getting top products:', error);
      return [];
    }
  }

  /**
   * Get fallback analytics data
   * @returns {Object} Fallback analytics
   */
  getFallbackAnalytics() {
    return {
      timestamp: Date.now(),
      sales: {
        revenueToday: 0,
        revenueWeek: 0,
        revenueMonth: 0,
        ordersToday: 0,
        ordersWeek: 0,
        ordersMonth: 0,
        averageOrderValue: 0,
        conversionRate: 0
      },
      orders: {
        statusBreakdown: {},
        pendingOldOrders: 0,
        recentOrders: []
      },
      customers: {
        newToday: 0,
        activeLast24h: 0,
        total: 0
      },
      system: {
        inventory: {
          lowStock: 0,
          outOfStock: 0
        },
        apiRequests: 0,
        errorRate: 0
      },
      messages: {
        total: 0,
        breakdown: {
          new: 0,
          read: 0,
          replied: 0,
          closed: 0
        },
        recentMessages: []
      }
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.lastAnalyticsData = null;
    this.lastCalculationTime = 0;
  }
}

// Export singleton instance
export default new DashboardAnalyticsService();
