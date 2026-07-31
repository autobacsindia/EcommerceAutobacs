/**
 * Return / Refund controller.
 *
 * Implements the signed Roavion "Return, Refund & Cancellation Policy" (v1.0):
 *   - 4-day return window from delivery (config/returnPolicy.js).
 *   - Only Roavion-fault reasons: wrong item / transit damage / manufacturing defect.
 *   - Non-returnable classes (electrical, custom, imported, installed) blocked
 *     up front via Product.returnPolicy.returnable.
 *   - Mandatory documentation: continuous unboxing video + proof of purchase +
 *     problem description. Uploads land privately in Cloudinary and are
 *     RE-VALIDATED server-side (see utils/returnsCloudinary.js); a missing/invalid
 *     asset rejects the submission ("all three required or rejected").
 *   - Flow: pending → approved → courier_booked → received → (inspection) → refunded/rejected.
 *   - Refund is decided BY HAND at initiation (full, or minus shipping / restocking),
 *     and always paid to the ORIGINAL payment method via a partial Razorpay refund.
 *     Exchanges + store-credit were dropped by operations (2026-07-31).
 */

import crypto from 'crypto';
import asyncHandler from '../middleware/asyncHandler.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import razorpayService from '../services/razorpayService.js';
import { reverseReturnLtvOnce } from '../services/returnRefundLtvService.js';
import { enqueueNotification } from '../queue/queues.js';
import {
  RETURN_WINDOW_DAYS,
  RETURN_REASONS,
  ACTIVE_RETURN_STATUSES,
  suggestedRestockingRupees,
} from '../config/returnPolicy.js';
import {
  RETURNS_FOLDER_BASE,
  generateReturnUploadSignature,
  getReturnResource,
  signedReturnAssetUrl,
  resourceFormat,
} from '../utils/returnsCloudinary.js';
import * as Sentry from '@sentry/node';

const MB = 1024 * 1024;
const VIDEO_MAX_BYTES = 60 * MB;
const PROOF_MAX_BYTES = 15 * MB;
const PHOTO_MAX_BYTES = 10 * MB;
const MAX_PHOTOS = 5;

