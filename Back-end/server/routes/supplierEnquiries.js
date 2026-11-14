import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import { concurrentUploadGuard, attachmentSizeGuard, uploadProofPhotos, handleAttachmentError } from '../middleware/uploadMiddleware.js';
import * as enquiries from '../services/supplierEnquiryService.js';
import * as shipping from '../services/shippingEstimateService.js';

/**
 * Supplier price enquiries (/api/v1/supplier-enquiries) — procurement and the
 * admin only; the service decides (services/supplierEnquiryService.js).
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
// Per-user records: never cached by a browser or proxy.
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// GET /supplier-enquiries?status=open|sent|replied|closed&q=&after=
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await enquiries.list(req.user, req.query)) });
}));

// GET /supplier-enquiries/products?q=   catalogue search for an item line (before /:id)
// POST /supplier-enquiries/shipping-estimate   { pin, weightKg?, items?: [{ productId, qty }] }
// Delivery charge estimate from the delivery zones (read-only; never touches an order or checkout).
router.post('/shipping-estimate', asyncHandler(async (req, res) => {
  res.json({ success: true, estimate: await shipping.estimate(req.user, req.body || {}) });
}));

router.get('/products', asyncHandler(async (req, res) => {
  res.json({ success: true, products: await enquiries.searchProducts(req.user, String(req.query.q ?? '').slice(0, 100)) });
}));

// POST /supplier-enquiries { items, supplierIds, neededBy, deliverTo, notes, showTargetPrice, formKey }
router.post('/', asyncHandler(async (req, res) => {
  const { enquiry, created } = await enquiries.create(req.user, req.body || {}, req);
  res.status(created ? 201 : 200).json({ success: true, enquiry });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, enquiry: await enquiries.get(req.user, req.params.id) });
}));

// PUT /supplier-enquiries/:id { ...same as create, updatedAt }
router.put('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, enquiry: await enquiries.update(req.user, req.params.id, req.body || {}, req) });
}));

// POST /supplier-enquiries/:id/suppliers/:rowId/sent   the message was opened in WhatsApp
router.post('/:id/suppliers/:rowId/sent', asyncHandler(async (req, res) => {
  res.json({ success: true, enquiry: await enquiries.markSent(req.user, req.params.id, req.params.rowId) });
}));

// PUT /supplier-enquiries/:id/suppliers/:rowId/quote { quotes: [{ itemId, unitPrice, gstRate, gstIncluded, available, dispatchDays, note }], note }
router.put('/:id/suppliers/:rowId/quote', asyncHandler(async (req, res) => {
  res.json({ success: true, enquiry: await enquiries.recordQuote(req.user, req.params.id, req.params.rowId, req.body || {}, req) });
}));

// POST /supplier-enquiries/:id/close { note, chosenRowId }   /reopen
router.post('/:id/close', asyncHandler(async (req, res) => {
  res.json({ success: true, enquiry: await enquiries.close(req.user, req.params.id, req.body || {}, req) });
}));
router.post('/:id/reopen', asyncHandler(async (req, res) => {
  res.json({ success: true, enquiry: await enquiries.reopen(req.user, req.params.id, req) });
}));

// POST /supplier-enquiries/:id/items/:itemId/photos   multipart: photo (repeated, up to 3 per item)
router.post('/:id/items/:itemId/photos', concurrentUploadGuard, attachmentSizeGuard, uploadProofPhotos, handleAttachmentError, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, enquiry: await enquiries.addPhotos(req.user, req.params.id, req.params.itemId, req.files || [], req) });
}));
// DELETE /supplier-enquiries/:id/photos/:photoId
router.delete('/:id/photos/:photoId', asyncHandler(async (req, res) => {
  res.json({ success: true, enquiry: await enquiries.removePhoto(req.user, req.params.id, req.params.photoId, req) });
}));
// GET /supplier-enquiries/:id/photos/:photoId   the photo itself (private)
router.get('/:id/photos/:photoId', asyncHandler(async (req, res) => {
  const { buffer, contentType, name } = await enquiries.getPhoto(req.user, req.params.id, req.params.photoId);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}));

export default router;
