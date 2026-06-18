/**
 * Redis Monitoring Routes
 * 
 * Provides Redis statistics and health information for admin dashboard.
 * Protected by authentication, admin role check, rate limiting, and IP allowlist.
 */

import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import sessionStore from '../services/sessionStore.js';
import cacheService from '../services/cacheService.js';
import { rateLimit } from '../middleware/rateLimitMiddleware.js';
import auditLogRepository from '../repositories/auditLogRepository.js';

const router = express.Router();

// Apply strict rate limiting to all Redis admin endpoints (max 10 requests per minute)
const redisAdminRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many admin requests - rate limit exceeded. Try again in 1 minute.'
});

router.use(redisAdminRateLimit);

// IP Allowlist middleware (optional - only if ALLOWED_IPS is configured)
const ipAllowlist = (req, res, next) => {
  const allowedIPs = process.env.ALLOWED_ADMIN_IPS?.split(',').map(ip => ip.trim());
  
  if (allowedIPs && allowedIPs.length > 0) {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!allowedIPs.includes(clientIP)) {
      // Log the unauthorized access attempt
      auditLogRepository.logAction({
        adminId: req.user?._id,
        adminEmail: req.user?.email || 'unknown',
        action: 'SESSION_REVOKE_ADMIN_ATTEMPT',
        ipAddress: clientIP,
        userAgent: req.headers['user-agent'],
        success: false,
        errorMessage: `IP not in allowlist: ${clientIP}`,
      });
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'Your IP address is not authorized to access admin endpoints'
      });
    }
  }
  
  next();
};

// Apply IP allowlist to all routes
router.use(ipAllowlist);

// GET /api/v1/admin/redis/stats
// Rate limited + auth required + admin only
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
// Extra protection: Only allow revoking sessions for non-admin users (prevent privilege escalation)
router.post('/sessions/:userId/revoke-all', protect, admin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Prevent admins from revoking other admins' sessions (security)
    const User = (await import('../models/User.js')).default;
    const targetUser = await User.findById(userId);
    
    if (targetUser && targetUser.role === 'admin') {
      // Log the attempt
      await auditLogRepository.logAction({
        adminId: req.user._id,
        adminEmail: req.user.email,
        action: 'SESSION_REVOKE_ADMIN_ATTEMPT',
        targetUserId: userId,
        targetResourceType: 'User',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        success: false,
        errorMessage: 'Attempted to revoke admin sessions - blocked',
      });
      
      return res.status(403).json({
        error: 'Cannot revoke sessions of admin users',
        message: 'For security, admin session revocation requires manual intervention'
      });
    }
    
    if (!sessionStore.redis) {
      return res.status(503).json({ 
        error: 'Redis not available' 
      });
    }
    
    // Revoke all sessions for user
    await sessionStore.revokeAllSessions(userId);
    
    // Also increment session version in MongoDB (instant invalidation)
    if (targetUser) {
      targetUser.sessionVersion = (targetUser.sessionVersion || 0) + 1;
      await targetUser.save();
    }
    
    // AUDIT LOG
    await auditLogRepository.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'SESSION_REVOKE_ALL',
      targetUserId: userId,
      targetResourceType: 'User',
      details: { reason: 'Admin-initiated logout from all devices' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
    });
    
    res.json({
      success: true,
      message: `All sessions revoked for user ${userId}`,
    });
  } catch (err) {
    console.error('[RedisMonitor] Error revoking sessions:', err.message);
    
    // Log the failure
    await auditLogRepository.logAction({
      adminId: req.user?._id,
      adminEmail: req.user?.email || 'unknown',
      action: 'SESSION_REVOKE_ALL',
      targetUserId: req.params.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      errorMessage: err.message,
    });
    
    res.status(500).json({ 
      error: 'Failed to revoke sessions',
      message: err.message 
    });
  }
});

// POST /api/v1/admin/redis/cache/clear
// Extra protection: Require explicit confirmation header
router.post('/cache/clear', protect, admin, async (req, res) => {
  try {
    // Require explicit confirmation to prevent accidental cache wipe
    const confirmHeader = req.headers['x-confirm-cache-clear'];
    if (confirmHeader !== 'true') {
      return res.status(400).json({
        error: 'Cache clear requires confirmation',
        message: 'Add header: X-Confirm-Cache-Clear: true'
      });
    }
    
    if (!cacheService.clear) {
      return res.status(501).json({ 
        error: 'Cache clear not implemented' 
      });
    }
    
    // Clear all cache
    await cacheService.clear();
    
    // AUDIT LOG (persistent, not just console)
    await auditLogRepository.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'CACHE_CLEAR',
      targetResourceType: 'Cache',
      details: { confirmed: true, confirmationHeader: confirmHeader },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
    });
    
    console.warn(`[RedisMonitor] Cache cleared by admin user ${req.user._id}`);
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (err) {
    console.error('[RedisMonitor] Error clearing cache:', err.message);
    
    // Log the failure
    await auditLogRepository.logAction({
      adminId: req.user?._id,
      adminEmail: req.user?.email || 'unknown',
      action: 'CACHE_CLEAR',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      errorMessage: err.message,
    });
    
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

// GET /api/v1/admin/redis/metrics - NEW!
router.get('/metrics', protect, admin, async (req, res) => {
  try {
    // Get session store metrics
    const sessionMetrics = sessionStore.getMetrics();
    
    // Get cache service metrics if available
    const cacheMetrics = cacheService.getStats ? cacheService.getStats() : {};
    
    // Combine all metrics
    const metrics = {
      sessionStore: sessionMetrics,
      cache: cacheMetrics,
      timestamp: new Date().toISOString(),
    };
    
    res.json(metrics);
  } catch (err) {
    console.error('[RedisMonitor] Metrics error:', err.message);
    res.status(500).json({ 
      error: 'Failed to get metrics',
      message: err.message 
    });
  }
});

export default router;
