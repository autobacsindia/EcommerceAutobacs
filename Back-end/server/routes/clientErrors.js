/**
 * Customer-facing website errors.
 *
 *   POST  /client-errors              public: the storefront reports one error (always 204)
 *   GET   /client-errors              staff: the grouped list (cursor-paginated)
 *   GET   /client-errors/:id          staff: one error with its recent samples
 *   PATCH /client-errors/:id/status   admin + developer team: resolve / reopen
 *
 * Who reads what is clientErrorAccess() in services/clientErrorService.js: admin and
 * the developer (DevOps) team see everything and resolve; marketing sees payment,
 * checkout and careers, read only.
 *
 * The POST is CSRF-exempt (middleware/csrfMiddleware.js): it changes no account and
 * reads the session only to drop staff and attach the customer's id. It answers 204
 * whatever happens, so a probe cannot learn what is stored or why something was not.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, optionalAuth } from '../middleware/authMiddleware.js';
import { clientErrorReportRateLimit, adminRouteRateLimit } from '../middleware/rateLimitMiddleware.js';
import { cleanReport, isBot } from '../utils/clientErrorScrub.js';
import {
  clientErrorAccess,
  getClientError,
  listClientErrors,
  recordClientError,
  setClientErrorStatus,
} from '../services/clientErrorService.js';

const router = express.Router();

router.post('/', clientErrorReportRateLimit, optionalAuth, asyncHandler(async (req, res) => {
  // Answer first: the browser is done as soon as we have the body. The write happens
  // after, and recordClientError never throws.
  res.status(204).end();

  const userAgent = req.get('user-agent') || '';
  if (isBot(userAgent)) return;
  // Customers only: staff and admins testing or working are not customer errors.
  if (req.user && req.user.role !== 'customer') return;

  const cleaned = cleanReport(req.body, { userAgent });
  if (!cleaned.ok) return;
  await recordClientError(cleaned.report, { userId: req.user?._id || null });
}));

// ── Staff reads ───────────────────────────────────────────────────────────────

const withAccess = (req, res, next) => {
  const access = clientErrorAccess(req.user);
  if (!access) return res.status(403).json({ success: false, message: 'Not authorized' });
  req.clientErrorAccess = access;
  next();
};

router.get('/', protect, adminRouteRateLimit, withAccess, asyncHandler(async (req, res) => {
  const page = await listClientErrors(req.query, req.clientErrorAccess);
  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    ...page,
    features: req.clientErrorAccess.features,
    canResolve: req.clientErrorAccess.canResolve,
  });
}));

router.get('/:id', protect, adminRouteRateLimit, withAccess, asyncHandler(async (req, res) => {
  const error = await getClientError(req.params.id, req.clientErrorAccess);
  if (!error) return res.status(404).json({ success: false, message: 'Error not found' });
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, error, canResolve: req.clientErrorAccess.canResolve });
}));

router.patch('/:id/status', protect, adminRouteRateLimit, withAccess, asyncHandler(async (req, res) => {
  if (!req.clientErrorAccess.canResolve) {
    return res.status(403).json({ success: false, message: 'Only admins and the developer team can change this' });
  }
  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  const note = typeof req.body?.note === 'string' ? req.body.note : '';
  if (!['open', 'resolved'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be open or resolved' });
  }
  const updated = await setClientErrorStatus(req.params.id, { status, note }, req.user);
  if (!updated) return res.status(404).json({ success: false, message: 'Error not found' });
  res.json({ success: true, error: updated });
}));

export default router;
