import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import {
  concurrentUploadGuard, attachmentSizeGuard, uploadPaymentRequestFiles, uploadPaymentProof, handleAttachmentError,
} from '../middleware/uploadMiddleware.js';
import * as pr from '../services/paymentRequestService.js';
import * as deals from '../services/supplierDealService.js';
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

// GET /payment-requests?status=&team=&kind=&category=&by=&method=&from=&to=&dateOf=&min=&max=&q=&sort=&cursor=
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await pr.list(req.user, req.query)) });
}));

// GET /payment-requests/filter-options — the list's "What for" and (admin / accounts) "Raised by" choices
router.get('/filter-options', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await pr.listFilterOptions(req.user)) });
}));

// GET /payment-requests/expense-options?team= — what this team's expense form offers (the server's own list)
router.get('/expense-options', asyncHandler(async (req, res) => {
  res.json({ success: true, options: pr.expenseOptions(req.user, req.query) });
}));

// POST /payment-requests/expenses — multipart: team?, orderId? (link to an order), category, description, payee(JSON), bill, qr,
//   and amount (rupees) — or currency + foreignAmount + fxRate for a foreign bill
router.post('/expenses', concurrentUploadGuard, attachmentSizeGuard, uploadPaymentRequestFiles, handleAttachmentError, asyncHandler(async (req, res) => {
  const request = await pr.createExpense(req.user, { ...req.body, payee: json(req.body.payee, {}) }, req.files || {}, req);
  res.status(201).json({ success: true, request });
}));

// POST /payment-requests/supplier — multipart: orderId, itemIds(JSON) | dealId, amount, description, payee(JSON), bill, qr
router.post('/supplier', concurrentUploadGuard, attachmentSizeGuard, uploadPaymentRequestFiles, handleAttachmentError, asyncHandler(async (req, res) => {
  const request = await pr.createSupplierRequest(req.user, {
    ...req.body, payee: json(req.body.payee, {}), itemIds: json(req.body.itemIds, req.body.itemIds),
  }, req.files || {}, req);
  res.status(201).json({ success: true, request });
}));

// GET /payment-requests/order/:orderId — one order's payments (supplier + linked expenses) and supplier deals
router.get('/order/:orderId', asyncHandler(async (req, res) => {
  const [requests, supplierDeals] = await Promise.all([
    pr.forOrder(req.user, req.params.orderId),
    deals.forOrder(req.user, req.params.orderId),
  ]);
  res.json({ success: true, requests, deals: supplierDeals });
}));

// ── Supplier deals: made-to-order items paid in parts (services/supplierDealService.js) ──
// POST /payment-requests/deals — multipart, one step: the deal AND its advance request.
//   orderId, itemIds(JSON), currency, agreedTotal, advance, completionDate, note?, description?,
//   supplierId | payee(JSON) (+ saveSupplier), bill, qr. Both are saved, or neither.
router.post('/deals', concurrentUploadGuard, attachmentSizeGuard, uploadPaymentRequestFiles, handleAttachmentError, asyncHandler(async (req, res) => {
  const out = await pr.createDealWithAdvance(req.user, {
    ...req.body, payee: json(req.body.payee, {}), itemIds: json(req.body.itemIds, req.body.itemIds),
  }, req.files || {}, req);
  res.status(201).json({ success: true, ...out });
}));
// PUT /payment-requests/deals/:id { agreedTotal?, startDate?, completionDate?, note } — note (the reason) required
router.put('/deals/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, deal: await deals.update(req.user, req.params.id, req.body, req) });
}));
// POST /payment-requests/deals/:id/remove { note? } — only while nothing is asked for on it
router.post('/deals/:id/remove', asyncHandler(async (req, res) => {
  res.json({ success: true, deal: await deals.remove(req.user, req.params.id, req.body, req) });
}));

// GET /payment-requests/to-pay/suppliers?q=&method=bank|upi&sort=oldest|total_desc|count_desc|name — one row per account
router.get('/to-pay/suppliers', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await pr.supplierPayGroups(req.user, req.query)) });
}));

// GET /payment-requests/to-pay/suppliers/:groupId — that account's payments
router.get('/to-pay/suppliers/:groupId', asyncHandler(async (req, res) => {
  res.json({ success: true, group: await pr.supplierPayGroup(req.user, req.params.groupId) });
}));

// POST /payment-requests/pay-batch — multipart: ids(JSON), expectedTotal, method, reference, note?, proof
router.post('/pay-batch', concurrentUploadGuard, attachmentSizeGuard, uploadPaymentProof, handleAttachmentError, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await pr.payBatch(req.user, req.body, req.files || [], req)) });
}));

// GET /payment-requests/order-lookup?q= — orders to link an expense to (number, customer, total, date)
router.get('/order-lookup', asyncHandler(async (req, res) => {
  res.json({ success: true, orders: await pr.orderLookup(req.user, String(req.query.q || '')) });
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

// PUT /payment-requests/:id { amount?, description?, category?, payee? | supplierId? } — correct it
router.put('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.update(req.user, req.params.id, req.body, req) });
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
router.post('/:id/pay', concurrentUploadGuard, attachmentSizeGuard, uploadPaymentProof, handleAttachmentError, asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.markPaid(req.user, req.params.id, req.body, req.files || [], req) });
}));
// PUT /payment-requests/:id/payment — multipart: method?, reference?, note?, removeFileIds(JSON)?, proof (new screenshots)
// The admin corrects a paid payment's record (not the amount or the payee).
router.put('/:id/payment', concurrentUploadGuard, attachmentSizeGuard, uploadPaymentProof, handleAttachmentError, asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.editPayment(req.user, req.params.id, req.body, req.files || [], req) });
}));
// POST /payment-requests/:id/order { orderId | null } — link an expense to an order, change or remove it
router.post('/:id/order', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.linkOrder(req.user, req.params.id, req.body, req) });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await pr.cancel(req.user, req.params.id, req.body, req) });
}));

export default router;