const VIDEO_FORMATS = ['mp4', 'mov', 'webm', 'm4v', 'ogv', 'ogg', '3gp', '3gpp', 'avi', 'mkv', 'quicktime', 'x-matroska', 'mpeg', 'mpg'];
const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const PROOF_FORMATS = [...IMAGE_FORMATS, 'pdf'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Round rupees to 2dp so refund math never carries float dust. */
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Exact (fractional) days elapsed since a timestamp. NOT floored: the return-window
 * check is a continuous cutoff, so `daysSince(deliveredAt) > RETURN_WINDOW_DAYS`
 * rejects at RETURN_WINDOW_DAYS×24h + ε. Flooring here would round 4d23h down to 4
 * and silently extend the 4-day window to nearly 5. (Mirrors the fractional-days
 * pattern used for the 30-day cancellation check in orderController.)
 */
const daysSince = (date) => (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);

/** Push a timeline entry + set status on a loaded return. */
const transition = (rr, status, note, userId) => {
  rr.status = status;
  rr.timeline.push({ status, note, updatedBy: userId, timestamp: new Date() });
};

/**
 * Validate ONE client-declared asset against Cloudinary. The only value trusted
 * from the client is publicId (+ a constrained resourceType); size/format are
 * re-read server-side. Returns { publicId, resourceType, bytes } or throws a
 * response-shaped Error via `fail`.
 */
const validateAsset = async (raw, { label, allowedResourceTypes, maxBytes, formats, capLabel }) => {
  if (!raw || typeof raw !== 'object') return null;
  const publicId = typeof raw.publicId === 'string' ? raw.publicId.trim() : '';
  if (!publicId) return null;

  let resourceType = typeof raw.resourceType === 'string' ? raw.resourceType.trim() : allowedResourceTypes[0];
  if (!allowedResourceTypes.includes(resourceType)) {
    const e = new Error(`${label}: invalid upload type.`); e.statusCode = 400; throw e;
  }
  // Must live under our returns folder — blocks attaching a foreign asset by id.
  if (!publicId.startsWith(`${RETURNS_FOLDER_BASE}/`)) {
    const e = new Error(`${label}: invalid upload reference.`); e.statusCode = 400; throw e;
  }

  const resource = await getReturnResource(publicId, resourceType);
  if (!resource) {
    const e = new Error(`${label}: upload could not be verified. Please re-upload.`); e.statusCode = 400; throw e;
  }
  if (resource.bytes > maxBytes) {
    const e = new Error(`${label} exceeds the ${capLabel} limit.`); e.statusCode = 400; throw e;
  }
  const fmt = resourceFormat(resource, publicId);
  if (formats && !formats.includes(fmt)) {
    const e = new Error(`${label}: unsupported file type.`); e.statusCode = 400; throw e;
  }
  return { publicId, resourceType, bytes: resource.bytes };
};

/** Signed, viewable copies of a return's private evidence (admin only). */
const withSignedEvidence = (rr) => {
  const sign = (a) => (a?.publicId ? { url: signedReturnAssetUrl(a.publicId, a.resourceType), bytes: a.bytes || 0, resourceType: a.resourceType } : null);
  return {
    ...rr,
    video: sign(rr.video),
    proofOfPurchase: sign(rr.proofOfPurchase),
    images: Array.isArray(rr.images) ? rr.images.map(sign).filter(Boolean) : [],
  };
};

// ── Public / customer ─────────────────────────────────────────────────────────

// @desc    Issue a signed params set for direct browser→Cloudinary return uploads
// @route   POST /returns/upload-signature
// @access  Private
export const getReturnUploadSignature = asyncHandler(async (_req, res) => {
  // Server-chosen unguessable subfolder — the client never picks the folder, so
  // it can only ever write inside autobacs/returns/<nonce>.
  const nonce = crypto.randomBytes(12).toString('hex');
  const folder = `${RETURNS_FOLDER_BASE}/${nonce}`;
  res.json({ success: true, ...generateReturnUploadSignature({ folder }) });
});

// @desc    Create a return request
// @route   POST /returns
// @access  Private
export const createReturnRequest = asyncHandler(async (req, res) => {
  const { orderId, items, problemDescription, video, proofOfPurchase, images } = req.body;
  const userId = req.user._id;

  const order = await orderRepository.findOwnedWithProducts(orderId, userId);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  // `returned` is accepted alongside `delivered` because an APPROVED return now moves
  // the order onto the `returned` fulfillment stage (orderRepository.markReturnedOnReturnApproval).
  // A multi-line order must still be able to raise a return for a DIFFERENT item while
  // the first one is in flight — the 4-day window below and the per-product active-return
  // guard further down are what actually bound eligibility.
  if (!['delivered', 'returned'].includes(order.status)) {
    res.status(400);
    throw new Error('Only delivered orders can be returned.');
  }

  // 1) 4-day window from delivery.
  const deliveredAt = order.fulfillmentMetrics?.deliveredAt || order.deliveredAt || order.updatedAt;
  if (daysSince(deliveredAt) > RETURN_WINDOW_DAYS) {
    res.status(400);
    throw new Error(`Return window closed. Returns must be raised within ${RETURN_WINDOW_DAYS} days of delivery.`);
  }

  // 2) Validate + snapshot each requested line.
  const returnItems = [];
  for (const item of items || []) {
    const orderLine = order.items.find((oi) => String(oi.product?._id || oi.product) === String(item.productId));
    if (!orderLine) {
      res.status(400);
      throw new Error('One of the selected items is not part of this order.');
    }
    if (!RETURN_REASONS.includes(item.reason)) {
      res.status(400);
      throw new Error('Returns are only accepted for a wrong item, transit damage, or a manufacturing defect.');
    }
    // Non-returnable classes (electrical/custom/imported/installed) are blocked.
    const product = orderLine.product;
    if (product?.returnPolicy && product.returnPolicy.returnable === false) {
      res.status(400);
      throw new Error(`"${product.name}" is not eligible for return under our policy.`);
    }
    const qty = Math.min(Number(item.quantity) || 1, orderLine.quantity);
    // DB unique index is the race-safe backstop; this gives a friendly message.
    // Uses the SAME active-status set as the index partial filter so the two agree.
    const existing = await returnRequestRepository.findOne({
      order: orderId,
      'items.product': item.productId,
      status: { $in: ACTIVE_RETURN_STATUSES },
    });
    if (existing) {
      res.status(409);
      throw new Error(`A return request already exists for "${product?.name || 'this item'}".`);
    }
    returnItems.push({
      product: item.productId,
      variantId: orderLine.variantId || null,
      quantity: qty,
      reason: item.reason,
      unitPrice: money(orderLine.price),
    });
  }

  if (returnItems.length === 0) {
    res.status(400);
    throw new Error('Select at least one item to return.');
  }

  // 3) Mandatory documentation — all three, or reject.
  const desc = typeof problemDescription === 'string' ? problemDescription.trim() : '';
  if (!desc) {
    res.status(400);
    throw new Error('A description of the problem is required.');
  }
  const videoAsset = await validateAsset(video, {
    label: 'Unboxing video', allowedResourceTypes: ['video'], maxBytes: VIDEO_MAX_BYTES, formats: VIDEO_FORMATS, capLabel: '60MB',
  });
  if (!videoAsset) {
    res.status(400);
    throw new Error('A continuous unboxing video is required.');
  }
  const proofAsset = await validateAsset(proofOfPurchase, {
    label: 'Proof of purchase', allowedResourceTypes: ['image', 'raw'], maxBytes: PROOF_MAX_BYTES, formats: PROOF_FORMATS, capLabel: '15MB',
  });
  if (!proofAsset) {
    res.status(400);
    throw new Error('Proof of purchase (invoice or payment confirmation) is required.');
  }
  // Optional extra photos.
  const photoAssets = [];
  for (const raw of (Array.isArray(images) ? images.slice(0, MAX_PHOTOS) : [])) {
    const a = await validateAsset(raw, {
      label: 'Photo', allowedResourceTypes: ['image'], maxBytes: PHOTO_MAX_BYTES, formats: IMAGE_FORMATS, capLabel: '10MB',
    });
    if (a) photoAssets.push(a);
  }

  const productValue = money(returnItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0));

  const returnRequest = await returnRequestRepository.create({
    order: orderId,
    user: userId,
    items: returnItems,
    type: 'return',
    status: 'pending',
    problemDescription: desc,
    video: videoAsset,
    proofOfPurchase: proofAsset,
    images: photoAssets,
    refund: { productValue, finalAmount: productValue, method: 'original_payment', status: 'pending' },
    timeline: [{ status: 'pending', note: 'Return request submitted', updatedBy: userId }],
  });

  // Mirror a lightweight summary onto the order for the order-detail screen.
  order.returnRequest = {
    requestedAt: new Date(),
    requestedBy: userId,
    status: 'pending',
    items: returnItems.map((it) => ({ product: it.product, quantity: it.quantity, reason: it.reason })),
  };
  await order.save();

  // Notify the customer (received, 3–5 day review) + the support inbox. Async,
  // best-effort — never block the submit on email.
  const returnId = returnRequest._id.toString();
  enqueueNotification('send-return-submitted', { returnId });
  enqueueNotification('send-admin-return-alert', { returnId });

  res.status(201).json({ success: true, request: returnRequest });
});

