/**
 * Redis Monitoring Routes
 * 
 * Provides Redis statistics and health information for admin dashboard.
 * Protected by authentication and admin role check.
 */

import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import sessionStore from '../services/sessionStore.js';
import cacheService from '../services/cacheService.js';

const router = express.Router();

// GET /api/v1/admin/redis/stats
router.get('/stats', protect, admin, async (req, res) => {
  try {
    if (!sessionStore.redis) {
      return res.status(503).json({ 
        connected: false,
        error: 'Redis not available' 
      });
    }
    
    // Get Redis stats from session store
    const sessionStats = await sessionStore.getStats();
    
    // Get cache service stats
    const cacheStats = cacheService.getStats ? cacheService.getStats() : {};
    
    // Combine stats
    const stats = {
      ...sessionStats,
      cache: cacheStats,
      timestamp: new Date().toISOString(),
    };
    
    res.json(stats);
  } catch (err) {
    console.error('[RedisMonitor] Error:', err.message);
    res.status(500).json({ 
      error: 'Failed to get Redis stats',
      message: err.message 
    });
  }
});

// GET /api/v1/admin/redis/sessions/:userId
router.get('/sessions/:userId', protect, admin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!sessionStore.redis) {
      return res.status(503).json({ 
        error: 'Redis not available' 
      });
    }
    
    // Get all sessions for user
    const sessions = await sessionStore.getUserSessions(userId);
    const count = await sessionStore.getSessionCount(userId);
    
    res.json({
      userId,
      sessionCount: count,
      sessions: sessions.map(session => ({
        sessionId: session.sessionId.substring(0, 16) + '...', // Truncate for security
        ipAddress: session.ipAddress,
        deviceInfo: session.deviceInfo,
        createdAt: session.createdAt,
        lastAccessedAt: session.lastAccessedAt,
      }))
    });
  } catch (err) {
    console.error('[RedisMonitor] Error getting user sessions:', err.message);
    res.status(500).json({ 
      error: 'Failed to get user sessions',
      message: err.message 
    });
  }
});

// POST /api/v1/admin/redis/sessions/:userId/revoke-all
router.post('/sessions/:userId/revoke-all', protect, admin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!sessionStore.redis) {
      return res.status(503).json({ 
        error: 'Redis not available' 
      });
    }
    
    // Revoke all sessions for user
    await sessionStore.revokeAllSessions(userId);
    
    res.json({
      success: true,
      message: `All sessions revoked for user ${userId}`,
    });
  } catch (err) {
    console.error('[RedisMonitor] Error revoking sessions:', err.message);
    res.status(500).json({ 
      error: 'Failed to revoke sessions',
      message: err.message 
    });
  }
});

// POST /api/v1/admin/redis/cache/clear
router.post('/cache/clear', protect, admin, async (req, res) => {
  try {
    if (!cacheService.clear) {
      return res.status(501).json({ 
        error: 'Cache clear not implemented' 
      });
    }
    
    // Clear all cache
    await cacheService.clear();
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (err) {
    console.error('[RedisMonitor] Error clearing cache:', err.message);
    res.status(500).json({ 
      error: 'Failed to clear cache',
      message: err.message 
    });
  }
});

// GET /api/v1/admin/redis/health
router.get('/health', protect, admin, async (req, res) => {
  try {
    const isHealthy = await sessionStore.isHealthy();
    
    res.json({
      healthy: isHealthy,
      timestamp: new Date().toISOString(),
      redis: sessionStore.redis ? 'initialized' : 'not initialized',
    });
  } catch (err) {
    console.error('[RedisMonitor] Health check error:', err.message);
    res.status(500).json({ 
      healthy: false,
      error: err.message 
    });
  }
});

export default router;
