/**
 * Return / Refund controller.
 *
 * The storefront and admin return routes. The rules live in services/returnService.js
 * (owner-approved, 2026-10-30), shared with the team panel so there is ONE return system:
 *   - each line carries a reason that claims a FAULT; 7 days from delivery for our fault,
 *     4 for the customer's own reason (unused, uninstalled, in the box, returnable product);
 *   - evidence: a photo always; a video for transit damage or a line over ₹10,000;
 *   - flow: pending → approved → courier_booked → received → (inspection) → refunded/rejected.
 *     The courier step cannot be skipped on the admin route: the AWB is our claim handle.
 *   - the refund is computed by the server from the order (services/returnRefundService.js)
 *     and paid to the original payment method, or recorded as paid by an admin.
 *     Exchanges + store-credit were dropped by operations (2026-07-31).
 *
 * MONEY: every rupee figure here comes from services/refundMathService.js. Order lines
 * store LIST prices; coupon/karma discounts live at order level, so the gross line sum
 * is NOT what the customer paid. Refunding it over-refunds silently on small discounts
 * and is rejected by Razorpay on large ones ("refund amount ... greater than amount
 * captured"). Both were live until 2026-08-03. Never compute a refund inline here.
 *
 * ERRORS: throw AppError(message, status) — never `res.status(n); throw new Error()`.
 * errorMiddleware derives the HTTP status from `err.statusCode` only and ignores any
 * status already set on `res`, so the bare-Error form silently returned 500 for every
 * business rejection in this file (and paged on-call for each one).
 */

import mongoose from 'mongoose';
import asyncHandler from '../middleware/asyncHandler.js';
import AppError from '../utils/AppError.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { reverseRefundSideEffects } from '../services/refundReversalService.js';
import auditLogger from '../services/auditLogger.js';
import { refundableForLines, matchOrderLine } from '../services/refundMathService.js';
import { previewRefund, initiateRefund, money, transition } from '../services/returnRefundService.js';
import { syncOrderReturnedStatus, phoneKey, createCustomerReturn, estimateForCustomer } from '../services/returnService.js';
import { toPaise } from '../utils/money.js';
import { enqueueNotification } from '../queue/queues.js';
import {
  RETURN_REASONS,
  IN_FLIGHT_RETURN_STATUSES,
  claimedFaultFor,
} from '../config/returnPolicy.js';
import { uploadTargets, withSignedEvidence } from '../services/returnEvidence.js';

// syncOrderReturnedStatus (the coverage-checked flip to `returned`) is shared with the
// team panel and lives in services/returnService.js with its reasoning.




// ── Public / customer ─────────────────────────────────────────────────────────

// @desc    Issue a signed params set for direct browser→Cloudinary return uploads
// @route   POST /returns/upload-signature
// @access  Private
/*
  A DISCRIMINATED UNION on `provider`, matching the admin and careers upload
  endpoints. Cloudinary signs a FOLDER once and every file reuses it; R2 presigns
  ONE PUT per object key and so must be told which slots are coming. The client
  branches on `provider` rather than sniffing which fields exist.

  `STORAGE_PROVIDER` is read per request, so flipping it is an env change plus a
  restart — and flipping back is the rollback. Evidence uploaded under either
  provider stays readable, because each stored asset carries its own `provider`.
*/
export const getReturnUploadSignature = asyncHandler(async (req, res) => {
  // Server-chosen unguessable subfolder — the client never picks the folder, so
  // it can only ever write inside autobacs/returns/<nonce>.
  res.json({ success: true, ...(await uploadTargets(req.body?.files)) });
});

// @desc    Create a return request
// @route   POST /returns
// @access  Private
export const createReturnRequest = asyncHandler(async (req, res) => {
  // The same rules as a staff-raised return (services/returnService.buildLines): reasons
  // with their fault, 7 days for our fault / 4 for the customer's reason, the
  // non-returnable list for customer reasons only, quantity bounded by what was
  // DELIVERED and not yet claimed, the debit-card-EMI all-or-nothing rule, and the
  // evidence rule (a photo always; a video for transit damage or a line over ₹10,000).
  const returnRequest = await createCustomerReturn(req.user, req.body, req);
  res.status(201).json({ success: true, request: returnRequest });
});