// @desc    Get my return requests
// @route   GET /returns/my-returns
// @access  Private
export const getMyReturns = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  const skip = (page - 1) * limit;

  const total = await returnRequestRepository.countDocuments({ user: req.user._id });
  const returns = await returnRequestRepository.find({ user: req.user._id })
    .populate('order', 'orderNumber')
    .populate('items.product', 'name images price')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Customers never see the private evidence URLs back — strip the raw refs.
  const sanitized = returns.map(({ video, proofOfPurchase, images, ...rest }) => ({
    ...rest,
    hasVideo: !!video?.publicId,
    hasProof: !!proofOfPurchase?.publicId,
    photoCount: Array.isArray(images) ? images.length : 0,
  }));

  res.json({
    success: true,
    count: total,
    requests: sanitized,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalRequests: total,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  });
});

// @desc    Cancel (withdraw) my own return request
// @route   PATCH /returns/:id/cancel
// @access  Private
export const cancelMyReturn = asyncHandler(async (req, res) => {
  const rr = await returnRequestRepository.findById(req.params.id);
  if (!rr || String(rr.user) !== String(req.user._id)) {
    res.status(404);
    throw new Error('Return request not found');
  }
  // Only before the courier is booked — once we've arranged pickup it's in motion.
  if (!['pending', 'approved'].includes(rr.status)) {
    res.status(400);
    throw new Error('This request can no longer be cancelled.');
  }
  transition(rr, 'cancelled', 'Cancelled by customer', req.user._id);
  await returnRequestRepository.save(rr);
  await orderRepository.setReturnRequestStatus(rr.order, 'cancelled');
  // Withdrawing an APPROVED return leaves the customer holding the goods — put the
  // order back to `delivered` (no-op when the return was still `pending`).
  await orderRepository.revertReturnToDelivered(rr.order, req.user._id, `Return ${rr._id} withdrawn by customer`);
  res.json({ success: true, request: rr });
});

