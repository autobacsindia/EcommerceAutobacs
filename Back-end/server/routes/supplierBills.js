import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import {
  concurrentUploadGuard, attachmentSizeGuard, uploadSupplierBillFiles, handleAttachmentError,
} from '../middleware/uploadMiddleware.js';
import * as bills from '../services/supplierBillService.js';

/**
 * "We owe suppliers" (/api/v1/supplier-bills): supplier bills we pay later.
 * Staff and admins only; who may do what is decided in
 * services/supplierBillService.js on every call. Paying a bill is NOT here — it
 * is an ordinary supplier payment request (POST /payment-requests/supplier with
 * `supplierBillId`), approved and paid like any other.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// GET /supplier-bills?show=owed|paid|cancelled&due=overdue|week&supplier=&cursor=
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await bills.list(req.user, req.query)) });
}));

// GET /supplier-bills/by-supplier — what we owe each supplier, most overdue first
router.get('/by-supplier', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await bills.bySupplier(req.user)) });
}));

// POST /supplier-bills — multipart: supplierId, billNumber, billDate?, dueDate, amount (₹),
//   description?, orderId?, clientId?, bill (files)
router.post('/', concurrentUploadGuard, attachmentSizeGuard, uploadSupplierBillFiles, handleAttachmentError, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, bill: await bills.create(req.user, req.body || {}, req.files || [], req) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, bill: await bills.getOne(req.user, req.params.id) });
}));

// GET /supplier-bills/:id/files/:fileId — the bill copy, streamed through us (never a public link)
router.get('/:id/files/:fileId', asyncHandler(async (req, res) => {
  const { buffer, contentType, name } = await bills.getFile(req.user, req.params.id, req.params.fileId);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}));

// PUT /supplier-bills/:id — multipart: rev, the fields that changed, bill (new files)
router.put('/:id', concurrentUploadGuard, attachmentSizeGuard, uploadSupplierBillFiles, handleAttachmentError, asyncHandler(async (req, res) => {
  res.json({ success: true, bill: await bills.update(req.user, req.params.id, req.body || {}, req.files || [], req) });
}));

// POST /supplier-bills/:id/cancel { reason } — only while nothing is asked for or paid on it
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  res.json({ success: true, bill: await bills.cancel(req.user, req.params.id, req.body || {}, req) });
}));

export default router;
