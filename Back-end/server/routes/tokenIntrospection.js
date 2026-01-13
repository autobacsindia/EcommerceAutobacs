import express from 'express';
import {
  introspect,
  batchIntrospect,
  getUserSessionsController,
  revokeTokenController,
  getTokenStats
} from '../controllers/tokenIntrospectionController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { rateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// Rate limiter for token introspection endpoints (60 req/min per admin)
const introspectionRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: 'Too many token introspection requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:introspection:${req.user?.id}`
});

// All routes require admin authentication
router.use(protect, admin);

// Token introspection endpoints
router.post('/introspect', introspectionRateLimit, introspect);
router.post('/introspect/batch', introspectionRateLimit, batchIntrospect);

// User session management
router.get('/sessions/:userId', introspectionRateLimit, getUserSessionsController);

// Token revocation
router.post('/revoke', introspectionRateLimit, revokeTokenController);

// Token statistics
router.get('/stats', introspectionRateLimit, getTokenStats);

export default router;