// ── Admin ──────────────────────────────────────────────────────────────────────

// @desc    Get all return requests (Admin)
// @route   GET /returns/admin/all
// @access  Private/Admin
export const getAllReturns = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const query = {};
  if (req.query.status && req.query.status !== 'all') query.status = req.query.status;

  const total = await returnRequestRepository.countDocuments(query);
  const returns = await returnRequestRepository.find(query)
    .populate('user', 'name email')
    .populate('order', 'orderNumber')
    .populate('items.product', 'name images')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.json({
    success: true,
    count: total,
    requests: returns,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalReturns: total,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  });
});

// @desc    Get one return with signed evidence URLs (Admin)
// @route   GET /returns/admin/:id
// @access  Private/Admin
export const getReturnById = asyncHandler(async (req, res) => {
  const rr = await returnRequestRepository.findById(req.params.id)
    .populate('user', 'name email')
    .populate('order', 'orderNumber totalAmount')
    .populate('items.product', 'name images price')
    .lean();
  if (!rr) {
    res.status(404);
    throw new Error('Return request not found');
  }
  res.json({ success: true, request: withSignedEvidence(rr) });
});

// @desc    Approve or reject a return at review (Admin)
// @route   PATCH /returns/admin/:id/review
// @access  Private/Admin
export const reviewReturn = asyncHandler(async (req, res) => {
  const { decision, adminNotes, rejectionReason, shippingBorneBy } = req.body;
  const rr = await returnRequestRepository.findById(req.params.id).populate('user', 'email name');
  if (!rr) {
    res.status(404);
    throw new Error('Return request not found');
  }
  if (rr.status !== 'pending') {
    res.status(400);
    throw new Error(`Only a pending request can be reviewed (this one is "${rr.status}").`);
  }
  if (adminNotes) rr.adminNotes = adminNotes;

  if (decision === 'approve') {
    // Default: all accepted reasons are Roavion-fault → we bear the courier.
    if (shippingBorneBy && ['roavion', 'customer'].includes(shippingBorneBy)) rr.shippingBorneBy = shippingBorneBy;
    transition(rr, 'approved', adminNotes || 'Approved — return courier will be arranged', req.user._id);
    await returnRequestRepository.save(rr);
    await orderRepository.setReturnRequestStatus(rr.order, 'approved');
    // Fulfillment axis follows the approval: the Orders column reads "Returned", not a
    // stale "Delivered", for the whole return-in-flight period. Payment/karma/customer
    // email are untouched here — see orderRepository.markReturnedOnReturnApproval.
    await orderRepository.markReturnedOnReturnApproval(rr.order, req.user._id, `Return ${rr._id} approved`);
    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'approved' });
  } else if (decision === 'reject') {
    if (!rejectionReason) {
      res.status(400);
      throw new Error('A rejection reason is required.');
    }
    rr.rejectionReason = rejectionReason;
    transition(rr, 'rejected', rejectionReason, req.user._id);
    await returnRequestRepository.save(rr);
    await orderRepository.setReturnRequestStatus(rr.order, 'rejected');
    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'rejected' });
  } else {
    res.status(400);
    throw new Error('Decision must be "approve" or "reject".');
  }

  res.json({ success: true, request: rr });
});

// @desc    Record that the return courier has been booked (Admin)
// @route   PATCH /returns/admin/:id/courier
// @access  Private/Admin
export const bookCourier = asyncHandler(async (req, res) => {
  const { provider, trackingNumber } = req.body;
  const rr = await returnRequestRepository.findById(req.params.id);
  if (!rr) {
    res.status(404);
    throw new Error('Return request not found');
  }
  if (rr.status !== 'approved') {
    res.status(400);
    throw new Error('Book the courier only after the request is approved.');
  }
  rr.courier = {
    provider: provider || rr.courier?.provider,
    trackingNumber: trackingNumber || rr.courier?.trackingNumber,
    bookedAt: new Date(),
    bookedBy: req.user._id,
  };
  transition(rr, 'courier_booked', `Pickup arranged${trackingNumber ? ` (AWB ${trackingNumber})` : ''}`, req.user._id);
  await returnRequestRepository.save(rr);
  await orderRepository.setReturnRequestStatus(rr.order, 'approved');
  res.json({ success: true, request: rr });
});

