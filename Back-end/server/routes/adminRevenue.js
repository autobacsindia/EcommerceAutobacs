/**
 * Company revenue (admin only) — /api/v1/admin/revenue
 *
 *   GET   /admin/revenue?period=fy|all               the full picture, month by month
 *   GET   /admin/revenue/sales?period&source&cursor   every sale behind the figures (cursor paged)
 *   POST  /admin/revenue/zoho-import (file=CSV)       import a Zoho Books invoice OR credit-note export
 *   POST  /admin/revenue/zoho-rematch                 re-run the count-once matcher
 *   GET   /admin/revenue/zoho-invoices?state&cursor   invoices by match state (cursor paged)
 *   PATCH /admin/revenue/zoho-invoices/:id            admin decides: same panel order / separate sale
 *
 * The figures here are company-level money, so every route is admin-only on the
 * server (`protect` → 401, `admin` → 403 for staff and customers).
 */
import express from 'express';
import multer from 'multer';
import { query, body, param } from 'express-validator';
import { protect, admin } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import cacheService from '../services/cacheService.js';
import {
  companyRevenueSummary,
  listCompanySales,
  importZohoExport,
  rematchZohoInvoices,
  listZohoInvoices,
  decideZohoInvoice,
} from '../services/companyRevenueService.js';
import { ZOHO_IMPORT_MAX_BYTES, ZOHO_MATCH_STATES } from '../config/companyRevenue.js';

const router = express.Router();
router.use(protect, admin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ZOHO_IMPORT_MAX_BYTES, files: 1 } }).single('file');
const uploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (5 MB at most). Export fewer months at a time.' : 'Upload one CSV file.';
    return res.status(400).json({ success: false, message });
  }
  return next(err);
};

/** The header tiles read a 30 s cached copy; a change here must show at once. */
const dropHeaderCache = () => cacheService.delete(cacheService.generateKey('admin:stats'));
const noStore = (res) => res.set('Cache-Control', 'private, no-store');

router.get(
  '/revenue',
  query('period').optional().isIn(['fy', 'all']),
  validateRequest,
  asyncHandler(async (req, res) => {
    noStore(res);
    res.json({ success: true, summary: await companyRevenueSummary({ period: req.query.period || 'fy' }) });
  })
);

router.get(
  '/revenue/sales',
  query('period').optional().isIn(['fy', 'all']),
  query('source').optional().isIn(['web', 'woocommerce', 'offline', 'zoho']),
  query('cursor').optional().isString().isLength({ max: 60 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validateRequest,
  asyncHandler(async (req, res) => {
    noStore(res);
    res.json({ success: true, ...(await listCompanySales(req.query)) });
  })
);

router.post(
  '/revenue/zoho-import',
  upload,
  uploadErrors,
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer?.length) return res.status(400).json({ success: false, message: 'Choose the Zoho CSV to upload.' });
    const result = await importZohoExport(req.file.buffer, req.user);
    await dropHeaderCache();
    return res.json({ success: true, result });
  })
);

router.post(
  '/revenue/zoho-rematch',
  asyncHandler(async (req, res) => {
    const result = await rematchZohoInvoices();
    await dropHeaderCache();
    res.json({ success: true, result });
  })
);

router.get(
  '/revenue/zoho-invoices',
  query('state').optional().isIn(ZOHO_MATCH_STATES),
  query('cursor').optional().isString().isLength({ max: 60 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validateRequest,
  asyncHandler(async (req, res) => {
    noStore(res);
    res.json({ success: true, ...(await listZohoInvoices(req.query)) });
  })
);

router.patch(
  '/revenue/zoho-invoices/:id',
  param('id').isMongoId(),
  body('decision').isIn(['same', 'different']),
  body('orderId').optional({ values: 'null' }).isMongoId(),
  validateRequest,
  asyncHandler(async (req, res) => {
    const invoice = await decideZohoInvoice(req.params.id, req.body, req.user);
    await dropHeaderCache();
    res.json({ success: true, invoice });
  })
);

export default router;