// @desc    What the customer would roughly get back for these lines (no deductions)
// @route   POST /returns/estimate
// @access  Private
export const estimateReturn = asyncHandler(async (req, res) => {
  res.json({ success: true, estimate: await estimateForCustomer(req.user, req.body) });
});

// @desc    Get my return requests
// @route   GET /returns/my-returns
// @access  Private
export const getMyReturns = asyncHandler(async (req, res) => {
  /*
    ?orderId= — every return on ONE of the customer's orders, for the per-request
    tracker on the order page. Bounded (an order has a handful of returns at most), so
    no paging: one keyed read on (user, order).
  */
  if (req.query.orderId) {
    if (!mongoose.isValidObjectId(String(req.query.orderId))) throw new AppError('Invalid order', 400);
    const rows = await returnRequestRepository.find({ user: req.user._id, order: req.query.orderId })
      .populate('items.product', 'name images')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, requests: rows.map(customerView) });
  }

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

  res.json({
    success: true,
    count: total,
    requests: returns.map(customerView),
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalRequests: total,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  });
});

/**
 * What a customer may see of their own return. Never the private evidence (only that it
 * exists), never staff notes, supplier claims or internal files — and the refund only
 * as the money that concerns them.
 */
function customerView(rr) {
  const refund = rr.refund || {};
  return {
    _id: rr._id,
    order: rr.order,
    status: rr.status,
    createdAt: rr.createdAt,
    updatedAt: rr.updatedAt,
    problemDescription: rr.problemDescription,
    rejectionReason: rr.rejectionReason || null,
    items: (rr.items || []).map((i) => ({
      orderItemId: i.orderItemId || null,
      product: i.product,
      variantLabel: i.variantLabel || null,
      quantity: i.quantity,
      reason: i.reason,
      unitPrice: i.unitPrice,
      fault: i.fault?.confirmed || i.fault?.claimed || claimedFaultFor(i.reason),
    })),
    courier: rr.courier?.trackingNumber ? { provider: rr.courier.provider, trackingNumber: rr.courier.trackingNumber } : null,
    pickupMode: rr.pickup?.mode || null,
    inspection: rr.inspection?.passed == null ? null : { passed: rr.inspection.passed },
    refund: {
      status: refund.status || 'pending',
      finalAmount: ['processing', 'completed'].includes(refund.status) ? refund.finalAmount : null,
      productValue: refund.productValue || 0,
      shippingShare: refund.shippingShare || 0,
      installation: (refund.serviceLines || []).reduce((sum, l) => sum + (l.amountPaise || 0), 0) / 100,
      pickupDeduction: refund.pickupDeduction || refund.shippingDeduction || 0,
      method: refund.method || 'original_payment',
    },
    timeline: (rr.timeline || []).map((t) => ({ status: t.status, timestamp: t.timestamp })),
    hasVideo: !!rr.video?.publicId,
    hasProof: !!rr.proofOfPurchase?.publicId,
    photoCount: Array.isArray(rr.images) ? rr.images.length : 0,
  };
}

// @desc    Cancel (withdraw) my own return request
// @route   PATCH /returns/:id/cancel
// @access  Private
export const cancelMyReturn = asyncHandler(async (req, res) => {
  const rr = await returnRequestRepository.findById(req.params.id);
  if (!rr || String(rr.user) !== String(req.user._id)) {
    throw new AppError('Return request not found', 404);
  }
  // Only before the courier is booked — once we've arranged pickup it's in motion.
  if (!['pending', 'approved'].includes(rr.status)) {
    throw new AppError('This request can no longer be cancelled.', 400);
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
    throw new AppError('Return request not found', 404);
  }
  res.json({ success: true, request: await withSignedEvidence(rr) });
});

