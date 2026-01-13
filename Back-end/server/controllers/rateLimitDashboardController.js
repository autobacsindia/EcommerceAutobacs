import RateLimitEvent from '../models/RateLimitEvent.js';
import rateLimitEventEmitter from '../services/rateLimitEventEmitter.js';

/**
 * @route   GET /admin/rate-limits/dashboard/realtime
 * @desc    Get real-time rate limit statistics (last 60 seconds)
 * @access  Admin only
 */
export const getRealtimeStats = async (req, res) => {
  try {
    const stats = rateLimitEventEmitter.getRealtimeStats();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (error) {
    console.error('Error getting realtime stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving real-time statistics',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/events/recent
 * @desc    Get recent rate limit events from in-memory store
 * @access  Admin only
 */
export const getRecentEvents = async (req, res) => {
  try {
    const { limit = 100, type } = req.query;
    
    let events;
    if (type) {
      events = rateLimitEventEmitter.getRecentEventsByType(type, parseInt(limit));
    } else {
      events = rateLimitEventEmitter.getRecentEvents(parseInt(limit));
    }
    
    res.json({
      success: true,
      count: events.length,
      events
    });
  } catch (error) {
    console.error('Error getting recent events:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving recent events',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/events/historical
 * @desc    Get historical rate limit events from database
 * @access  Admin only
 */
export const getHistoricalEvents = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      eventType,
      endpoint,
      userId,
      ipAddress,
      limit = 100,
      page = 1
    } = req.query;
    
    // Build query
    const query = {};
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }
    
    if (eventType) query.eventType = eventType;
    if (endpoint) query.endpoint = new RegExp(endpoint, 'i');
    if (userId) query.userId = userId;
    if (ipAddress) query.ipAddress = ipAddress;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [events, total] = await Promise.all([
      RateLimitEvent.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      RateLimitEvent.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      count: events.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      events
    });
  } catch (error) {
    console.error('Error getting historical events:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving historical events',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/analytics/event-counts
 * @desc    Get event counts by type for a date range
 * @access  Admin only
 */
export const getEventCounts = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const counts = await RateLimitEvent.getEventCountsByType(start, end);
    
    res.json({
      success: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      counts
    });
  } catch (error) {
    console.error('Error getting event counts:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving event counts',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/analytics/top-endpoints
 * @desc    Get most rate-limited endpoints
 * @access  Admin only
 */
export const getTopEndpoints = async (req, res) => {
  try {
    const { limit = 10, startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const endpoints = await RateLimitEvent.getTopRateLimitedEndpoints(parseInt(limit), start, end);
    
    res.json({
      success: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      endpoints
    });
  } catch (error) {
    console.error('Error getting top endpoints:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving top endpoints',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/analytics/user-impact
 * @desc    Get user impact metrics
 * @access  Admin only
 */
export const getUserImpact = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const userMetrics = await RateLimitEvent.getUserImpactMetrics(start, end);
    
    res.json({
      success: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      userMetrics
    });
  } catch (error) {
    console.error('Error getting user impact:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving user impact metrics',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/analytics/retry-success-rate
 * @desc    Get retry success rate metrics
 * @access  Admin only
 */
export const getRetrySuccessRate = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const retryStats = await RateLimitEvent.getRetrySuccessRate(start, end);
    
    res.json({
      success: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      retryStats
    });
  } catch (error) {
    console.error('Error getting retry success rate:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving retry success rate',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/analytics/timeline
 * @desc    Get rate limit events timeline (aggregated by hour/day)
 * @access  Admin only
 */
export const getTimeline = async (req, res) => {
  try {
    const { startDate, endDate, granularity = 'hour' } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    // Determine grouping format based on granularity
    let dateFormat;
    switch (granularity) {
      case 'minute':
        dateFormat = { $dateToString: { format: '%Y-%m-%d %H:%M', date: '$timestamp' } };
        break;
      case 'day':
        dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } };
        break;
      case 'hour':
      default:
        dateFormat = { $dateToString: { format: '%Y-%m-%d %H:00', date: '$timestamp' } };
    }
    
    const timeline = await RateLimitEvent.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            date: dateFormat,
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          events: {
            $push: {
              type: '$_id.eventType',
              count: '$count'
            }
          },
          total: { $sum: '$count' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    res.json({
      success: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      granularity,
      timeline
    });
  } catch (error) {
    console.error('Error getting timeline:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving timeline data',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/rate-limits/dashboard/health
 * @desc    Get overall rate limiting health score
 * @access  Admin only
 */
export const getHealthScore = async (req, res) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Get metrics for last hour
    const [totalEvents, blockEvents, retryStats] = await Promise.all([
      RateLimitEvent.countDocuments({ timestamp: { $gte: oneHourAgo } }),
      RateLimitEvent.countDocuments({ eventType: 'block', timestamp: { $gte: oneHourAgo } }),
      RateLimitEvent.getRetrySuccessRate(oneHourAgo, now)
    ]);
    
    // Calculate health score (0-100)
    const blockRate = totalEvents > 0 ? (blockEvents / totalEvents) * 100 : 0;
    const retrySuccessRate = retryStats.successRate || 0;
    
    // Health score calculation:
    // - Block rate < 5%: Good (90-100 points)
    // - Block rate 5-15%: Warning (70-89 points)
    // - Block rate > 15%: Critical (0-69 points)
    // - Retry success rate adds up to 10 bonus points
    
    let healthScore = 100;
    
    if (blockRate > 15) {
      healthScore = 40;
    } else if (blockRate > 5) {
      healthScore = 70 + (15 - blockRate) * 2;
    } else {
      healthScore = 90 + (5 - blockRate) * 2;
    }
    
    // Add retry success rate bonus (up to 10 points)
    healthScore += Math.min(10, retrySuccessRate / 10);
    healthScore = Math.min(100, Math.round(healthScore));
    
    let status = 'healthy';
    if (healthScore < 70) status = 'critical';
    else if (healthScore < 90) status = 'warning';
    
    res.json({
      success: true,
      healthScore,
      status,
      metrics: {
        totalEvents,
        blockEvents,
        blockRate: blockRate.toFixed(2) + '%',
        retrySuccessRate: retrySuccessRate.toFixed(2) + '%'
      },
      timestamp: now.toISOString()
    });
  } catch (error) {
    console.error('Error calculating health score:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating health score',
      error: error.message
    });
  }
};

export default {
  getRealtimeStats,
  getRecentEvents,
  getHistoricalEvents,
  getEventCounts,
  getTopEndpoints,
  getUserImpact,
  getRetrySuccessRate,
  getTimeline,
  getHealthScore
};
