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
  validateMemberUpdate,
  validateInviteToken,
  validateAcceptInvite,
  validateCompanyAccount,
  validatePasswordReset,
  validateOwnPasswordChange,
  validateSalesProductSearch,
  validatePaidOrdersQuery,
  validateAttributionList,
  validateBankTransferList,
  validateBankTransferId,
  validateBankTransferFile,
  validateBankTransferReject,
  validateSetSeller,
  validateOrderIdParam,
  validateSalesOrder,
  validateQuotationIdParam,
  validateQuotationHold,
  validateOrderHold,
  validateSalesOrderList,
  validateQuotationList,
  validatePaymentParts,
  validatePaymentPartParam,
  validateWorkQueue,
  validateWorkOrder,
  validateWorkParcel, validateWorkParcelPhoto,
  validateStockUpdate,
  validatePaymentInitiated,
  validateShipWithProof,
  validateDispatchOwnStock,
  validateWorkLineOnly,
  validateEditParcel,
  validateParcelStep,
  validateParcelEta,
  validateCustomerDecision,
  validateRefundReview,
  validateRefundRetry,
  validateCustomerBankRead,
  validateCustomerBankSave,
  validateCustomerBankRemove,
  validateMarkDelivered,
  validateUndoDelivered,
} from '../validators/staff.validator.js';
import staffTaskRoutes from './staffTasks.js';
import pastSaleRoutes from './pastSales.js';
import staffReturnRoutes from './staffReturns.js';
import {
  uploadProofPhotos, handleAttachmentError, attachmentSizeGuard, concurrentUploadGuard, uploadPaymentProof, uploadPayDetailsQr,
} from '../middleware/uploadMiddleware.js';
import {
  listQueue,
  getOrder as getWorkOrder,
  getProofPhoto,
  setStock,
  setPaymentInitiated,
  undoStock,
  undoDecision,
  editShipment,
  shipWithProof,
  dispatchOwnStock,
  recordDecision,
  reviewRefund,
  retryRefund,
  markDelivered,
  addParcelStep,
  setParcelEta,
  undoDelivered,
} from '../services/teamWorkflowService.js';
import {
  describeStaff,
  listTeam,
  inviteMember,
  revokeInvite,
  deactivateMember,
  updateMember,
  verifyInvite,
  acceptInvite,
  createCompanyAccount,
  resetCompanyPassword,
  getMemberPassword,
  changeOwnPassword,
} from '../services/staffService.js';
import {
  generateTokenPair as generateSessionTokenPair,
  storeRefreshToken,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from '../utils/sessionManager.js';
import {
  searchSalesProducts,
  listSalesOrders,
  holdSalesOrder,
  resumeSalesOrder,
  listPaidSalesOrders,
  reissuePaymentLink,
  cancelUnpaidSalesOrder,
  getSalesOrder,
} from '../services/salesOrderService.js';
import { getQuotationPdf } from '../services/quotationService.js';
import { getBankAccount, saveBankAccount, removeBankAccount } from '../services/customerBankService.js';
import {
  createQuotation, updateQuotation, cancelQuotation, acceptQuotation, holdQuotation, resumeQuotation,
  getQuotation, listQuotations, getQuotationDocument,
} from '../services/salesQuotationService.js';
import { requestPayment, cancelPart, getPaymentRequestPdf } from '../services/salesPaymentService.js';
import { setPayDetails, readPayDetailsQr } from '../services/salesPayDetailsService.js';
import { canSell } from '../config/staff.js';
import { listSellers, listWebsiteOrders, getWebsiteOrder, setSeller } from '../services/orderAttributionService.js';
import {
  recordBankTransfer, confirmBankTransfer, rejectBankTransfer, listBankTransfers, getBankTransfer,
  editBankTransfer, withdrawBankTransfer, getTransferFile,
} from '../services/bankTransferService.js';

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

// Tasks given to people in the panel (routes/staffTasks.js) — behind the gate above.
router.use('/tasks', staffTaskRoutes);

// Past (offline) sales (routes/pastSales.js) — GTM sellers, accounts, admin.
router.use('/past-sales', pastSaleRoutes);

// Returns (routes/staffReturns.js) — raise, review, pickup, inspect, refund, supplier claims.
router.use('/returns', staffReturnRoutes);

// @route  GET /staff/me — the caller's team profile (null for an admin)
router.get('/me', (req, res) => {
  res.json({ success: true, staff: describeStaff(req.user), isAdmin: req.user.role === 'admin' });
});

// @route  POST /staff/password { currentPassword, newPassword } — change my own password.
// Email (invite) staff only; a company account's password is the admin's to change.
// Every other session ends; this device gets fresh cookies so the person stays signed in.
router.post('/password', resetPasswordRateLimit, validateOwnPasswordChange, validateRequest, asyncHandler(async (req, res) => {
  const user = await changeOwnPassword(req.user, req.body, req);
  const ip = req.headers['cf-connecting-ip'] || req.ip;
  const ua = req.headers['user-agent'];
  const tokens = generateSessionTokenPair(user, ip, ua);
  await storeRefreshToken(user, tokens.refreshToken, tokens.refreshTokenExpiry, ip, ua);
  setAccessTokenCookie(res, tokens.accessToken, tokens.accessTokenExpiry);
  setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiry);
  res.json({ success: true, message: 'Password changed.' });
}));

