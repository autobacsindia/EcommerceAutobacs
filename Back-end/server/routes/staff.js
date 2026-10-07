import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  authenticatedUserRateLimit,
  resetPasswordRateLimit,
  verifyEmailRateLimit,
} from '../middleware/rateLimitMiddleware.js';
import {
  validateTeamQuery,
  validateStaffInvite,
  validateInviteIdParam,
  validateMemberIdParam,
  validateInviteToken,
  validateAcceptInvite,
  validateSalesProductSearch,
  validateCursorQuery,
  validateOrderIdParam,
  validateSalesOrder,
  validateWorkQueue,
  validateWorkOrder,
  validateWorkParcel,
  validateStockUpdate,
  validatePaymentInitiated,
  validateShipWithProof,
  validateCustomerDecision,
  validateRefundReview,
  validateMarkDelivered,
} from '../validators/staff.validator.js';
import { uploadProofPhoto, handleProofPhotoError, concurrentUploadGuard } from '../middleware/uploadMiddleware.js';
import {
  listQueue,
  getOrder as getWorkOrder,
  getProofPhoto,
  setStock,
  setPaymentInitiated,
  shipWithProof,
  recordDecision,
  reviewRefund,
  markDelivered,
} from '../services/teamWorkflowService.js';
import {
  describeStaff,
  listTeam,
  inviteMember,
  revokeInvite,
  deactivateMember,
  verifyInvite,
  acceptInvite,
} from '../services/staffService.js';
import {
  searchSalesProducts,
  createSalesOrder,
  listSalesOrders,
  listPaidSalesOrders,
  reissuePaymentLink,
  cancelUnpaidSalesOrder,
} from '../services/salesOrderService.js';

/**
 * Staff panel API (/api/v1/staff). Two halves:
 *   - public invite redemption (the invitee has no account yet)
 *   - the signed-in panel (active staff or admin; scope enforced in staffService)
 */
const router = express.Router();

// ── Public: invite redemption ────────────────────────────────────────────────

// @route  GET /staff/invites/verify?token=
router.get('/invites/verify', verifyEmailRateLimit, validateInviteToken, validateRequest,
  asyncHandler(async (req, res) => {
    const invite = await verifyInvite(req.query.token);
    res.json({ success: true, invite });
  }));

// @route  POST /staff/invites/accept  { token, password }
router.post('/invites/accept', resetPasswordRateLimit, validateAcceptInvite, validateRequest,
  asyncHandler(async (req, res) => {
    const result = await acceptInvite(req.body.token, req.body.password, req);
    res.json({ success: true, message: 'Your access is active. Sign in to continue.', ...result });
  }));

// ── Signed-in panel ──────────────────────────────────────────────────────────

router.use(authenticatedUserRateLimit, protect, staffOrAdmin);

// @route  GET /staff/me — the caller's team profile (null for an admin)
router.get('/me', (req, res) => {
  res.json({ success: true, staff: describeStaff(req.user), isAdmin: req.user.role === 'admin' });
});

// @route  GET /staff/team?team= — members + open invites
router.get('/team', validateTeamQuery, validateRequest, asyncHandler(async (req, res) => {
  const data = await listTeam(req.user, req.query.team);
  res.json({ success: true, ...data });
}));

// @route  POST /staff/invites  { name, email, phone, team?, isHead? }
router.post('/invites', validateStaffInvite, validateRequest, asyncHandler(async (req, res) => {
  const result = await inviteMember(req.user, req.body, req);
  res.status(201).json({ success: true, ...result });
}));

// @route  DELETE /staff/invites/:id — withdraw an open invite
router.delete('/invites/:id', validateInviteIdParam, validateRequest, asyncHandler(async (req, res) => {
  const invite = await revokeInvite(req.user, req.params.id, req);
  res.json({ success: true, invite });
}));