// ── Offline (handled off-platform) ────────────────────────────────────────────
//
// Both handlers below exist for returns that never touched the storefront: the
// customer walked in, called, or dealt with a sales rep, and an admin is RECORDING
// what already happened rather than driving it.
//
// What they deliberately skip: the 4-day window, the mandatory unboxing video and
// proof of purchase, the non-returnable product classes, the `delivered` order-status
// gate, and the courier + inspection steps. None of those can be satisfied after the
// fact, and refusing on them would just push operations into editing Mongo by hand.
//
// What they deliberately KEEP — these are arithmetic, not policy:
//   - the refund base is recomputed server-side from the order (refundableForLines);
//   - one active return per (order, product), which is a unique index, not a check;
//   - the headroom cap in initiateReturnRefund, so cash + gateway refunds together can
//     never exceed what the order captured.
// Every offline action is written to the audit log with the operator's note.

/**
 * Snapshot the returned lines off an order. Shape/arithmetic only — no policy.
 *
 * Resolution goes through refundMathService.matchOrderLine, the same matcher the refund
 * arithmetic uses, so the line this snapshots is the line the money is later computed
 * from. Matching on product id alone is NOT sufficient: an order may legitimately carry
 * the same product on two lines (two variants of one variable product — 415 variants are
 * live), and taking the first match silently snapshots the wrong variant, the wrong
 * charged price, and the wrong quantity cap. The caller passes `itemId` (the order line's
 * own _id, the unambiguous handle) and/or `variantId`; product id is only the fallback.
 */
const snapshotReturnLines = (order, items) => {
  const seen = new Set();
  const lines = [];
  for (const item of items || []) {
    const orderLine = matchOrderLine(order.items, {
      itemId: item.itemId,
      product: item.productId,
      variantId: item.variantId,
    });
    if (!orderLine) {
      throw new AppError('One of the selected items is not part of this order.', 400);
    }
    // Dedupe on the resolved ORDER LINE, not on the requested product: two variants of
    // one product are two distinct lines and both may be returned, while the same line
    // entered twice would silently double the refund base (the unique index is multikey
    // and dedupes keys WITHIN a document, so it cannot catch that).
    const lineKey = String(orderLine._id || `${orderLine.product?._id || orderLine.product}:${orderLine.variantId || ''}`);
    if (seen.has(lineKey)) {
      throw new AppError('The same order line is listed twice — combine it into one line with the full quantity.', 400);
    }
    seen.add(lineKey);

    if (!RETURN_REASONS.includes(item.reason)) {
      throw new AppError('Choose a return reason for each item.', 400);
    }
    const productId = orderLine.product?._id || orderLine.product;
    if (!productId) {
      // Legacy WooCommerce lines may carry no product ref at all (Order.items.product is
      // only required when source !== 'woocommerce'), and ReturnRequest.items.product is
      // required — so this cannot be recorded as a return at all. Say why.
      throw new AppError(
        `"${orderLine.name || 'One of these items'}" is an imported line with no catalogue product on it, so a return cannot be recorded against it. Refund it from the order instead.`,
        422,
      );
    }
    lines.push({
      product: productId,
      orderItemId: orderLine._id || null,
      variantId: orderLine.variantId || null,
      variantLabel: orderLine.variantLabel || null,
      // Clamped to what was actually bought — the refund base is Σ(unitPrice × qty),
      // so an over-entered quantity is an over-refund.
      quantity: Math.min(Number(item.quantity) || 1, orderLine.quantity),
      reason: item.reason,
      fault: { claimed: claimedFaultFor(item.reason) },
      unitPrice: money(orderLine.price),
    });
  }
  return lines;
};