// @route  POST /staff/accounts { name, username, phone, password, team?, isHead? }
// A company-owned login (config/staff.js). Admin: any team; head: members of their own.
router.post('/accounts', validateCompanyAccount, validateRequest, asyncHandler(async (req, res) => {
  const member = await createCompanyAccount(req.user, req.body, req);
  res.status(201).json({ success: true, member });
}));

// @route  POST /staff/members/:id/password { password } — reset a company account's password
router.post('/members/:id/password', validatePasswordReset, validateRequest, asyncHandler(async (req, res) => {
  const member = await resetCompanyPassword(req.user, req.params.id, req.body.password, req);
  res.json({ success: true, member });
}));

// @route  GET /staff/members/:id/password — the admin (anyone) or the head (own team's members). Logged.
router.get('/members/:id/password', validateMemberIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await getMemberPassword(req.user, req.params.id, req)) });
}));

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
// @route  PUT /staff/members/:id — admin edits name, mobile, username, team, head, GTM role
router.put('/members/:id', validateMemberUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, member: await updateMember(req.user, req.params.id, req.body, req) });
}));

router.post('/members/:id/deactivate', validateMemberIdParam, validateRequest, asyncHandler(async (req, res) => {
  const member = await deactivateMember(req.user, req.params.id, req);
  res.json({ success: true, member });
}));

// ── Sales panel (team scope enforced in salesOrderService) ──────────────────

// @route  GET /staff/sales/products?q= — product picker with current prices
router.get('/sales/products', validateSalesProductSearch, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, products: await searchSalesProducts(req.user, req.query.q) });
}));

// @route  POST /staff/sales/orders — RETIRED: GTM sells quotation-first now.
// A quotation is created and shared, accepted, and payment is requested on the
// resulting order (routes below). Non-sellers still get 403, as before.
router.post('/sales/orders', (req, res) => {
  if (!canSell(req.user)) return res.status(403).json({ success: false, message: 'Not authorized.' });
  return res.status(410).json({ success: false, message: 'Create a quotation first, then accept it and request payment.' });
});

// ── Quotations (salesQuotationService) ──────────────────────────────────────

const sendPdf = (res, { buffer, filename }) => {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    // Customer names, phone and prices: never cached by a browser or a proxy.
    'Cache-Control': 'private, no-store',
    'Content-Length': buffer.length,
  });
  res.send(buffer);
};

// @route  POST /staff/sales/quotations — new quotation (same body as a sales order)
router.post('/sales/quotations', validateSalesOrder, validateRequest, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, quotation: await createQuotation(req.user, req.body, req) });
}));

// @route  GET /staff/sales/quotations?cursor=&status= — own (lead) / all (head)
router.get('/sales/quotations', validateQuotationList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listQuotations(req.user, req.query)) });
}));

router.get('/sales/quotations/:id', validateQuotationIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, quotation: await getQuotation(req.user, req.params.id) });
}));