// @desc    Mark the returned item received at the warehouse (Admin)
// @route   PATCH /returns/admin/:id/received
// @access  Private/Admin
export const markReceived = asyncHandler(async (req, res) => {
  const rr = await returnRequestRepository.findById(req.params.id).populate('user', 'email name');
  if (!rr) {
    res.status(404);
    throw new Error('Return request not found');
  }
  if (!['courier_booked', 'approved'].includes(rr.status)) {
    res.status(400);
    throw new Error('The item can only be marked received after the courier is booked.');
  }
  transition(rr, 'received', 'Item received at warehouse — pending inspection', req.user._id);
  await returnRequestRepository.save(rr);
  await orderRepository.setReturnRequestStatus(rr.order, 'item_received');
  enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'received' });
  res.json({ success: true, request: rr });
});

// @desc    Record the warehouse inspection outcome (Admin)
// @route   PATCH /returns/admin/:id/inspection
// @access  Private/Admin
export const recordInspection = asyncHandler(async (req, res) => {
  const { passed, notes } = req.body;
  const rr = await returnRequestRepository.findById(req.params.id).populate('user', 'email name');
  if (!rr) {
    res.status(404);
    throw new Error('Return request not found');
  }
  if (rr.status !== 'received') {
    res.status(400);
    throw new Error('Inspection can only be recorded after the item is received.');
  }
  rr.inspection = { passed: !!passed, notes: notes || '', at: new Date(), by: req.user._id };

  if (!passed) {
    const reason = notes || 'Item failed inspection';
    rr.rejectionReason = reason;
    transition(rr, 'rejected', `Failed inspection: ${reason}`, req.user._id);
    await returnRequestRepository.save(rr);
    await orderRepository.setReturnRequestStatus(rr.order, 'rejected');
    // The goods go back to the customer, so undo the approval-time `returned` flip —
    // no-ops for a return that never reached approval or already refunded.
    await orderRepository.revertReturnToDelivered(rr.order, req.user._id, `Return ${rr._id} failed inspection`);
    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'rejected' });
    return res.json({ success: true, request: rr });
  }

  // Passed: stay in `received` with inspection recorded; operations initiates the
  // refund as the explicit next step (so the amount is a deliberate decision).
  rr.timeline.push({ status: 'received', note: 'Passed inspection — ready for refund', updatedBy: req.user._id, timestamp: new Date() });
  await returnRequestRepository.save(rr);
  res.json({ success: true, request: rr });
});

// @desc    Preview the suggested refund breakdown (Admin)
// @route   GET /returns/admin/:id/refund-preview
// @access  Private/Admin
export const refundPreview = asyncHandler(async (req, res) => {
  const rr = await returnRequestRepository.findById(req.params.id).populate('items.product', 'name');
  if (!rr) {
    res.status(404);
    throw new Error('Return request not found');
  }
  // Suggested restocking = sum of the price-threshold limb over returned lines.
  const suggestedRestocking = money(
    rr.items.reduce((sum, it) => sum + suggestedRestockingRupees(it.unitPrice, it.quantity), 0)
  );
  res.json({
    success: true,
    preview: {
      productValue: rr.refund.productValue,
      suggestedRestocking, // operator may accept, change, or zero this
      shippingDeductionDefault: rr.shippingBorneBy === 'customer' ? null : 0,
      note: 'Original delivery charge is never refunded. Restocking (10%) suggested for items over ₹1,00,000; add manually for oversized items. Enter the actual return-shipping cost to deduct when the customer bears it.',
    },
  });
});

