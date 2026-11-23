import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import * as accounts from '../services/procurementPartners/accounts.js';
import * as listings from '../services/procurementPartners/listings.js';
import * as priceReviews from '../services/procurementPartners/priceReviews.js';
import * as marginRules from '../services/procurementPartners/marginRules.js';
import { counts } from '../services/procurementPartners/counts.js';

/**
 * Autobacs Partner — procurement's side (/api/v1/procurement/partners).
 * Active procurement staff or the admin; the services decide (shared.guard).
 * A supplier token fails `protect` (different signing key), so suppliers get 401.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
// Bank details, costs and margins: never cached by a browser or proxy.
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const sendFile = (res, { buffer, contentType, name }) => {
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
};

// GET /counts   badge: { accounts, listings, priceReviews, total }
router.get('/counts', asyncHandler(async (req, res) => {
  res.json({ success: true, counts: await counts(req.user) });
}));

// ── Supplier accounts ──────────────────────────────────────────────────────
// GET /accounts?status=in_review|changes_requested|approved|suspended|rejected&after=
router.get('/accounts', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await accounts.list(req.user, req.query)) });
}));
router.get('/accounts/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, account: await accounts.get(req.user, req.params.id) });
}));
// GET /accounts/:id/documents/gst-certificate|cancelled-cheque   the private file
router.get('/accounts/:id/documents/:kind', asyncHandler(async (req, res) => {
  sendFile(res, await accounts.getDocument(req.user, req.params.id, req.params.kind));
}));
// POST /accounts/:id/approve { mode: 'new'|'link', supplierId?, copyBank? }
router.post('/accounts/:id/approve', asyncHandler(async (req, res) => {
  const out = await accounts.approve(req.user, req.params.id, req.body || {}, req);
  res.status(out.created ? 201 : 200).json({ success: true, ...out });
}));
// POST /accounts/:id/request-changes|reject|suspend|unsuspend { note }
for (const [path, fn] of [['request-changes', accounts.requestChanges], ['reject', accounts.reject], ['suspend', accounts.suspend], ['unsuspend', accounts.unsuspend]]) {
  router.post(`/accounts/:id/${path}`, asyncHandler(async (req, res) => {
    res.json({ success: true, account: await fn(req.user, req.params.id, req.body || {}, req) });
  }));
}

// ── Listings ───────────────────────────────────────────────────────────────
// GET /listings?status=submitted|changes_requested|live|rejected|withdrawn&after=
router.get('/listings', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listings.list(req.user, req.query)) });
}));
router.get('/listings/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, listing: await listings.get(req.user, req.params.id) });
}));
router.get('/listings/:id/images/:index', asyncHandler(async (req, res) => {
  sendFile(res, await listings.getImage(req.user, req.params.id, req.params.index));
}));
// POST /listings/:id/quote { categories, price }   price box preview (read-only)
router.post('/listings/:id/quote', asyncHandler(async (req, res) => {
  res.json({ success: true, pricing: await listings.quote(req.user, req.params.id, req.body || {}) });
}));
// POST /listings/:id/approve-new { rev, product: {name, description, shortDescription, categories, brand, sku, specifications}, price, keepHidden?, imageIndexes?, drivesStock?, override?, overrideReason? }
router.post('/listings/:id/approve-new', asyncHandler(async (req, res) => {
  const out = await listings.approveNew(req.user, req.params.id, req.body || {}, req);
  res.status(out.created ? 201 : 200).json({ success: true, ...out });
}));
// POST /listings/:id/approve-link { rev, productId, setPrice?, price?, drivesStock?, override?, overrideReason? }
router.post('/listings/:id/approve-link', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listings.approveLink(req.user, req.params.id, req.body || {}, req)) });
}));
for (const [path, fn] of [['request-changes', listings.requestChanges], ['reject', listings.reject]]) {
  router.post(`/listings/:id/${path}`, asyncHandler(async (req, res) => {
    res.json({ success: true, listing: await fn(req.user, req.params.id, req.body || {}, req) });
  }));
}

// ── Price reviews ──────────────────────────────────────────────────────────
// GET /price-reviews?status=pending|applied|kept|superseded&after=
router.get('/price-reviews', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await priceReviews.list(req.user, req.query)) });
}));
// GET /price-reviews/product/:productId?after=   one product's cost/price history
router.get('/price-reviews/product/:productId', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await priceReviews.history(req.user, req.params.productId, req.query)) });
}));
// POST /price-reviews/:id/apply { price, override?, overrideReason?, note? }   /keep { note?, override?, overrideReason? }
router.post('/price-reviews/:id/apply', asyncHandler(async (req, res) => {
  res.json({ success: true, review: await priceReviews.apply(req.user, req.params.id, req.body || {}, req) });
}));
router.post('/price-reviews/:id/keep', asyncHandler(async (req, res) => {
  res.json({ success: true, review: await priceReviews.keep(req.user, req.params.id, req.body || {}, req) });
}));

// ── Margin rules ───────────────────────────────────────────────────────────
router.get('/margin-rules', asyncHandler(async (req, res) => {
  res.json({ success: true, rules: await marginRules.get(req.user) });
}));
// PUT /margin-rules { categoryId?: null for the default, targetPct, floorPct }
router.put('/margin-rules', asyncHandler(async (req, res) => {
  res.json({ success: true, rules: await marginRules.set(req.user, req.body || {}, req) });
}));
router.delete('/margin-rules/:categoryId', asyncHandler(async (req, res) => {
  res.json({ success: true, rules: await marginRules.remove(req.user, req.params.categoryId, req) });
}));

export default router;