// @route  PUT /staff/sales/quotations/:id — edit a quotation (new version); an accepted, unpaid one re-opens
// { ...quotation body, discount?: { percent, reason }, confirmNotPaid? }
router.put('/sales/quotations/:id', validateQuotationIdParam, validateSalesOrder, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, quotation: await updateQuotation(req.user, req.params.id, req.body, req) });
}));

router.post('/sales/quotations/:id/cancel', validateQuotationIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, quotation: await cancelQuotation(req.user, req.params.id, req) });
}));

// @route  POST /staff/sales/quotations/:id/hold { until?, note? } — "On hold — customer thinking"
router.post('/sales/quotations/:id/hold', validateQuotationHold, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, quotation: await holdQuotation(req.user, req.params.id, req.body, req) });
}));

// @route  POST /staff/sales/quotations/:id/resume — back to the active list
router.post('/sales/quotations/:id/resume', validateQuotationIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, quotation: await resumeQuotation(req.user, req.params.id, req) });
}));

// @route  POST /staff/sales/quotations/:id/accept — customer agreed → the order (no link yet)
router.post('/sales/quotations/:id/accept', validateQuotationIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, ...(await acceptQuotation(req.user, req.params.id, req)) });
}));

router.get('/sales/quotations/:id/pdf', validateQuotationIdParam, validateRequest, asyncHandler(async (req, res) => {
  sendPdf(res, await getQuotationDocument(req.user, req.params.id));
}));

// ── Payment on a quotation-first order, in parts (salesPaymentService) ─────

// @route  POST /staff/sales/orders/:id/payment-parts { amounts: [rupees…] }
router.post('/sales/orders/:id/payment-parts', validatePaymentParts, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, payment: await requestPayment(req.user, req.params.id, req.body.amounts, req) });
}));

router.post('/sales/orders/:id/payment-parts/:partId/cancel', validatePaymentPartParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, payment: await cancelPart(req.user, req.params.id, req.params.partId, req) });
}));

// @route  GET /staff/sales/orders/:id/payment-request — PDF: every waiting part with its link + QR
router.get('/sales/orders/:id/payment-request', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  sendPdf(res, await getPaymentRequestPdf(req.user, req.params.id));
}));

// @route  GET /staff/sales/orders?cursor=&view=active|on_hold — own orders (member) / all (head)
router.get('/sales/orders', validateSalesOrderList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listSalesOrders(req.user, { cursor: req.query.cursor, view: req.query.view || 'active' })) });
}));

// @route  POST /staff/sales/orders/:id/hold { until?, note? } — "On hold — customer thinking"
router.post('/sales/orders/:id/hold', validateOrderHold, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await holdSalesOrder(req.user, req.params.id, req.body, req) });
}));

// @route  POST /staff/sales/orders/:id/resume — back to the active list
router.post('/sales/orders/:id/resume', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await resumeSalesOrder(req.user, req.params.id, req) });
}));

// @route  POST /staff/sales/orders/:id/payment-link — issue a new link (old one retired)
// @route  GET /staff/sales/orders/:id — one order (to start a new order for the same customer)
router.get('/sales/orders/:id', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await getSalesOrder(req.user, req.params.id) });
}));

// @route  GET /staff/sales/orders/:id/quotation — the quotation PDF (seller, sales head, admin)
router.get('/sales/orders/:id/quotation', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  const { buffer, filename } = await getQuotationPdf(req.user, req.params.id);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    // Customer names, phone and prices: never cached by a browser or a proxy.
    'Cache-Control': 'private, no-store',
    'Content-Length': buffer.length,
  });
  res.send(buffer);
}));

router.post('/sales/orders/:id/payment-link', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reissuePaymentLink(req.user, req.params.id, req)) });
}));

// @route  POST /staff/sales/orders/:id/cancel — cancel an UNPAID order
router.post('/sales/orders/:id/cancel', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await cancelUnpaidSalesOrder(req.user, req.params.id, req) });
}));

