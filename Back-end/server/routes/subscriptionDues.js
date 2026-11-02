import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import {
  concurrentUploadGuard, attachmentSizeGuard, uploadSubscriptionInvoices, handleAttachmentError,
} from '../middleware/uploadMiddleware.js';
import * as subs from '../services/subscriptionDueService.js';

/**
 * Subscriptions & dues (/api/v1/subscription-dues): the tools and bills each team
 * pays for, checked by accounts. Staff and admins only; who may do what is
 * decided in services/subscriptionDueService.js on every call.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

/** Multipart sends structured fields as JSON text; accept either. */
const json = (v, fallback) => {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};
const body = (req) => ({
  ...req.body,
  ...(req.body.payment !== undefined ? { payment: json(req.body.payment, {}) } : {}),
  ...(req.body.removeFileIds !== undefined ? { removeFileIds: json(req.body.removeFileIds, []) } : {}),
});

// GET /subscription-dues?status=&due=week|overdue&team=&q=&cursor=
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await subs.list(req.user, req.query)) });
}));

// GET /subscription-dues/options — what the form offers this person
router.get('/options', asyncHandler(async (req, res) => {
  res.json({ success: true, options: subs.options(req.user) });
}));

// POST /subscription-dues — multipart: name, purpose, team?, kind, amount, currency, dueDate,
//   payment(JSON: method, cardLast4, autoDebit), billingUrl, notes, invoice (files)
router.post('/', concurrentUploadGuard, attachmentSizeGuard, uploadSubscriptionInvoices, handleAttachmentError, asyncHandler(async (req, res) => {
  const item = await subs.create(req.user, body(req), req.files || [], req);
  res.status(201).json({ success: true, item });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, item: await subs.getOne(req.user, req.params.id) });
}));

// GET /subscription-dues/:id/files/:fileId — an invoice
router.get('/:id/files/:fileId', asyncHandler(async (req, res) => {
  const { buffer, contentType, name } = await subs.getFile(req.user, req.params.id, req.params.fileId);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}));

// PUT /subscription-dues/:id — multipart: rev, the fields that changed, removeFileIds(JSON)?, invoice (new files)
router.put('/:id', concurrentUploadGuard, attachmentSizeGuard, uploadSubscriptionInvoices, handleAttachmentError, asyncHandler(async (req, res) => {
  res.json({ success: true, item: await subs.update(req.user, req.params.id, body(req), req.files || [], req) });
}));

// POST /subscription-dues/:id/archive { rev, reason? } — "delete": archives it; the record and its history stay
router.post('/:id/archive', asyncHandler(async (req, res) => {
  res.json({ success: true, item: await subs.archive(req.user, req.params.id, req.body || {}, req) });
}));

router.post('/:id/verify', asyncHandler(async (req, res) => {
  res.json({ success: true, item: await subs.verify(req.user, req.params.id, req.body, req) });
}));
router.post('/:id/reject', asyncHandler(async (req, res) => {
  res.json({ success: true, item: await subs.reject(req.user, req.params.id, req.body, req) });
}));

export default router;
