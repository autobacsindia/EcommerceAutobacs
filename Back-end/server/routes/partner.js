/**
 * Autobacs Partner — the SUPPLIER-facing API, mounted at /api/v1/partner.
 * Contract + safety rules: docs/ADR-supplier-portal.md.
 *
 * Auth: `Authorization: Bearer <supplier token>` only (middleware/supplierAuth.js);
 * a cookie is never read here. CSRF: the global csrfProtection lets a Bearer
 * write through; the signed-out writes (signup/login/forgot/reset) need the
 * double-submit token like every other public write — the app does what the
 * Roavion app does (GET /api/v1/csrf-token, then send X-XSRF-TOKEN on writes).
 * Nothing about CSRF for cookie clients changes.
 *
 * Every response body is built by utils/supplierPortalView.js (allow-list).
 * Errors: `{ success: false, message, code, ...extra }`; auth failure is never 200.
 */
import express from 'express';
import multer from 'multer';
import asyncHandler from '../middleware/asyncHandler.js';
import { rateLimit } from '../middleware/rate-limit/index.js';
import { getClientIp } from '../middleware/rate-limit/clientIp.js';
import { protectSupplier, requireSupplierStatus } from '../middleware/supplierAuth.js';
import { attachmentSizeGuard } from '../middleware/uploadMiddleware.js';
import { MAX_ATTACHMENT_BYTES, mb } from '../config/attachments.js';
import { MAX_LISTING_IMAGES } from '../config/supplierPortal.js';
import { SUPPLIER_ACCOUNT_STATUS as S } from '../repositories/supplierAccountRepository.js';
import { PartnerError } from '../services/supplierPortal/errors.js';
import * as auth from '../services/supplierPortal/auth.js';
import * as profile from '../services/supplierPortal/profile.js';
import * as listings from '../services/supplierPortal/listings.js';

const router = express.Router();

// Never cache a supplier response anywhere (per-user data behind a Bearer token).
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

// ── rate limits (real client IP: cf-connecting-ip) ───────────────────────────
const ip = (req) => getClientIp(req) || 'unknown';
const emailOf = (req) => String(req.body?.email || '').trim().toLowerCase().slice(0, 160);
const MIN = 60 * 1000;
const limits = {
  general: rateLimit({ windowMs: MIN, max: 120, message: 'Too many requests. Please slow down.', keyGenerator: (req) => `partner:general:${ip(req)}` }),
  signup: rateLimit({ windowMs: 15 * MIN, max: 5, message: 'Too many sign-ups from this network. Try again later.', keyGenerator: (req) => `partner:signup:${ip(req)}` }),
  loginIp: rateLimit({ windowMs: 15 * MIN, max: 30, message: 'Too many sign-in attempts. Try again later.', keyGenerator: (req) => `partner:login:${ip(req)}` }),
  loginEmail: rateLimit({ windowMs: 15 * MIN, max: 10, message: 'Too many sign-in attempts. Try again later.', keyGenerator: (req) => `partner:login:${ip(req)}:${emailOf(req)}` }),
  verify: rateLimit({ windowMs: 15 * MIN, max: 10, message: 'Too many tries. Try again later.', keyGenerator: (req) => `partner:verify:${ip(req)}` }),
  resend: rateLimit({ windowMs: 15 * MIN, max: 5, message: 'Too many code requests. Try again later.', keyGenerator: (req) => `partner:resend:${ip(req)}` }),
  forgot: rateLimit({ windowMs: 15 * MIN, max: 5, message: 'Too many code requests. Try again later.', keyGenerator: (req) => `partner:forgot:${ip(req)}` }),
  reset: rateLimit({ windowMs: 15 * MIN, max: 10, message: 'Too many tries. Try again later.', keyGenerator: (req) => `partner:reset:${ip(req)}` }),
  upload: rateLimit({ windowMs: 15 * MIN, max: 60, message: 'Too many uploads. Try again later.', keyGenerator: (req) => `partner:upload:${ip(req)}` }),
};
router.use(limits.general);