// @route  GET /staff/orders/paid?cursor=&stage=processing|delivered — paid sales
//         orders (accounts, procurement, operations, sales head). No stage = all.
router.get('/orders/paid', validatePaidOrdersQuery, validateRequest, asyncHandler(async (req, res) => {
  const { cursor, stage, q, source, sort } = req.query;
  res.json({ success: true, ...(await listPaidSalesOrders(req.user, { cursor, stage, q, source, sort })) });
}));

// ── Crediting a website order to a salesman (admin, marketing) ──────────────

// @route  GET /staff/attribution/orders?cursor= — paid website orders, newest first
router.get('/attribution/orders', validateAttributionList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listWebsiteOrders(req.user, { cursor: req.query.cursor })) });
}));

// @route  GET /staff/attribution/sellers — who an order can be credited to
router.get('/attribution/sellers', asyncHandler(async (req, res) => {
  res.json({ success: true, sellers: await listSellers(req.user) });
}));

// @route  GET /staff/attribution/orders/:id — one order (null when not a paid website order)
router.get('/attribution/orders/:id', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await getWebsiteOrder(req.user, req.params.id) });
}));

// @route  PUT /staff/attribution/orders/:id — { salesUserId|null, expectedSalesUserId|null, note? }
router.put('/attribution/orders/:id', validateSetSeller, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await setSeller(req.user, req.params.id, req.body, req) });
}));

// ── Bank transfers (scope enforced in bankTransferService) ──────────────────

// @route  POST /staff/sales/orders/:id/pay-details — multipart: method (bank|upi_qr|other), bank(JSON)?, upiId?, note?, qr(image)?
//         The bank / GPay QR / other way the customer is told to pay. Unpaid orders only.
router.post('/sales/orders/:id/pay-details', concurrentUploadGuard, attachmentSizeGuard, uploadPayDetailsQr, handleAttachmentError,
  validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
    const qr = req.files?.qr?.[0] || null;
    res.json({ success: true, order: await setPayDetails(req.user, req.params.id, req.body, qr, req) });
  }));

// @route  GET /staff/sales/orders/:id/pay-details/qr — the saved QR image (private)
router.get('/sales/orders/:id/pay-details/qr', validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
  const { buffer, contentType } = await readPayDetailsQr(req.user, req.params.id);
  res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(buffer);
}));

// @route  POST /staff/sales/orders/:id/bank-transfer — multipart: amount, reference, paidOn, note?, proof (1–20)
router.post('/sales/orders/:id/bank-transfer', concurrentUploadGuard, attachmentSizeGuard, uploadPaymentProof, handleAttachmentError,
  validateOrderIdParam, validateRequest, asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, transfer: await recordBankTransfer(req.user, req.params.id, req.body, req.files || [], req) });
  }));

// @route  GET /staff/bank-transfers?status=pending|confirmed|rejected|all&cursor=
router.get('/bank-transfers', validateBankTransferList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listBankTransfers(req.user, { status: req.query.status || 'pending', cursor: req.query.cursor })) });
}));

// @route  PUT /staff/bank-transfers/:id { reference?, paidOn?, note? } — correct a pending one
router.put('/bank-transfers/:id', validateBankTransferId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, transfer: await editBankTransfer(req.user, req.params.id, req.body, req) });
}));

// @route  POST /staff/bank-transfers/:id/withdraw { note? } — GTM takes back one recorded by mistake (30 min)
router.post('/bank-transfers/:id/withdraw', validateBankTransferId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, transfer: await withdrawBankTransfer(req.user, req.params.id, req.body, req) });
}));

// @route  GET /staff/bank-transfers/:id
router.get('/bank-transfers/:id', validateBankTransferId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, transfer: await getBankTransfer(req.user, req.params.id) });
}));

// @route  GET /staff/bank-transfers/:id/files/:fileId — a screenshot (private)
router.get('/bank-transfers/:id/files/:fileId', validateBankTransferFile, validateRequest, asyncHandler(async (req, res) => {
  const { buffer, contentType, name } = await getTransferFile(req.user, req.params.id, req.params.fileId);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}));