// @desc    Record a return that was handled off-platform (Admin)
// @route   POST /returns/admin
// @access  Private/Admin
export const createOfflineReturn = asyncHandler(async (req, res) => {
  const { orderId, items, note, shippingBorneBy, notifyCustomer } = req.body;
  // Default TRUE: the normal case is that the goods are already back in our hands —
  // that is what "handled offline" means. Pass false to record one still in transit.
  const markReturned = req.body.markReturned !== false;

  const order = await orderRepository.findByIdWithProducts(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  const desc = typeof note === 'string' ? note.trim() : '';
  if (!desc) {
    throw new AppError('A note describing what happened is required — it is the only record of an offline return.', 400);
  }

  const returnItems = snapshotReturnLines(order, items);
  if (returnItems.length === 0) {
    throw new AppError('Select at least one item to return.', 400);
  }

  /*
    The duplicate guard is kept, and scoped to IN-FLIGHT returns — the same set the DB
    unique index uses, so this friendly message and the race-safe backstop always agree.
    An admin recording a second return for a line already in flight is a real mistake;
    recording one for units that were refunded months ago is not, and used to be refused.

    ONE query for all lines, not one per line. The index is multikey on
    (order, items.product), so `$in` uses exactly the same index the per-line lookup
    did — it just stops paying a round trip per item. Measured on a 5-line return:
    5 lookups → 1.
  */
  const productIds = returnItems.map((l) => l.product);
  const clash = await returnRequestRepository.findOne({
    order: orderId,
    'items.product': { $in: productIds },
    status: { $in: IN_FLIGHT_RETURN_STATUSES },
  });
  if (clash) {
    // Name the offending line when we can — with one query the clash is no longer
    // implicit in the loop position, so it has to be read back off the match.
    const wanted = new Set(productIds.map(String));
    const clashedId = (clash.items || []).map((it) => String(it.product)).find((id) => wanted.has(id));
    const name = order.items.find((oi) => String(oi.product?._id || oi.product) === clashedId)?.product?.name;
    throw new AppError(`A return request already exists for "${name || 'one of these items'}".`, 409);
  }

  /*
    ...and the same quantity ceiling as the customer path. Without it the admin route is
    a way around the bound: record enough offline returns and the order refunds more
    units than it ever contained.
  */
  const consumed = await returnRequestRepository.returnedQuantityByProduct(orderId);

  /*
    The ceiling is counted PER PRODUCT, across every line that carries it — matching
    `returnedQuantityByProduct`, which aggregates the same way.

    Taking the first matching line's quantity instead is wrong on a variable product: two
    variants share one product id and sit on two lines, so a customer who bought 1 black
    and 2 beige could only ever return 1 beige — the black line's quantity became the cap
    for both. Requested units are tallied per product for the same reason: two variant
    lines in ONE request must be weighed against one shared ceiling, or they each pass
    while together exceeding it.
  */
  const orderedByProduct = new Map();
  for (const oi of order.items) {
    const id = String(oi.product?._id || oi.product);
    orderedByProduct.set(id, (orderedByProduct.get(id) || 0) + (Number(oi.quantity) || 0));
  }
  const requestedByProduct = new Map();
  for (const line of returnItems) {
    const id = String(line.product);
    requestedByProduct.set(id, (requestedByProduct.get(id) || 0) + line.quantity);
  }

  for (const [productId, requested] of requestedByProduct) {
    const ordered = orderedByProduct.get(productId) || 0;
    const already = consumed.get(productId) || 0;
    const remaining = ordered - already;
    if (requested > remaining) {
      const name = order.items.find((oi) => String(oi.product?._id || oi.product) === productId)?.product?.name
        || 'one of these items';
      throw new AppError(
        `Only ${Math.max(0, remaining)} of "${name}" can still be returned — `
        + `${already} of ${ordered} already have been.`,
        409,
      );
    }
  }

  const { grossRupees, netRupees, discountShareRupees } = refundableForLines(order, returnItems);
  const now = new Date();

  const returnRequest = await returnRequestRepository.create({
    order: orderId,
    // Absent on legacy WooCommerce / guest orders; the schema allows it for this origin.
    user: order.user || undefined,
    items: returnItems,
    type: 'return',
    origin: 'admin_offline',
    createdBy: req.user._id,
    seller: order.salesUser || null,
    customerPhone: phoneKey(order.shippingAddress?.phone),
    status: markReturned ? 'received' : 'pending',
    problemDescription: desc,
    // No evidence: there was no upload step. Left null rather than faked.
    video: null,
    proofOfPurchase: null,
    images: [],
    shippingBorneBy: ['roavion', 'customer'].includes(shippingBorneBy) ? shippingBorneBy : 'roavion',
    // Recording it as received IS the inspection — an operator had the goods in hand.
    // Setting it here (rather than leaving null) is what lets the refund claim, whose
    // gate is `received` + `inspection.passed`, stay completely unchanged.
    inspection: markReturned
      ? { passed: true, notes: `Handled offline: ${desc}`, at: now, by: req.user._id }
      : { passed: null },
    refund: {
      productValue: netRupees,
      listValue: grossRupees,
      discountShare: discountShareRupees,
      finalAmount: netRupees,
      status: 'pending',
    },
    adminNotes: desc,
    timeline: [{
      status: markReturned ? 'received' : 'pending',
      note: markReturned ? `Offline return recorded — goods received. ${desc}` : `Offline return recorded. ${desc}`,
      updatedBy: req.user._id,
      timestamp: now,
    }],
  });

  // Mirror onto the order exactly as the customer path does, so the order screen and
  // the admin queue read the same summary regardless of where the return came from.
  //
  // `returnRequest` is a Mongoose NESTED PATH, not a subdocument: assigning an object
  // merges leaf-by-leaf rather than replacing, so a previous return's `approvedAt` /
  // `rejectedReason` / `itemReceivedAt` would survive and be read as this one's. Every
  // leaf this write does not set is therefore cleared explicitly.
  order.returnRequest = {
    requestedAt: now,
    requestedBy: req.user._id,
    status: markReturned ? 'item_received' : 'pending',
    items: returnItems.map((it) => ({ product: it.product, quantity: it.quantity, reason: it.reason })),
    adminNotes: desc,
    itemReceivedAt: markReturned ? now : undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    rejectedReason: undefined,
    returnShippingLabel: undefined,
    inspectionNotes: undefined,
    reason: undefined,
    images: [],
  };
  await order.save();

  if (markReturned) {
    // Fulfilment axis: the customer path flips this at approval. An offline return has
    // no approval step, so do it here. Only lands if this return covers every delivered
    // line — a partial walk-in return leaves the order `delivered` so the rest stays
    // returnable. The return was created `received` above, so coverage counts it.
    await syncOrderReturnedStatus(
      orderId, req.user._id, `Offline return ${returnRequest._id} recorded`,
    );
  }

  // Silent by default: the customer handed the goods over in person, and the storefront
  // acknowledgement ("we'll review this in 3-5 working days") would contradict that.
  if (notifyCustomer && order.user) {
    enqueueNotification('send-return-submitted', { returnId: returnRequest._id.toString() });
  }

  await auditLogger.logAction(req, 'RETURN_OFFLINE_CREATE', 'ReturnRequest', returnRequest._id, {
    orderId: String(orderId),
    lines: returnItems.length,
    markReturned,
    note: desc,
  });

  res.status(201).json({ success: true, request: returnRequest });
});

// @desc    Mark a return received without the courier / inspection steps (Admin)
// @route   PATCH /returns/admin/:id/offline-received
// @access  Private/Admin
//
// The escape hatch for a return the customer raised online but then settled in person.
// markReceived deliberately refuses anything but `courier_booked` — skipping the AWB is
// exactly how a mandatory claim handle gets lost — so this is a SEPARATE, explicitly
// named, note-required, audit-logged route rather than a `force` flag that would weaken
// the normal path.
export const markReturnedOffline = asyncHandler(async (req, res) => {
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!note) {
    throw new AppError('A note is required — it is the only record of why the courier and inspection steps were skipped.', 400);
  }

  const rr = await returnRequestRepository.findById(req.params.id).populate('user', 'email name');
  if (!rr) {
    throw new AppError('Return request not found', 404);
  }
  if (['refunded', 'rejected', 'cancelled'].includes(rr.status)) {
    throw new AppError(`This request is already "${rr.status}" and cannot be reopened.`, 400);
  }
  // Idempotent: a double-click must not stack timeline entries or re-stamp the
  // inspection with a later timestamp.
  if (rr.status === 'received' && rr.inspection?.passed === true) {
    return res.json({ success: true, request: rr });
  }

  const previousStatus = rr.status;
  rr.inspection = { passed: true, notes: `Handled offline: ${note}`, at: new Date(), by: req.user._id };
  transition(rr, 'received', `Marked received offline (courier + inspection skipped). ${note}`, req.user._id);
  await returnRequestRepository.save(rr);

  await orderRepository.setReturnRequestStatus(rr.order, 'item_received');
  // The return may never have been approved (straight from `pending`), so the
  // approval-time fulfilment flip has to happen here too. Only lands when this return
  // covers every delivered line; idempotent by compare-and-set.
  await syncOrderReturnedStatus(
    rr.order, req.user._id, `Return ${rr._id} settled offline`,
  );

  if (req.body.notifyCustomer && rr.user) {
    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'received' });
  }

  await auditLogger.logAction(req, 'RETURN_OFFLINE_RECEIVED', 'ReturnRequest', rr._id, {
    orderId: String(rr.order),
    previousStatus,
    note,
  });

  res.json({ success: true, request: rr });
});

