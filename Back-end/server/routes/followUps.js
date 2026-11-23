import express from 'express';
import { query, param } from 'express-validator';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { STAFF_TEAM_VALUES } from '../config/staff.js';
import { myDelays, personDelays, teamDelays, PAGE_MAX } from '../services/myDelaysService.js';

/**
 * Follow-ups — "My delays" (/api/v1/staff/delays). Read-only, live state
 * (services/myDelaysService.js). Mounted in routes/index.js BEFORE the /staff
 * router, so it carries its own gate: per-user rate limit, a valid session
 * (401 otherwise) and an active staff member or admin (403 otherwise). Who may
 * see whose list is decided in the service: never a 200 for someone else's.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);

// Personal / per-user data: never cached by a browser or the edge under a shared key.
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pageRules = [
  query('cursor').optional().isString().isLength({ max: 600 }),
  query('limit').optional().isInt({ min: 1, max: PAGE_MAX }).toInt(),
  query('control').optional().isIn(['inside', 'outside']),
  query('from').optional().matches(DAY).withMessage('Use a YYYY-MM-DD date'),
  query('to').optional().matches(DAY).withMessage('Use a YYYY-MM-DD date'),
];

// @route  GET /staff/delays/me?control=&from=&to=&cursor=&limit= — the caller's own late / due today / pending
router.get('/me', pageRules, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await myDelays(req.user, req.query)) });
}));

// @route  GET /staff/delays/people/:id?… — one person's list (self, their team head, admin)
router.get('/people/:id', param('id').isMongoId(), pageRules, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await personDelays(req.user, req.params.id, req.query)) });
}));

// @route  GET /staff/delays?team=&person=&control=&from=&to=&cursor=&limit= — ranking (head: own team; admin: everyone)
router.get('/', [
  ...pageRules,
  query('team').optional().isIn(STAFF_TEAM_VALUES),
  query('person').optional().isMongoId(),
], validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await teamDelays(req.user, req.query)) });
}));

export default router;
