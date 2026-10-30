/**
 * Returns in the team panel — /api/v1/staff/returns. Mounted inside routes/staff.js,
 * behind its protect + staffOrAdmin gate and authenticated rate limit.
 *
 * Every route is a thin shell over services/returnService.js, which owns who may do
 * what (rule 9 "Permissions"), the state machine and the money. The customer refund
 * runs through the SAME code as the admin route (services/returnRefundService.js).
 *
 *   raise                                  canSell, operations, admin
 *   review, pickup, received, inspect      operations, admin
 *   direct-to-supplier, supplier claims    procurement, admin
 *   refund                                 accounts (≤ ₹25,000), accounts head, admin
 *   supplier money received                accounts, admin
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  uploadProofPhotos, handleAttachmentError, attachmentSizeGuard, concurrentUploadGuard,
} from '../middleware/uploadMiddleware.js';
import { validateReturnRefundBody } from '../middleware/validators/returnRefund.js';
import {
  validateReturnList, validateOwedList, validateReturnId, validateOrderParam, validateReturnFile, validateRaise,
  validateUploadTargets, validateReview, validatePickup, validateNote, validateRequiredNote, validateInspection,
  validateSupplierCheck, validateClaimOpen, validateClaimAnswer, validateClaimShipBack, validateClaimCheck,
  validateClaimPromise, validateClaimMoney,
} from '../validators/staffReturns.validator.js';
import returnService from '../services/returnService.js';

const router = express.Router();

/** Photos/PDFs on a step (field `photo`, up to the shared attachment limit). */
const withPhotos = [concurrentUploadGuard, attachmentSizeGuard, uploadProofPhotos, handleAttachmentError];

const ok = (res, ret) => res.json({ success: true, return: ret });

// ── Lists ─────────────────────────────────────────────────────────────────────

// @route  GET /staff/returns?queue=review|pickup|inspect|supplier_pickup|refund|supplier|mine|all&cursor=
router.get('/', validateReturnList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await returnService.listReturns(req.user, req.query)) });
}));

// @route  GET /staff/returns/suppliers-owe-us?cursor= — promised, not yet received (accounts, procurement)
router.get('/suppliers-owe-us', validateOwedList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await returnService.suppliersOweUs(req.user, req.query)) });
}));

// ── Raising ───────────────────────────────────────────────────────────────────

// @route  GET /staff/returns/orders/:orderId/options — what the "Raise return" dialog offers
router.get('/orders/:orderId/options', validateOrderParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, options: await returnService.raiseOptions(req.user, req.params.orderId) });
}));

// @route  POST /staff/returns/upload-targets { files? } — where the customer's photos/video upload
router.post('/upload-targets', validateUploadTargets, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await returnService.evidenceUploadTargets(req.user, req.body?.files)) });
}));

// @route  POST /staff/returns { orderId, items[{itemId, quantity, reason}], description, unusedDeclared?, images[], video?, proofOfPurchase? }
router.post('/', validateRaise, validateRequest, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, return: await returnService.raiseReturn(req.user, req.body, req) });
}));

// ── One return ────────────────────────────────────────────────────────────────

router.get('/:id', validateReturnId, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.getReturn(req.user, req.params.id));
}));

// @route  GET /staff/returns/:id/files/:fileId — an attached photo/PDF (private)
router.get('/:id/files/:fileId', validateReturnFile, validateRequest, asyncHandler(async (req, res) => {
  const { buffer, contentType, name } = await returnService.getStaffFile(req.user, req.params.id, req.params.fileId);
  res.setHeader('Content-Type', contentType);
  if (name) res.setHeader('Content-Disposition', `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
}));

// Check 1 — operations.
router.post('/:id/review', validateReview, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.reviewReturn(req.user, req.params.id, req.body, req));
}));

// Pickup — operations (our warehouse) or procurement (straight to the supplier).
router.post('/:id/pickup', validatePickup, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.bookPickup(req.user, req.params.id, req.body, req));
}));
router.post('/:id/dropped-at-store', validateNote, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.markDroppedAtStore(req.user, req.params.id, req.body, req));
}));
router.post('/:id/pickup-failed', validateRequiredNote, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.recordPickupFailed(req.user, req.params.id, req.body, req));
}));
router.post('/:id/received', validateNote, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.markReceived(req.user, req.params.id, req.body, req));
}));

// Check 2 — operations (multipart: photo[]); the supplier's check — procurement.
router.post('/:id/inspection', ...withPhotos, validateInspection, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.recordInspection(req.user, req.params.id, req.body, req.files || [], req));
}));
router.post('/:id/supplier-check', ...withPhotos, validateSupplierCheck, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.recordSupplierCheck(req.user, req.params.id, req.body, req.files || [], req));
}));

// Track A — the customer refund (accounts). Same body as the admin refund route.
router.get('/:id/refund-preview', validateReturnId, validateRequest, asyncHandler(async (req, res) => {
  res.json(await returnService.refundPreviewFor(req.user, req.params.id, null));
}));
router.post('/:id/refund-preview', validateReturnRefundBody, asyncHandler(async (req, res) => {
  res.json(await returnService.refundPreviewFor(req.user, req.params.id, req.body));
}));
router.post('/:id/refund', validateReturnRefundBody, asyncHandler(async (req, res) => {
  res.json(await returnService.sendRefund(req.user, req.params.id, req));
}));

// Track B — the supplier claim (procurement); money received (accounts).
router.post('/:id/claims', validateClaimOpen, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.openSupplierClaim(req.user, req.params.id, req.body, req));
}));
router.post('/:id/claims/:claimId/answer', validateClaimAnswer, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.recordSupplierAnswer(req.user, req.params.id, req.params.claimId, req.body, req));
}));
router.post('/:id/claims/:claimId/ship-back', ...withPhotos, validateClaimShipBack, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.recordShipBack(req.user, req.params.id, req.params.claimId, req.body, req.files || [], req));
}));
router.post('/:id/claims/:claimId/check', ...withPhotos, validateClaimCheck, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.recordClaimCheck(req.user, req.params.id, req.params.claimId, req.body, req.files || [], req));
}));
router.post('/:id/claims/:claimId/settlement', validateClaimPromise, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.promiseSettlement(req.user, req.params.id, req.params.claimId, req.body, req));
}));
router.post('/:id/claims/:claimId/received', validateClaimMoney, validateRequest, asyncHandler(async (req, res) => {
  ok(res, await returnService.confirmSupplierMoney(req.user, req.params.id, req.params.claimId, req.body, req));
}));

export default router;