// @desc    Approve or reject a return at review (Admin)
// @route   PATCH /returns/admin/:id/review
// @access  Private/Admin
export const reviewReturn = asyncHandler(async (req, res) => {
  const { decision, adminNotes, rejectionReason, shippingBorneBy } = req.body;
  const rr = await returnRequestRepository.findById(req.params.id).populate('user', 'email name');
  if (!rr) {
    throw new AppError('Return request not found', 404);
  }
  if (rr.status !== 'pending') {
    throw new AppError(`Only a pending request can be reviewed (this one is "${rr.status}").`, 400);
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
    // A PARTIAL return leaves the order `delivered` so the un-returned lines stay
    // returnable — see syncOrderReturnedStatus.
    await syncOrderReturnedStatus(rr.order, req.user._id, `Return ${rr._id} approved`);
    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'approved' });
  } else if (decision === 'reject') {
    if (!rejectionReason) {
      throw new AppError('A rejection reason is required.', 400);
    }
    rr.rejectionReason = rejectionReason;
    transition(rr, 'rejected', rejectionReason, req.user._id);
    await returnRequestRepository.save(rr);
    await orderRepository.setReturnRequestStatus(rr.order, 'rejected');
    enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'rejected' });
  } else {
    throw new AppError('Decision must be "approve" or "reject".', 400);
  }

  res.json({ success: true, request: rr });
});

