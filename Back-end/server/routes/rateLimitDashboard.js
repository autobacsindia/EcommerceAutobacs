import express from 'express';
import {
  getRealtimeStats,
  getRecentEvents,
  getHistoricalEvents,
  getEventCounts,
  getTopEndpoints,
  getUserImpact,
  getRetrySuccessRate,
  getTimeline,
  getHealthScore
} from '../controllers/rateLimitDashboardController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { rateLimit } from '../middleware/rateLimitMiddleware.js';
import rateLimitEventEmitter from '../services/rateLimitEventEmitter.js';

const router = express.Router();

// Rate limiter for dashboard endpoints
const dashboardRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  message: 'Too many dashboard requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:dashboard:${req.user?.id}`
});

// All routes require admin authentication
router.use(protect, admin);

// Real-time endpoints
router.get('/realtime', dashboardRateLimit, getRealtimeStats);
router.get('/events/recent', dashboardRateLimit, getRecentEvents);

// Server-Sent Events endpoint for real-time updates
router.get('/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  
  // Function to send stats
  const sendStats = () => {
    try {
      const stats = rateLimitEventEmitter.getRealtimeStats();
      res.write(`data: ${JSON.stringify({ type: 'stats', data: stats, timestamp: new Date().toISOString() })}\n\n`);
    } catch (error) {
      console.error('Error sending SSE stats:', error);
    }
  };
  
  // Function to send events
  const sendEvent = (eventData) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'event', data: eventData, timestamp: new Date().toISOString() })}\n\n`);
    } catch (error) {
      console.error('Error sending SSE event:', error);
    }
  };
  
  // Send stats every 5 seconds
  const statsInterval = setInterval(sendStats, 5000);
  
  // Listen for rate limit events
  const eventListener = (eventData) => {
    sendEvent(eventData);
  };
  rateLimitEventEmitter.on('rate_limit_event', eventListener);
  
  // Send initial stats
  sendStats();
  
  // Clean up on close
  req.on('close', () => {
    clearInterval(statsInterval);
    rateLimitEventEmitter.off('rate_limit_event', eventListener);
    res.end();
  });
});

// Historical data endpoints
router.get('/events/historical', dashboardRateLimit, getHistoricalEvents);

// Analytics endpoints
router.get('/analytics/event-counts', dashboardRateLimit, getEventCounts);
router.get('/analytics/top-endpoints', dashboardRateLimit, getTopEndpoints);
router.get('/analytics/user-impact', dashboardRateLimit, getUserImpact);
router.get('/analytics/retry-success-rate', dashboardRateLimit, getRetrySuccessRate);
router.get('/analytics/timeline', dashboardRateLimit, getTimeline);

// Health endpoint
router.get('/health', dashboardRateLimit, getHealthScore);

export default router;