// ── uploads: memory, size-capped, type decided later from the BYTES ──────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_LISTING_IMAGES, fields: 5 } });
const uploadErrors = (err, req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? `A file is too large (${mb(MAX_ATTACHMENT_BYTES)} maximum).`
    : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Send up to ${MAX_LISTING_IMAGES} photos, in the "photo" field (documents: one file in "file").`
      : 'Upload error.';
  return res.status(400).json({ success: false, code: 'BAD_FILE', message });
};

const ok = (res, body, status = 200) => res.status(status).json({ success: true, ...body });
const me = protectSupplier;
const approved = requireSupplierStatus(S.APPROVED);
// Suspended suppliers can still SEE their listings; only approved ones change them.
const canRead = requireSupplierStatus(S.APPROVED, S.SUSPENDED);
const sid = (req) => req.supplier._id;

// ── auth ─────────────────────────────────────────────────────────────────────
router.post('/auth/signup', limits.signup, asyncHandler(async (req, res) => ok(res, await auth.signup(req.body || {}), 201)));
router.post('/auth/login', limits.loginIp, limits.loginEmail, asyncHandler(async (req, res) => ok(res, await auth.login(req.body || {}))));
router.post('/auth/forgot', limits.forgot, asyncHandler(async (req, res) => ok(res, await auth.forgot(req.body || {}))));
router.post('/auth/reset', limits.reset, asyncHandler(async (req, res) => ok(res, await auth.reset(req.body || {}))));
router.post('/auth/verify-email', limits.verify, me, asyncHandler(async (req, res) => ok(res, await auth.verifyEmail(sid(req), req.body || {}))));
router.post('/auth/resend-code', limits.resend, me, asyncHandler(async (req, res) => ok(res, await auth.resendCode(sid(req)))));
router.post('/auth/logout-all', me, asyncHandler(async (req, res) => ok(res, await auth.logoutAll(sid(req)))));

// ── profile ──────────────────────────────────────────────────────────────────
router.get('/me', me, asyncHandler(async (req, res) => ok(res, { account: await profile.getMe(sid(req)) })));
router.patch('/me', me, asyncHandler(async (req, res) => ok(res, { account: await profile.updateMe(sid(req), req.body || {}) })));
router.post('/me/documents/:kind', limits.upload, me, attachmentSizeGuard, upload.single('file'), uploadErrors,
  asyncHandler(async (req, res) => ok(res, { account: await profile.uploadDocument(sid(req), req.params.kind, req.file) })));
router.post('/me/submit', me, asyncHandler(async (req, res) => ok(res, { account: await profile.submit(sid(req)) })));

// ── listings (approved suppliers; every query filtered by the owner) ─────────
router.get('/listings', me, canRead, asyncHandler(async (req, res) => ok(res, await listings.list(sid(req), {
  cursor: req.query.cursor, status: req.query.status, limit: req.query.limit,
}))));
router.get('/listings/:id', me, canRead, asyncHandler(async (req, res) => ok(res, { listing: await listings.get(sid(req), req.params.id) })));
router.post('/listings', me, approved, asyncHandler(async (req, res) => ok(res, { listing: await listings.create(req.supplier, req.body || {}) }, 201)));
router.patch('/listings/:id', me, approved, asyncHandler(async (req, res) => ok(res, { listing: await listings.update(sid(req), req.params.id, req.body || {}) })));
router.patch('/listings/:id/availability', me, approved, asyncHandler(async (req, res) => ok(res, { listing: await listings.setAvailability(sid(req), req.params.id, req.body || {}) })));
router.post('/listings/:id/submit', me, approved, asyncHandler(async (req, res) => ok(res, { listing: await listings.submit(sid(req), req.params.id) })));
router.post('/listings/:id/withdraw', me, approved, asyncHandler(async (req, res) => ok(res, { listing: await listings.withdraw(sid(req), req.params.id) })));
router.post('/listings/:id/photos', limits.upload, me, approved, attachmentSizeGuard, upload.array('photo', MAX_LISTING_IMAGES), uploadErrors,
  asyncHandler(async (req, res) => ok(res, { listing: await listings.addPhotos(sid(req), req.params.id, req.files) })));
router.delete('/listings/:id/photos/:photoId', me, approved, asyncHandler(async (req, res) => ok(res, { listing: await listings.removePhoto(sid(req), req.params.id, req.params.photoId) })));

// Unknown partner path → JSON 404 (not the site's HTML/notFound handler).
router.use((req, res) => res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Not found.' }));

// Our own errors → their status + code. Everything else → the global handler.
 
router.use((err, req, res, next) => {
  if (err instanceof PartnerError) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message, ...err.extra });
  }
  return next(err);
});

export default router;
