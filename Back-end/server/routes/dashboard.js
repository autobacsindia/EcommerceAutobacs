// Autobacs/Back-end/server/routes/dashboard.js
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import healthCalculatorService from '../services/healthCalculatorService.js';
import dashboardAnalyticsService from '../services/dashboardAnalyticsService.js';

const router = express.Router();

// Configuration from environment variables
const DASHBOARD_MAX_CONNECTIONS = parseInt(process.env.DASHBOARD_MAX_CONNECTIONS) || 50;
const DASHBOARD_HEALTH_INTERVAL = parseInt(process.env.DASHBOARD_HEALTH_INTERVAL) || 2000;
const DASHBOARD_ANALYTICS_INTERVAL = parseInt(process.env.DASHBOARD_ANALYTICS_INTERVAL) || 3000;
const DASHBOARD_HEARTBEAT_INTERVAL = parseInt(process.env.DASHBOARD_HEARTBEAT_INTERVAL) || 30000;

// Track active connections
let activeConnections = 0;

/**
 * SSE endpoint for real-time dashboard updates
 * Requires admin authentication
 */
router.get('/stream', protect, admin, async (req, res) => {
  // Check connection limit
  if (activeConnections >= DASHBOARD_MAX_CONNECTIONS) {
    return res.status(503).json({
      success: false,
      message: 'Maximum dashboard connections reached',
      retryAfter: 60
    });
  }

  activeConnections++;
  console.log(`Dashboard SSE connection established. Active connections: ${activeConnections}`);

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  // Send initial connection confirmation
  const connectionMessage = {
    type: 'connected',
    timestamp: Date.now(),
    message: 'Dashboard stream connected',
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email
    }
  };
  res.write(`data: ${JSON.stringify(connectionMessage)}\n\n`);

  // Send health metrics periodically
  const healthInterval = setInterval(async () => {
    try {
      const healthData = await healthCalculatorService.getHealthMetrics();
      const message = {
        type: 'health',
        timestamp: Date.now(),
        data: healthData
      };
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (error) {
      console.error('Error sending health metrics:', error);
    }
  }, DASHBOARD_HEALTH_INTERVAL);

  // Send analytics data periodically
  const analyticsInterval = setInterval(async () => {
    try {
      const analyticsData = await dashboardAnalyticsService.getAnalytics();
      const message = {
        type: 'analytics',
        timestamp: Date.now(),
        data: analyticsData
      };
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (error) {
      console.error('Error sending analytics:', error);
    }
  }, DASHBOARD_ANALYTICS_INTERVAL);

  // Send alerts periodically
  const alertsInterval = setInterval(() => {
    try {
      const recentAlerts = healthCalculatorService.getRecentAlerts(5);
      if (recentAlerts.length > 0) {
        const message = {
          type: 'alerts',
          timestamp: Date.now(),
          data: recentAlerts
        };
        res.write(`data: ${JSON.stringify(message)}\n\n`);
      }
    } catch (error) {
      console.error('Error sending alerts:', error);
    }
  }, 5000);

  // Send heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      const message = {
        type: 'heartbeat',
        timestamp: Date.now()
      };
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (error) {
      console.error('Error sending heartbeat:', error);
    }
  }, DASHBOARD_HEARTBEAT_INTERVAL);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(healthInterval);
    clearInterval(analyticsInterval);
    clearInterval(alertsInterval);
    clearInterval(heartbeatInterval);
    activeConnections--;
    console.log(`Dashboard SSE connection closed. Active connections: ${activeConnections}`);
  });

  // Handle errors
  res.on('error', (error) => {
    console.error('SSE stream error:', error);
    clearInterval(healthInterval);
    clearInterval(analyticsInterval);
    clearInterval(alertsInterval);
    clearInterval(heartbeatInterval);
    activeConnections--;
  });
});

/**
 * Get current dashboard statistics (REST endpoint)
 */
router.get('/stats', protect, admin, async (req, res) => {
  try {
    const [health, analytics] = await Promise.all([
      healthCalculatorService.getHealthMetrics(),
      dashboardAnalyticsService.getAnalytics()
    ]);

    res.json({
      success: true,
      data: {
        health,
        analytics,
        alerts: healthCalculatorService.getRecentAlerts(10),
        activeConnections
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
});

/**
 * Get top performing products
 */
router.get('/top-products', protect, admin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const topProducts = await dashboardAnalyticsService.getTopProducts(limit);

    res.json({
      success: true,
      data: topProducts
    });
  } catch (error) {
    console.error('Error fetching top products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top products',
      error: error.message
    });
  }
});

/**
 * Clear analytics cache (for testing/debugging)
 */
router.post('/clear-cache', protect, admin, (req, res) => {
  try {
    dashboardAnalyticsService.clearCache();
    res.json({
      success: true,
      message: 'Analytics cache cleared'
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
      error: error.message
    });
  }
});

export default router;