// @desc    Record that the return courier has been booked (Admin)
// @route   PATCH /returns/admin/:id/courier
// @access  Private/Admin
//
// Both fields are REQUIRED. We book the pickup ourselves, which means we own the
// goods for the whole pickup→warehouse window; the AWB is the only handle we have
// to raise a claim with the courier when a high-value item never arrives. Until
// 2026-08-03 both were optional and never read back anywhere, so the step recorded
// nothing. They are now surfaced to the customer (status email + /returns) too.
// Accepted from `approved` (first booking) AND from `courier_booked` (correction).
// The correction path is not a convenience: the AWB is now mandatory, emailed to the
// customer, and our only claim handle — so a typo is exactly the case that most needs
// fixing, and there is no other route to it once `approved` has been left behind. It
// stays closed from `received` onward, where the pickup is already history.
export const bookCourier = asyncHandler(async (req, res) => {
  const provider = typeof req.body.provider === 'string' ? req.body.provider.trim() : '';
  const trackingNumber = typeof req.body.trackingNumber === 'string' ? req.body.trackingNumber.trim() : '';

  const rr = await returnRequestRepository.findById(req.params.id).populate('user', 'email name');
  if (!rr) {
    throw new AppError('Return request not found', 404);
  }
  if (!['approved', 'courier_booked'].includes(rr.status)) {
    throw new AppError(
      rr.status === 'pending'
        ? 'Approve the request before booking the courier.'
        : `Courier details can no longer be changed (this request is "${rr.status}").`,
      400
    );
  }
  if (!provider) {
    throw new AppError('Courier name is required — it is our only claim handle if the pickup goes missing.', 400);
  }
  if (!trackingNumber) {
    throw new AppError('Tracking / AWB number is required.', 400);
  }

  const isCorrection = rr.status === 'courier_booked';
  const previous = isCorrection ? rr.courier : null;
  const unchanged = isCorrection
    && previous?.provider === provider
    && previous?.trackingNumber === trackingNumber;

  rr.courier = {
    provider,
    trackingNumber,
    // Preserve the ORIGINAL booking time on a correction — that timestamp is when the
    // goods actually left the customer, which is what a courier claim turns on.
    bookedAt: previous?.bookedAt || new Date(),
    bookedBy: req.user._id,
    correctedAt: isCorrection && !unchanged ? new Date() : previous?.correctedAt,
  };

  if (unchanged) {
    // Nothing changed — don't append a noise timeline entry or re-mail the customer.
    return res.json({ success: true, request: rr });
  }

  transition(
    rr,
    'courier_booked',
    isCorrection
      ? `Courier details corrected to ${provider} (AWB ${trackingNumber})`
      : `Pickup arranged with ${provider} (AWB ${trackingNumber})`,
    req.user._id
  );
  await returnRequestRepository.save(rr);
  await orderRepository.setReturnRequestStatus(rr.order, 'approved');
  // Tell the customer who is collecting and under which AWB — the single most-asked
  // question after an approval, and previously unanswerable from our own records.
  // A correction re-sends, so the customer is never left holding a stale AWB.
  enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'courier_booked' });
  res.json({ success: true, request: rr });
});