// @route  POST /staff/bank-transfers/:id/confirm — accounts, admin: the money is in the bank
router.post('/bank-transfers/:id/confirm', validateBankTransferId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, transfer: await confirmBankTransfer(req.user, req.params.id, req) });
}));

// @route  POST /staff/bank-transfers/:id/reject { note } — accounts, admin
router.post('/bank-transfers/:id/reject', validateBankTransferReject, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, transfer: await rejectBankTransfer(req.user, req.params.id, req.body, req) });
}));

// ── Team workflow (scope enforced in teamWorkflowService) ───────────────────

// @route  GET /staff/work?queue=procurement|decisions|refunds|deliveries&cursor=
router.get('/work', validateWorkQueue, validateRequest, asyncHandler(async (req, res) => {
  const { queue, cursor, q, step, source, sort, eta } = req.query;
  res.json({ success: true, ...(await listQueue(req.user, queue, { cursor, q, step, source, sort, eta })) });
}));

// @route  GET /staff/work/orders/:id — one order, with the actions this person may take
router.get('/work/orders/:id', validateWorkOrder, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await getWorkOrder(req.user, req.params.id) });
}));

// @route  GET /staff/work/orders/:id/parcels/:shipmentId/photo — supplier proof (private)
const sendProof = (res, { buffer, contentType, name }) => {
  res.setHeader('Content-Type', contentType);
  if (name) res.setHeader('Content-Disposition', `inline; filename="${String(name).replace(/[^\w.-]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
};

router.get('/work/orders/:id/parcels/:shipmentId/photo', validateWorkParcel, validateRequest, asyncHandler(async (req, res) => {
  sendProof(res, await getProofPhoto(req.user, req.params.id, req.params.shipmentId));
}));

// @route  GET /staff/work/orders/:id/parcels/:shipmentId/photos/:photoId — one proof of several (private; 'legacy' = the old single photo)
router.get('/work/orders/:id/parcels/:shipmentId/photos/:photoId', validateWorkParcelPhoto, validateRequest, asyncHandler(async (req, res) => {
  sendProof(res, await getProofPhoto(req.user, req.params.id, req.params.shipmentId, req.params.photoId));
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/stock  { stock, supplierName? } — procurement
router.post('/work/orders/:id/lines/:itemId/stock', validateStockUpdate, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await setStock(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/payment  { initiated: boolean } — procurement
router.post('/work/orders/:id/lines/:itemId/payment', validatePaymentInitiated, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await setPaymentInitiated(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  PUT /staff/work/orders/:id/parcels/:shipmentId  multipart: courierName?, trackingNumber?, photo[]?, removePhotoIds(JSON)? — correct dispatch details (30 min)
router.put(
  '/work/orders/:id/parcels/:shipmentId',
  concurrentUploadGuard,
  attachmentSizeGuard,
  uploadProofPhotos,
  handleAttachmentError,
  validateEditParcel,
  validateRequest,
  asyncHandler(async (req, res) => {
    const { courierName, trackingNumber, removePhotoIds } = req.body;
    res.json({ success: true, order: await editShipment(req.user, req.params.id, req.params.shipmentId, { courierName, trackingNumber, removePhotoIds }, req.files || [], req) });
  }),
);

// @route  POST /staff/work/orders/:id/ship  multipart: photo[] (1–20), itemIds?, courierName?, trackingNumber? — procurement
router.post(
  '/work/orders/:id/ship',
  concurrentUploadGuard,
  attachmentSizeGuard,
  uploadProofPhotos,
  handleAttachmentError,
  validateShipWithProof,
  validateRequest,
  asyncHandler(async (req, res) => {
    const { itemIds = [], courierName, trackingNumber } = req.body;
    res.json({ success: true, order: await shipWithProof(req.user, req.params.id, { itemIds, courierName, trackingNumber }, req.files || [], req) });
  }),
);

// @route  POST /staff/work/orders/:id/dispatch-own  multipart: courierName, trackingNumber, itemIds?, photo[]? — procurement, our own warehouse
router.post(
  '/work/orders/:id/dispatch-own',
  concurrentUploadGuard,
  attachmentSizeGuard,
  uploadProofPhotos,
  handleAttachmentError,
  validateDispatchOwnStock,
  validateRequest,
  asyncHandler(async (req, res) => {
    const { itemIds = [], courierName, trackingNumber } = req.body;
    res.json({ success: true, order: await dispatchOwnStock(req.user, req.params.id, { itemIds, courierName, trackingNumber }, req.files || [], req) });
  }),
);

// @route  POST /staff/work/orders/:id/lines/:itemId/undo-stock — take back In Stock / Out of Stock (30 min)
router.post('/work/orders/:id/lines/:itemId/undo-stock', validateWorkLineOnly, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await undoStock(req.user, req.params.id, req.params.itemId, req) });
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/undo-decision — take back the customer's decision (30 min)
router.post('/work/orders/:id/lines/:itemId/undo-decision', validateWorkLineOnly, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await undoDecision(req.user, req.params.id, req.params.itemId, req) });
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/decision  { decision: wait|refund, note? } — sales
router.post('/work/orders/:id/lines/:itemId/decision', validateCustomerDecision, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await recordDecision(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/lines/:itemId/refund  { approve, note? } — accounts
router.post('/work/orders/:id/lines/:itemId/refund', validateRefundReview, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await reviewRefund(req.user, req.params.id, req.params.itemId, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/refunds/:cancellationId/send — accounts: retry a refund that failed
router.post('/work/orders/:id/refunds/:cancellationId/send', validateRefundRetry, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await retryRefund(req.user, req.params.id, req.params.cancellationId, req) });
}));

// @route  POST /staff/work/orders/:id/delivered  { shipmentId? } — operations
router.post('/work/orders/:id/delivered', validateMarkDelivered, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await markDelivered(req.user, req.params.id, req.body, req) });
}));

// @route  POST /staff/work/orders/:id/parcels/:shipmentId/steps  { status, note?, expectedSteps } — operations: courier progress
router.post('/work/orders/:id/parcels/:shipmentId/steps', validateParcelStep, validateRequest, asyncHandler(async (req, res) => {
  const { status, note, expectedSteps } = req.body;
  res.json({ success: true, order: await addParcelStep(req.user, req.params.id, req.params.shipmentId, { status, note, expectedSteps }, req) });
}));

// @route  PUT /staff/work/orders/:id/parcels/:shipmentId/eta  { date: 'YYYY-MM-DD', previousDate? } — procurement / operations: expected delivery date
router.put('/work/orders/:id/parcels/:shipmentId/eta', validateParcelEta, validateRequest, asyncHandler(async (req, res) => {
  const { date, previousDate } = req.body;
  res.json({ success: true, order: await setParcelEta(req.user, req.params.id, req.params.shipmentId, { date, previousDate }, req) });
}));

// @route  POST /staff/work/orders/:id/undo-delivered  { shipmentId } — operations / admin: back in transit
router.post('/work/orders/:id/undo-delivered', validateUndoDelivered, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, order: await undoDelivered(req.user, req.params.id, req.body, req) });
}));

// ── Customer bank details for refunds / NEFT (never cards) ─────────────────────
// Reached through a quotation or an order the person may handle; masked, except
// for accounts / admin asking for ?reveal=1 (audit-logged).
// @route  GET    /staff/customer-bank/:kind(quotation|order)/:id
// @route  PUT    /staff/customer-bank/:kind/:id  { accountName, accountNumber, confirmAccountNumber?, ifsc, bankName? }
// @route  DELETE /staff/customer-bank/:kind/:id
router.get('/customer-bank/:kind/:id', validateCustomerBankRead, validateRequest, asyncHandler(async (req, res) => {
  const reveal = ['1', 'true'].includes(String(req.query.reveal || ''));
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await getBankAccount(req.user, req.params.kind, req.params.id, { reveal }, req)) });
}));
router.put('/customer-bank/:kind/:id', validateCustomerBankSave, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await saveBankAccount(req.user, req.params.kind, req.params.id, req.body, req)) });
}));
router.delete('/customer-bank/:kind/:id', validateCustomerBankRemove, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await removeBankAccount(req.user, req.params.kind, req.params.id, req)) });
}));

export default router;