// @desc    Initiate the refund to the original payment method (Admin)
// @route   POST /returns/admin/:id/refund
// @access  Private/Admin
export const initiateReturnRefund = asyncHandler(async (req, res) => {
  const existing = await returnRequestRepository.findById(req.params.id);
  if (!existing) {
    res.status(404);
    throw new Error('Return request not found');
  }
  // Friendly pre-checks for a fast, readable 4xx. These are NOT the real guard —
  // the atomic claimForRefund() below is what actually serializes concurrent
  // requests; these just avoid doing work / returning an opaque 409 in the common case.
  if (existing.status !== 'received' || existing.inspection?.passed !== true) {
    res.status(400);
    throw new Error('Refund can only be initiated after the item is received and passes inspection.');
  }
  if (['processing', 'completed'].includes(existing.refund?.status)) {
    res.status(409);
    throw new Error(`A refund for this return is already ${existing.refund.status}.`);
  }

  const shippingDeduction = money(Math.max(0, Number(req.body.shippingDeduction) || 0));
  const restockingDeduction = money(Math.max(0, Number(req.body.restockingDeduction) || 0));
  const productValue = existing.refund.productValue;
  const finalAmount = money(productValue - shippingDeduction - restockingDeduction);

  // finalAmount can only be ≤ productValue (both deductions are clamped ≥ 0), so the
  // only real bound to assert is that something is left to refund after deductions.
  if (finalAmount <= 0) {
    res.status(400);
    throw new Error('The refund amount after deductions must be greater than ₹0.');
  }

  // Resolve the captured Razorpay payment on the order BEFORE claiming, so an order
  // that can't be refunded online never leaves a return stranded in `processing`.
  const order = await orderRepository.findById(existing.order);
  if (!order || order.paymentStatus !== 'paid') {
    res.status(422);
    throw new Error('This order has no captured online payment to refund. Refund manually.');
  }
  const payment = order.payment ? await paymentRepository.findById(order.payment) : null;
  if (!payment || !payment.gatewayPaymentId) {
    res.status(422);
    throw new Error('No Razorpay payment id on file — refund manually in the dashboard.');
  }
  const amountPaise = Math.round(finalAmount * 100);

  // Atomically claim the refund into `processing` (the serialization point) BEFORE
  // touching the gateway. A double-click / two-admin race resolves to a single
  // winner here; the loser matches zero docs, gets null, and 409s — never firing a
  // second Razorpay refund. `rr` is the freshly-claimed document we mutate below.
  const rr = await returnRequestRepository.claimForRefund(req.params.id, {
    shippingDeduction, restockingDeduction, finalAmount, initiatedBy: req.user._id,
  });
  if (!rr) {
    res.status(409);
    throw new Error('This refund is already being processed.');
  }

  try {
    const result = await razorpayService.refundPayment(payment.gatewayPaymentId, amountPaise, {
      orderId: order._id.toString(),
      returnId: rr._id.toString(), // authoritative reconciliation target for the webhook
      reason: `return_refund:${rr._id}`,
    });
    const completed = result.status === 'processed';
    rr.refund.razorpayRefundId = result.refundId;
    rr.refund.status = completed ? 'completed' : 'processing';
    if (completed) rr.refund.completedAt = new Date();
    transition(rr, 'refunded', `Refund ${completed ? 'completed' : 'initiated'} — ₹${finalAmount} to original payment`, req.user._id);
    await returnRequestRepository.save(rr);

    // Mirror THIS refund onto the order as a best-effort LATEST-refund summary. It is
    // deliberately NOT authoritative: an order can have several returns and this single
    // subdoc can only hold one, so a later return overwrites it. The durable per-return
    // record lives on ReturnRequest.refund (keyed by razorpayRefundId), which is what the
    // refund.* webhook reconciles via notes.returnId. Same applies to order.returnRequest.
    order.refundDetails = {
      requestedAt: rr.refund.initiatedAt,
      amount: finalAmount,
      refundType: finalAmount >= order.totalAmount ? 'full' : 'partial',
      refundMethod: 'original_payment',
      itemsRefunded: rr.items.map((it) => ({ product: it.product, quantity: it.quantity, amount: money(it.unitPrice * it.quantity) })),
      status: completed ? 'completed' : 'processing',
      processedBy: req.user._id,
      processedAt: completed ? new Date() : undefined,
      transactionId: result.refundId,
      notes: `Return ${rr._id}`,
    };
    await order.save();
    await orderRepository.setReturnRequestStatus(rr.order, 'refund_processed');

    // Net-LTV reversal only when the money has actually left (instant/optimum refunds
    // come back `processed`). For a normal-speed refund it stays `processing` here and
    // the refund.processed webhook does the reversal instead — the once-only claim
    // inside reverseReturnLtvOnce makes the two paths mutually exclusive.
    if (completed) await reverseReturnLtvOnce(rr._id.toString());

    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'refunded' });
    enqueueNotification('send-admin-return-refunded-alert', { returnId: rr._id.toString() });

    return res.json({
      success: true,
      message: completed ? 'Refund completed.' : 'Refund initiated — funds typically settle in 5–9 business days.',
      refund: { id: result.refundId, status: rr.refund.status, amount: finalAmount },
      request: rr,
    });
  } catch (err) {
    rr.refund.status = 'failed';
    rr.refund.failureReason = err.message;
    await returnRequestRepository.save(rr);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('return_refund', { returnId: rr._id.toString(), orderId: String(rr.order), amountPaise });
        scope.setTag('payment_action', 'return_refund');
        scope.setTag('severity', 'high');
        Sentry.captureException(err);
      });
    }
    res.status(502);
    throw new Error(`Refund failed at the gateway: ${err.message}`);
  }
});
