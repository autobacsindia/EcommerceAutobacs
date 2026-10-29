import express from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { concurrentUploadGuard } from '../middleware/uploadMiddleware.js';
import {
  validatePastSaleId,
  validatePastSaleBatch,
  validatePastSaleList,
  validatePastSaleTotals,
  validatePastSaleBody,
  validatePastSaleUpload,
} from '../validators/pastSale.validator.js';
import {
  createPastSale,
  updatePastSale,
  deletePastSale,
  restorePastSale,
  deleteUpload,
  getPastSale,
  listPastSales,
  pastSaleTotals,
  listPastSaleSellers,
  previewUpload,
  importUpload,
  mayUse,
} from '../services/pastSaleService.js';
import { templateCsv, MAX_UPLOAD_BYTES } from '../services/pastSaleInput.js';
import { findSalesProducts } from '../services/salesOrderService.js';
import { validateSalesProductSearch } from '../validators/staff.validator.js';

/**
 * Past (offline) sales (/api/v1/staff/past-sales). Mounted inside routes/staff.js,
 * AFTER its `protect, staffOrAdmin` and rate limit. Who may do what is decided in
 * services/pastSaleService.js (GTM sellers: their own; accounts / admin: all).
 */
const router = express.Router();

// GTM sellers, accounts and the admin only — other teams never reach a handler.
router.use((req, res, next) => (mayUse(req.user) ? next() : res.status(403).json({ success: false, message: 'Not authorized.' })));

const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
}).single('file');

/** Multer errors on the sheet → a 400 with words, not a 500. */
const sheetErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (2 MB at most). Split it into smaller files.'
      : 'Upload one CSV file.';
    return res.status(400).json({ success: false, message });
  }
  return next(err);
};
const requireFile = (req, res, next) => (req.file?.buffer?.length
  ? next()
  : res.status(400).json({ success: false, message: 'Choose the CSV file to upload.' }));

// @route  GET /staff/past-sales?from&to&seller&q&deleted&batch&cursor
router.get('/', validatePastSaleList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPastSales(req.user, req.query)) });
}));

// @route  GET /staff/past-sales/totals?from&to&seller — count and value per salesman
router.get('/totals', validatePastSaleTotals, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await pastSaleTotals(req.user, req.query)) });
}));

// @route  GET /staff/past-sales/sellers — accounts / admin: who a sale can be credited to
router.get('/sellers', asyncHandler(async (req, res) => {
  res.json({ success: true, sellers: await listPastSaleSellers(req.user) });
}));

// @route  GET /staff/past-sales/products?q= — link a line to a catalogue product (optional)
router.get('/products', validateSalesProductSearch, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, products: await findSalesProducts(req.query.q) });
}));

// @route  GET /staff/past-sales/template — the CSV template
router.get('/template', (req, res) => {
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="past-sales-template.csv"',
    'Cache-Control': 'private, no-store',
  });
  res.send(`\uFEFF${templateCsv()}`); // BOM: Excel then reads ₹ and names correctly
});

// @route  POST /staff/past-sales — one sale
router.post('/', validatePastSaleBody, validateRequest, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, ...(await createPastSale(req.user, req.body, req)) });
}));

// @route  POST /staff/past-sales/upload/preview — multipart: file (CSV), salesUserId? — writes nothing
router.post('/upload/preview', concurrentUploadGuard, sheetUpload, sheetErrors, requireFile, validatePastSaleUpload, validateRequest,
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await previewUpload(req.user, req.file.buffer, { salesUserId: req.body.salesUserId })) });
  }));

// @route  POST /staff/past-sales/upload — multipart: file (CSV), salesUserId? — imports the ready sales
router.post('/upload', concurrentUploadGuard, sheetUpload, sheetErrors, requireFile, validatePastSaleUpload, validateRequest,
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await importUpload(req.user, req.file.buffer, { salesUserId: req.body.salesUserId }, req)) });
  }));

// @route  DELETE /staff/past-sales/uploads/:batchId — accounts / admin: undo one upload
router.delete('/uploads/:batchId', validatePastSaleBatch, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await deleteUpload(req.user, req.params.batchId, req)) });
}));

// @route  GET /staff/past-sales/:id — with its change history
router.get('/:id', validatePastSaleId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, sale: await getPastSale(req.user, req.params.id) });
}));

// @route  PUT /staff/past-sales/:id — the whole sale + `version` it was loaded at
router.put('/:id', validatePastSaleId, validatePastSaleBody, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await updatePastSale(req.user, req.params.id, req.body, req)) });
}));

// @route  DELETE /staff/past-sales/:id — accounts / admin (soft, restorable)
router.delete('/:id', validatePastSaleId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await deletePastSale(req.user, req.params.id, req)) });
}));

// @route  POST /staff/past-sales/:id/restore — accounts / admin
router.post('/:id/restore', validatePastSaleId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await restorePastSale(req.user, req.params.id, req)) });
}));

export default router;
