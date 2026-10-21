import express from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import { concurrentUploadGuard, uploadPaymentRequestFiles, uploadPaymentProof } from '../middleware/uploadMiddleware.js';
import * as pr from '../services/paymentRequestService.js';
import { renderPaymentSlip } from '../services/paymentSlipService.js';

/**
 * Payment requests (/api/v1/payment-requests): supplier payments and team
 * expenses, approved by admin and paid by accounts. Staff and admins only; who
 * may do what is decided in services/paymentRequestService.js on every call.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
// Bank details, amounts and approvals: never cached by a browser or proxy.
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

/** Multipart sends structured fields as JSON text; accept either. */
const json = (v, fallback) => {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

const fileErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'A file is too large (8 MB maximum).'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? (err.field && err.field.includes(' ') ? err.field : 'Too many files: up to 5 bills, 1 payment QR, and 3 payment screenshots.')
        : err.message;
    return res.status(400).json({ success: false, message });
  }
  next(err);
};

// GET /payment-requests?status=open|submitted|…&team=&cursor=
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await pr.list(req.user, req.query)) });
}));

// POST /payment-requests/expenses — multipart: team?, category, amount, description, payee(JSON), bill, qr
router.post('/expenses', concurrentUploadGuard, uploadPaymentRequestFiles, fileErrors, asyncHandler(async (req, res) => {
  const request = await pr.createExpense(req.user, { ...req.body, payee: json(req.body.payee, {}) }, req.files || {}, req);
  res.status(201).json({ success: true, request });
}));

// POST /payment-requests/supplier — multipart: orderId, itemIds(JSON), amount, description, payee(JSON), bill, qr
router.post('/supplier', concurrentUploadGuard, uploadPaymentRequestFiles, fileErrors, asyncHandler(async (req, res) => {
  const request = await pr.createSupplierRequest(req.user, {
    ...req.body, payee: json(req.body.payee, {}), itemIds: json(req.body.itemIds, req.body.itemIds),
  }, req.files || {}, req);
  res.status(201).json({ success: true, request });
}));

// GET /payment-requests/order/:orderId — supplier requests for one order
router.get('/order/:orderId', asyncHandler(async (req, res) => {
  res.json({ success: true, requests: await pr.forOrder(req.user, req.params.orderId) });
}));

// GET /payment-requests/:id
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.get(req.user, req.params.id) });
}));

// GET /payment-requests/:id/slip — the request slip / payment receipt PDF
router.get('/:id/slip', asyncHandler(async (req, res) => {
  const r = await pr.loadForSlip(req.user, req.params.id);
  const buffer = await renderPaymentSlip(r);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${r.status === 'paid' ? 'Receipt' : 'Payment-request'}-${r.number}.pdf"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
}));

// GET /payment-requests/:id/files/:fileId — a bill, QR or payment screenshot
router.get('/:id/files/:fileId', asyncHandler(async (req, res) => {
  const { buffer, contentType, name } = await pr.getFile(req.user, req.params.id, req.params.fileId);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}));

router.post('/:id/approve', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.approve(req.user, req.params.id, req.body, req) });
}));
router.post('/:id/decline', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.decline(req.user, req.params.id, req.body, req) });
}));
router.post('/:id/hold', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.hold(req.user, req.params.id, req.body, req) });
}));
// POST /payment-requests/:id/pay — multipart: method, reference, note?, proof
router.post('/:id/pay', concurrentUploadGuard, uploadPaymentProof, fileErrors, asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.markPaid(req.user, req.params.id, req.body, req.files || [], req) });
}));
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.cancel(req.user, req.params.id, req.body, req) });
}));

export default router;