// @route  POST /staff/members/:id/deactivate — remove someone's staff access
router.post('/members/:id/deactivate', validateMemberIdParam, validateRequest, asyncHandler(async (req, res) => {
  const member = await deactivateMember(req.user, req.params.id, req);
  res.json({ success: true, member });
}));

// ── Sales panel (team scope enforced in salesOrderService) ──────────────────

// @route  GET /staff/sales/products?q= — product picker with current prices
router.get('/sales/products', validateSalesProductSearch, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, products: await searchSalesProducts(req.user, req.query.q) });
}));

// @route  POST /staff/sales/orders — create an order + its Razorpay payment link
router.post('/sales/orders', validateSalesOrder, validateRequest, asyncHandler(async (req, res) => {
  const result = await createSalesOrder(req.user, req.body, req);
  res.status(201).json({ success: true, ...result });
}));

// @route  GET /staff/sales/orders?cursor= — own orders (member) / all (head)
router.get('/sales/orders', validateCursorQuery, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listSalesOrders(req.user, { cursor: req.query.cursor })) });
}));

// @route  POST /staff/sales/orders/:id/payment-link — issue a new link (old one retired)
router.post('/sales/orders/:id/payment-link', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reissuePaymentLink(req.user, req.params.id, req)) });
}));

// @route  POST /staff/sales/orders/:id/cancel — cancel an UNPAID order
router.post('/sales/orders/:id/cancel', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await cancelUnpaidSalesOrder(req.user, req.params.id, req) });
}));

// @route  GET /staff/orders/paid?cursor= — paid sales orders (accounts, procurement, sales head)
router.get('/orders/paid', validateCursorQuery, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPaidSalesOrders(req.user, { cursor: req.query.cursor })) });
}));

// ── Team workflow (scope enforced in teamWorkflowService) ───────────────────

// @route  GET /staff/work?queue=procurement|decisions|refunds|deliveries&cursor=
router.get('/work', validateWorkQueue, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listQueue(req.user, req.query.queue, { cursor: req.query.cursor })) });
}));

// @route  GET /staff/work/orders/:id — one order, with the actions this person may take
router.get('/work/orders/:id', validateWorkOrder, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await getWorkOrder(req.user, req.params.id) });
}));

// @route  GET /staff/work/orders/:id/parcels/:shipmentId/photo — supplier proof (private)
router.get('/work/orders/:id/parcels/:shipmentId/photo', validateWorkParcel, validateRequest, asyncHandler(async (req, res) => {
  const { buffer, contentType } = await getProofPhoto(req.user, req.params.id, req.params.shipmentId);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/stock  { stock, supplierName? } — procurement
router.post('/work/orders/:id/lines/:itemId/stock', validateStockUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await setStock(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/payment  { initiated: boolean } — procurement
router.post('/work/orders/:id/lines/:itemId/payment', validatePaymentInitiated, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await setPaymentInitiated(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/ship  multipart: photo, itemIds?, courierName?, trackingNumber? — procurement
router.post(
  '/work/orders/:id/ship',
  concurrentUploadGuard,
  uploadProofPhoto,
  handleProofPhotoError,
  validateShipWithProof,
  validateRequest,
  asyncHandler(async (req, res) => {
    const { itemIds = [], courierName, trackingNumber } = req.body;
    res.json({ success: true, order: await shipWithProof(req.user, req.params.id, { itemIds, courierName, trackingNumber }, req.file, req) });
  }),
);

// @route  POST /staff/work/orders/:id/lines/:itemId/decision  { decision: wait|refund, note? } — sales
router.post('/work/orders/:id/lines/:itemId/decision', validateCustomerDecision, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await recordDecision(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/refund  { approve, note? } — accounts
router.post('/work/orders/:id/lines/:itemId/refund', validateRefundReview, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await reviewRefund(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/delivered  { shipmentId? } — operations
router.post('/work/orders/:id/delivered', validateMarkDelivered, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await markDelivered(req.user, req.params.id, req.body, req) });
}));

export default router;