// @desc    Mark the returned item received at the warehouse (Admin)
// @route   PATCH /returns/admin/:id/received
// @access  Private/Admin
export const markReceived = asyncHandler(async (req, res) => {
  const rr = await returnRequestRepository.findById(req.params.id).populate('user', 'email name');
  if (!rr) {
    throw new AppError('Return request not found', 404);
  }
  // `approved` is deliberately NOT accepted: allowing it let the courier step be
  // skipped entirely, which is how a mandatory AWB gets bypassed in practice.
  if (rr.status !== 'courier_booked') {
    throw new AppError('The item can only be marked received after the courier is booked.', 400);
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
    throw new AppError('Return request not found', 404);
  }
  if (rr.status !== 'received') {
    throw new AppError('Inspection can only be recorded after the item is received.', 400);
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
  res.json(await previewRefund(req.params.id, req.method === 'POST' ? req.body : null));
});



// @desc    Withdraw an OFFLINE return refund record that was a mistake (Admin)
// @route   POST /returns/admin/:id/refund/revert
// @access  Private/Admin
//
// The return goes back to `received` with a `pending` refund — exactly the state
// claimForRefund needs to be able to re-claim it — so the refund can then be issued
// properly, by either method.
//
// ⚠️ OFFLINE RECORDS ONLY. A Razorpay refund has genuinely left the account and no
// field write can pull it back; claimRefundRevert enforces that atomically and this
// handler only explains the refusal.
export const revertReturnRefund = asyncHandler(async (req, res) => {
  const reason = String(req.body.reason || '').trim();

  const before = await returnRequestRepository.claimRefundRevert(req.params.id, {
    revertedBy: req.user._id,
    reason,
  });

  if (!before) {
    // Re-read to say WHY, rather than leaving the admin with a bare 409: the claim is
    // deliberately narrow and its failure alone does not distinguish the cases.
    const existing = await returnRequestRepository.findById(req.params.id);
    if (!existing) throw new AppError('Return request not found', 404);

    if (existing.refund?.status === 'completed' && existing.refund?.method !== 'offline') {
      throw new AppError(
        'This refund went through Razorpay, so it cannot be reverted here — the money has '
        + 'genuinely left the account. Only a refund recorded as settled offline can be '
        + 'withdrawn.',
        409,
      );
    }
    throw new AppError(
      'There is no offline refund recorded on this return to revert '
      + `(refund is ${existing.refund?.status || 'not recorded'}).`,
      409,
    );
  }

  const finalAmount = Number(before.refund?.finalAmount) || 0;
  const amountPaise = toPaise(finalAmount);
  const order = before.order ? await orderRepository.findById(before.order) : null;

  /*
    Each effect is reversed by the figure it ACTUALLY applied, recorded on the mark's
    success path — never by the refund's face value, and never inferred from the
    `paymentRecorded` / `ltvReversed` claim flags. Those are set BEFORE the work, and
    reverseReturnLtvOnce swallows a failed decrementSpend entirely, so a flag can read
    `true` while nothing moved. Reversing on that basis would take money off
    `Payment.refundAmount` that was never added — wiping a sibling refund's contribution
    off the headroom floor — and credit back spend that was never taken.
  */
  const paymentRecordedPaise = Math.max(0, Math.floor(Number(before.refund?.paymentRecordedPaise) || 0));
  const ltvDecrementedPaise = Math.max(0, Math.floor(Number(before.refund?.ltvDecrementedPaise) || 0));

  const { warnings } = await reverseRefundSideEffects({
    orderId: before.order,
    userId: ltvDecrementedPaise > 0 ? (before.user || null) : null,
    affiliateClawbackPaise: Math.max(0, Math.floor(Number(before.refund?.affiliateClawbackPaise) || 0)),
    paymentId: order?.payment || null,
    amountPaise: paymentRecordedPaise,
    ltvPaise: ltvDecrementedPaise,
    /*
      recordOfflineRefund flips the order to `refunded` only when the payout covered the
      whole order value. Recomputing the same comparison here — rather than trusting the
      current paymentStatus — keeps a partial return refund from resurrecting an order
      that something else legitimately marked refunded.
    */
    restorePaidStatus: Boolean(
      order && order.paymentStatus === 'refunded' && amountPaise >= toPaise(order.totalAmount || 0),
    ),
    label: `return ${before._id} refund`,
    reason: 'return_refund_reverted',
  });

  /*
    The order's refundDetails mirror. Best-effort and deliberately narrow: it holds only
    the LATEST refund across every return on the order, so it is cleared ONLY if it is
    still describing THIS return. Blindly clearing it would erase a different return's
    summary. The `Return <id>` note prefix is the same marker remainingRefundable uses.
  */
  if (order && order.refundDetails?.notes === `Return ${before._id}`) {
    try {
      /*
        CLEARED, not set to `pending`.

        `pending` + a surviving `requestedAt` is precisely `findWithRefunds`' actionable
        bucket, so the order appeared in /admin/refunds as a refund owed — except the
        order is `delivered`, and every action there (Process Refund, Mark offline) gates
        on `status === 'cancelled'` and 400s. It would have sat in the queue permanently,
        un-actionable and un-dismissable.

        The mirror is only ever a summary of the latest refund on the order. That refund
        has been withdrawn, so there is nothing left for it to summarise; the authoritative
        record is the ReturnRequest, which the claim above already rewound. Unsetting the
        whole subdoc also clears the offline fields, so the whole-order Revert control
        cannot appear against a return's withdrawn mirror.
      */
      await orderRepository.clearRefundMirror(order._id, `Return ${before._id}`);
    } catch (err) {
      warnings.push('order refund summary');
      console.error(`[ReturnRefundRevert] order mirror for ${before._id} failed — ${err.message}`);
    }
  }

  try {
    await auditLogger.logAction(req, 'RETURN_REFUND_REVERTED', 'ReturnRequest', before._id, {
      orderId: String(before.order),
      amount: finalAmount,
      offlineMethod: before.refund?.offlineMethod,
      reference: before.refund?.reference,
      reason,
    });
  } catch (err) {
    warnings.push('audit log');
    console.error(`[ReturnRefundRevert] audit log for ${before._id} failed — ${err.message}`);
  }

  return res.json({
    success: true,
    message: `Withdrew the ₹${finalAmount} offline refund record. The return is back to `
      + '"awaiting refund".'
      + (warnings.length ? ` Some follow-up steps need checking: ${warnings.join(', ')}.` : ''),
    amount: finalAmount,
    ...(warnings.length ? { warnings } : {}),
  });
});

// @desc    Refund a return — through Razorpay, or record one already paid offline (Admin)
// @route   POST /returns/admin/:id/refund
// @access  Private/Admin
//
// `method` (default 'original_payment') picks the path:
//   original_payment → unchanged: verify headroom + instrument constraints, then send a
//                      real Razorpay refund and let the refund.* webhook settle it.
//   offline          → the money ALREADY left by hand (cash at the counter, NEFT, UPI,
//                      cheque). Nothing is sent to the gateway; this records it, with a
//                      mandatory `reference` because that string is the only evidence.
//
// Both go through the SAME atomic claimForRefund, so the two can never both pay out for
// one return, and both are capped by the same headroom — cash refunded here reduces what
// a later gateway refund on the same order is allowed to draw.
export const initiateReturnRefund = asyncHandler(async (req, res) => {
  res.json(await initiateRefund(req));
});
