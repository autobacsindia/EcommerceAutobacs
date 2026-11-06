import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import * as suppliers from '../services/supplierService.js';
import * as credit from '../services/supplierLedgerService.js';

/**
 * The supplier directory (/api/v1/suppliers). Procurement and the admin add and
 * edit; accounts views. Who may do what is decided in services/supplierService.js.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
// Bank details: never cached by a browser or proxy.
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// GET /suppliers?q=&prefix=&status=active|inactive|all&method=bank|upi&changed=recent&sort=name|newest|updated&after=
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await suppliers.list(req.user, req.query)) });
}));

// ── Supplier credit (services/supplierLedgerService.js) — before /:id ───────────
// GET /suppliers/credit/pending?after=   accounts' queue
router.get('/credit/pending', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await credit.pending(req.user, req.query)) });
}));
// GET /suppliers/credit/owing   every supplier who owes us something
router.get('/credit/owing', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await credit.owing(req.user)) });
}));
// GET /suppliers/credit/report.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/credit/report.csv', asyncHandler(async (req, res) => {
  const csv = await credit.report(req.user, req.query, req);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="supplier-credit-${String(req.query.from).slice(0, 10)}-to-${String(req.query.to).slice(0, 10)}.csv"`);
  res.send(csv);
}));
// POST /suppliers/credit/claims { paymentRequestId, amount?, note? }   "Supplier must refund"
router.post('/credit/claims', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, entry: await credit.claimRefund(req.user, req.body?.paymentRequestId, req.body, req) });
}));
// POST /suppliers/credit/:entryId/approve|decline|cancel { note }
for (const action of ['approve', 'decline', 'cancel']) {
  router.post(`/credit/:entryId/${action}`, asyncHandler(async (req, res) => {
    res.json({ success: true, entry: await credit[action](req.user, req.params.entryId, req.body || {}, req) });
  }));
}

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, supplier: await suppliers.create(req.user, req.body, req) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, supplier: await suppliers.get(req.user, req.params.id) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, supplier: await suppliers.update(req.user, req.params.id, req.body, req) });
}));

// GET /suppliers/:id/credit?after=   balance + history
router.get('/:id/credit', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await credit.forSupplier(req.user, req.params.id, req.query)) });
}));
// POST /suppliers/:id/credit/repayments { currency, amount, date, reference, note, formKey }
router.post('/:id/credit/repayments', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, entry: await credit.recordRepayment(req.user, req.params.id, req.body || {}, req) });
}));
// POST /suppliers/:id/credit/write-offs { currency, amount, note, formKey }   admin only
router.post('/:id/credit/write-offs', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, entry: await credit.writeOff(req.user, req.params.id, req.body || {}, req) });
}));

// POST /suppliers/:id/active { active: boolean }
router.post('/:id/active', asyncHandler(async (req, res) => {
  res.json({ success: true, supplier: await suppliers.setActive(req.user, req.params.id, req.body?.active === true, req) });
}));

export default router;
