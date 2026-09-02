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
 *     The courier step is MANDATORY and cannot be skipped: we book the pickup, so the
 *     AWB is our only claim handle if the goods never reach the warehouse.
 *   - Refund is decided BY HAND at initiation (full, or minus shipping / restocking),
 *     and always paid to the ORIGINAL payment method via a partial Razorpay refund.
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

import asyncHandler from '../middleware/asyncHandler.js';
import AppError from '../utils/AppError.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import razorpayService from '../services/razorpayService.js';
import { reverseReturnLtvOnce } from '../services/returnRefundLtvService.js';
import auditLogger from '../services/auditLogger.js';
import { refundableForLines, remainingRefundable, matchOrderLine } from '../services/refundMathService.js';
import { supportsPartialRefund, describeEmiPlan } from '../utils/paymentMethodDetails.js';
import { toPaise } from '../utils/money.js';
import { deliveredAtForItem } from '../utils/orderFulfilment.js';
import { coversEveryDeliveredLine } from '../utils/orderReturns.js';
import { enqueueNotification } from '../queue/queues.js';
import {
  RETURN_WINDOW_DAYS,
  RETURN_REASONS,
  IN_FLIGHT_RETURN_STATUSES,
  suggestedRestockingRupees,
} from '../config/returnPolicy.js';
import {
  RETURNS_FOLDER_BASE,
  generateReturnUploadSignature,
  getReturnResource,
  signedReturnAssetUrl,
  resourceFormat,
} from '../utils/returnsCloudinary.js';
import { storageProvider } from '../config/storage.js';
import { providerOf } from '../services/storage/privateAssetUrl.js';
import { headObject, getObjectHead } from '../services/storage/r2Provider.js';
import { matchesAnyKind, SNIFF_BYTES } from '../services/storage/contentSniff.js';
import {
  RETURN_SLOTS,
  newReturnsFolder,
  slotFromKey,
  slotDefFromKey,
  buildReturnUploadTargets,
} from '../services/storage/returnsUploadTargets.js';
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
 * Move the order onto the `returned` fulfilment stage — but ONLY if this return
 * actually accounts for everything the customer received.
 *
 * ── WHY THE COVERAGE CHECK ────────────────────────────────────────────────────────
 * This used to be a bare call to `orderRepository.markReturnedOnReturnApproval`, which
 * compare-and-sets on `status: 'delivered'` and asks nothing about quantities. That was
 * correct when an order had one return. With per-line returns it meant sending back 1 of
 * 3 items flipped the WHOLE order to `returned` — and `returned` is terminal in
 * orderStatusService.STATUS_TRANSITIONS, so the customer could never return the other 2
 * and the order could never move again. It also told the admin Orders column that an
 * order the customer still mostly holds had come back.
 *
 * That defeated a decision made deliberately elsewhere: the
 * `unique_inflight_return_per_order_product` index was narrowed precisely so a customer
 * "who sent back 1 of 3 faulty items" could claim the other 2 (models/ReturnRequest.js).
 *
 * A partial return therefore leaves the order on `delivered`. Partiality is carried as a
 * DISPLAY label (utils/orderReturns.returnSummary), never as a new status enum — the
 * same call orderFulfilment.js makes for partial shipping and cancellation.
 *
 * ── ORDERING ──────────────────────────────────────────────────────────────────────
 * MUST be called after the triggering return has been saved in a quantity-consuming
 * status, because coverage is computed from the persisted returns — including this one.
 * All three call sites save first.
 *
 * Idempotent and race-safe: the underlying write is still a compare-and-set on
 * `delivered`, so a double-approval, or an order an admin already moved by hand, matches
 * zero documents and no-ops rather than stacking a duplicate history entry.
 *
 * Never throws: a status roll-up must not fail an approval whose goods decision is
 * already recorded. `Order.status` is a cached conclusion about the returns, and the
 * next return event on the order recomputes it.
 *
 * @param {string|object} orderId
 * @param {string|object} userId - the acting admin
 * @param {string} note - status-history note when the flip lands
 * @returns {Promise<boolean>} true when THIS call flipped the order to `returned`.
 */
const syncOrderReturnedStatus = async (orderId, userId, note) => {
  try {
    const order = await orderRepository.findById(orderId);
    if (!order) return false;

    const returnedByProduct = await returnRequestRepository.returnedQuantityByProduct(orderId);
    if (!coversEveryDeliveredLine(order, returnedByProduct)) return false;

    return await orderRepository.markReturnedOnReturnApproval(orderId, userId, note);
  } catch (err) {
    const message =
      `[Returns] Order-status roll-up to 'returned' FAILED for order ${orderId}: `
      + `${err?.message || 'unknown error'}. The return itself is recorded; Order.status `
      + 'is stale until the next return event recomputes it.';
    console.error(message);
    Sentry.captureMessage(message, 'error');
    return false;
  }
};

/**
 * Validate ONE client-declared asset against Cloudinary. The only value trusted
 * from the client is publicId (+ a constrained resourceType); size/format are
 * re-read server-side. Returns { publicId, resourceType, bytes } or throws a
 * response-shaped Error via `fail`.
 */
const validateAsset = async (raw, { label, allowedResourceTypes, maxBytes, formats, capLabel, slotKeys }) => {
  if (!raw || typeof raw !== 'object') return null;
  const publicId = typeof raw.publicId === 'string' ? raw.publicId.trim() : '';
  if (!publicId) return null;

  /*
    The client says WHERE it uploaded, and we verify there. Safe to take at face
    value: a lie cannot manufacture a pass, it only sends the lookup to a store
    that does not hold the file. Routing on the server's current
    STORAGE_PROVIDER instead would reject every customer who was mid-form when
    the flag flipped. Absent means Cloudinary — the rule everywhere else.
  */
  if (providerOf(raw) === 'r2') {
    /*
      One check replaces three. slotFromKey matches the WHOLE minted key shape,
      so it proves at once that the object is inside our returns prefix, that we
      minted it, that it carries no traversal segments, and that it was signed
      for a slot this field accepts — the last of which stops evidence being
      shuffled between slots to dodge a size cap.
    */
    const slotKey = slotFromKey(publicId);
    if (!slotKey || (slotKeys && !slotKeys.includes(slotKey))) {
      throw new AppError(`${label}: invalid upload reference.`, 400);
    }
    const slotDef = slotDefFromKey(publicId);

    const head = await headObject({ key: publicId, scope: 'private' });
    if (!head || head.bytes <= 0) {
      throw new AppError(`${label}: upload could not be verified. Please re-upload.`, 400);
    }
    // The cap is enforced against the STORE, never the payload's claim.
    if (head.bytes > maxBytes) {
      throw new AppError(`${label} exceeds the ${capLabel} limit.`, 400);
    }
    /*
      R2 does not decode uploads the way Cloudinary did, and does not even
      enforce the Content-Type its own presigned URL was signed with. So the
      format is re-derived from the bytes: a ranged read of the first few
      hundred, identified by magic number.
    */
    const magic = await getObjectHead({ key: publicId, scope: 'private', bytes: SNIFF_BYTES });
    if (!matchesAnyKind(magic, slotDef?.kinds)) {
      throw new AppError(`${label}: unsupported file type.`, 400);
    }
    return {
      publicId,
      resourceType: slotDef?.resourceType || allowedResourceTypes[0],
      bytes: head.bytes,
      provider: 'r2',
    };
  }

  let resourceType = typeof raw.resourceType === 'string' ? raw.resourceType.trim() : allowedResourceTypes[0];
  if (!allowedResourceTypes.includes(resourceType)) {
    throw new AppError(`${label}: invalid upload type.`, 400);
  }
  // Must live under our returns folder — blocks attaching a foreign asset by id.
  if (!publicId.startsWith(`${RETURNS_FOLDER_BASE}/`)) {
    throw new AppError(`${label}: invalid upload reference.`, 400);
  }

  const resource = await getReturnResource(publicId, resourceType);
  if (!resource) {
    throw new AppError(`${label}: upload could not be verified. Please re-upload.`, 400);
  }
  if (resource.bytes > maxBytes) {
    throw new AppError(`${label} exceeds the ${capLabel} limit.`, 400);
  }
  const fmt = resourceFormat(resource, publicId);
  if (formats && !formats.includes(fmt)) {
    throw new AppError(`${label}: unsupported file type.`, 400);
  }
  return { publicId, resourceType, bytes: resource.bytes, provider: 'cloudinary' };
};

/**
 * Resolve everything the money decision depends on, from the ORDER rather than the
 * return's own snapshot. Shared by the preview and the refund so the number the
 * operator sees is the number that gets claimed and sent — they can never diverge.
 *
 * Reading the order live also silently repairs returns created before discount
 * proration existed (their stored productValue is a gross figure), so no backfill
 * migration is needed for the ones already sitting in the queue.
 *
 * @returns {{ order, payment, refundable, headroom }}
 */
const resolveRefundBasis = async (rr) => {
  const order = await orderRepository.findById(rr.order);
  if (!order) {
    throw new AppError('The order for this return no longer exists.', 404);
  }
  const refundable = refundableForLines(order, rr.items);
  // Both reads depend only on `order` and not on each other, so they go out together
  // — one round trip instead of two on every preview AND every refund. The Payment row
  // is loaded here (not just at refund time) so the headroom the operator PREVIEWS
  // already accounts for money the payment knows about; otherwise the preview and the
  // refund could disagree about what is left.
  const [siblings, payment] = await Promise.all([
    returnRequestRepository.find({ order: order._id }).select('refund').lean(),
    order.payment ? paymentRepository.findById(order.payment) : Promise.resolve(null),
  ]);
  const headroom = remainingRefundable(order, siblings, rr._id, payment);
  return { order, payment, refundable, headroom };
};

/**
 * Debit-card EMI is FULL-REFUND-ONLY at the issuer.
 *
 * The bank is never told which line of a multi-item order came back — it only holds a
 * loan against the whole capture — so it can unwind the loan or nothing. Razorpay
 * rejects a partial refund on a DC EMI payment outright.
 *
 * Our return flow is partial by construction (per-line proration, minus shipping and
 * restocking deductions), so on a DC EMI order almost every refund is one Razorpay
 * refuses. Without this check the operator only finds out AFTER claimForRefund has
 * moved the return into `processing`, and gets a 502 for what is really a policy
 * conflict we can see in advance.
 *
 * Returns null when the refund may proceed, or an operator-facing reason string.
 *
 * @param {Object} payment - our Payment document (needs methodDetails)
 * @param {number} finalAmount - rupees this refund will send
 * @param {number} capturedRupees - what the gateway captured on the order
 * @returns {string|null}
 */
const partialRefundBlockReason = (payment, finalAmount, capturedRupees) => {
  if (supportsPartialRefund(payment)) return null;
  // A refund that happens to cover the whole capture IS a full refund and is allowed.
  if (toPaise(finalAmount) >= toPaise(capturedRupees)) return null;

  return (
    `This order was paid by Debit Card EMI, which the bank can only refund in full — ` +
    `a partial refund of ₹${finalAmount} against the ₹${capturedRupees} captured will be ` +
    `rejected by Razorpay. Either refund the full ₹${capturedRupees}, or settle this ` +
    `return outside the gateway and record it manually.`
  );
};

/** Signed, viewable copies of a return's private evidence (admin only). */
// Async because signing an R2 asset is a presign call rather than a local HMAC.
// Every asset on the return is signed in one parallel batch.
const withSignedEvidence = async (rr) => {
  // `a` is passed whole so the minter can read its `provider` — a ref written
  // before the R2 migration has none, which correctly means Cloudinary.
  const sign = async (a) => (a?.publicId
    ? {
      url: await signedReturnAssetUrl(a.publicId, a.resourceType, a),
      bytes: a.bytes || 0,
      resourceType: a.resourceType,
    }
    : null);

  const images = Array.isArray(rr.images) ? rr.images : [];
  const [video, proofOfPurchase, signedImages] = await Promise.all([
    sign(rr.video),
    sign(rr.proofOfPurchase),
    Promise.all(images.map(sign)),
  ]);

  return { ...rr, video, proofOfPurchase, images: signedImages.filter(Boolean) };
};

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
  const folder = newReturnsFolder();

  if (storageProvider() === 'r2') {
    const uploads = await buildReturnUploadTargets({ folder, files: req.body?.files });
    return res.json({ success: true, provider: 'r2', folder, uploads });
  }

  res.json({ success: true, provider: 'cloudinary', ...generateReturnUploadSignature({ folder }) });
});

// @desc    Create a return request
// @route   POST /returns
// @access  Private
export const createReturnRequest = asyncHandler(async (req, res) => {
  const { orderId, items, problemDescription, video, proofOfPurchase, images } = req.body;
  const userId = req.user._id;

  const order = await orderRepository.findOwnedWithProducts(orderId, userId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }
  /*
    `returned` is accepted alongside `delivered` because an approved return can move the
    order onto the `returned` fulfillment stage (see syncOrderReturnedStatus). A
    multi-line order must still be able to raise a return for a DIFFERENT item while the
    first one is in flight — the per-line window below and the per-product active-return
    guard further down are what actually bound eligibility.

    ⚠️ Accepting `returned` matters MORE since that flip was gated on the return covering
    every delivered line. Orders already sitting at `returned` from before that gate
    existed were moved there by a PARTIAL return, so they can still hold items the
    customer never sent back. Refusing them here would strand exactly the people the
    gate was added to protect.

    ⚠️ `shipped` is accepted TOO, but only for an order that has parcels. A split order
    sits at `shipped` until its LAST parcel lands, so gating on the order status alone
    would refuse a return for an item that has already been in the customer's hands for
    days — and by the time the final parcel arrived and flipped the order to `delivered`,
    that item's 4-day window could have expired without them ever being allowed to use
    it. The real gate is per line: `deliveredAtForItem` below rejects anything that has
    not actually arrived.
  */
  const isSplitOrder = (order.shipments || []).length > 0;
  const allowedStatuses = isSplitOrder
    ? ['delivered', 'returned', 'shipped']
    : ['delivered', 'returned'];
  if (!allowedStatuses.includes(order.status)) {
    throw new AppError('Only delivered orders can be returned.', 400);
  }

  /*
    Units already claimed by earlier returns on this order, product by product. Read ONCE
    before the loop — a per-line lookup would be an N+1 against a collection that grows
    with every return, for an answer that cannot change mid-request.
  */
  const consumedByProduct = await returnRequestRepository.returnedQuantityByProduct(orderId);

  // 2) Validate + snapshot each requested line.
  const returnItems = [];
  for (const item of items || []) {
    const orderLine = order.items.find((oi) => String(oi.product?._id || oi.product) === String(item.productId));
    if (!orderLine) {
      throw new AppError('One of the selected items is not part of this order.', 400);
    }

    /*
      The 4-day window, measured from when THIS line arrived.

      On a split order that is the delivery date of the parcel it came in, not the
      order's — see deliveredAtForItem for why a single order-level date is wrong for at
      least one line whenever an order arrives in pieces. Legacy orders (no parcels) fall
      back to the order-level date, so their behaviour is byte-for-byte what it was.
    */
    const lineDeliveredAt = deliveredAtForItem(order, orderLine._id) ?? (isSplitOrder ? null : order.updatedAt);
    if (!lineDeliveredAt) {
      throw new AppError(
        `"${orderLine.product?.name || 'This item'}" hasn't been delivered yet, so it can't be returned. `
        + `You'll be able to raise a return once it arrives.`,
        400,
      );
    }
    if (daysSince(lineDeliveredAt) > RETURN_WINDOW_DAYS) {
      throw new AppError(
        `Return window closed for "${orderLine.product?.name || 'this item'}". `
        + `Returns must be raised within ${RETURN_WINDOW_DAYS} days of that item being delivered.`,
        400,
      );
    }
    if (!RETURN_REASONS.includes(item.reason)) {
      throw new AppError('Returns are only accepted for a wrong item, transit damage, or a manufacturing defect.', 400);
    }
    // Non-returnable classes (electrical/custom/imported/installed) are blocked.
    const product = orderLine.product;
    if (product?.returnPolicy && product.returnPolicy.returnable === false) {
      throw new AppError(`"${product.name}" is not eligible for return under our policy.`, 400);
    }
    const requested = Math.min(Number(item.quantity) || 1, orderLine.quantity);
    const label = product?.name || 'this item';

    /*
      ── WHAT BOUNDS A REPEAT RETURN IS QUANTITY, NOT HISTORY ────────────────────────
      This used to refuse ANY second return for a product once one existed in a
      non-cancelled state — including the terminal `refunded`. The form invites a
      partial-quantity return ("2 of your 3"), so a customer who sent back one faulty
      wiper could never come back for the other two. The UI offered something the API
      then permanently refused.

      Three distinct rules now, in order:
    */

    // 1. A REJECTED return is a hard stop. Those goods were never taken back, so no
    //    quantity was consumed — but an operator has already said no, and re-asking is
    //    a support conversation rather than a self-serve retry.
    const rejected = await returnRequestRepository.findOne({
      order: orderId, 'items.product': item.productId, status: 'rejected',
    });
    if (rejected) {
      throw new AppError(
        `A return for "${label}" was reviewed and declined. Please contact support if you'd like it looked at again.`,
        409,
      );
    }

    // 2. One IN-FLIGHT return per product at a time. This mirrors the DB unique index
    //    exactly (same status set), so the friendly message and the race-safe backstop
    //    can never disagree about what is allowed.
    const inFlight = await returnRequestRepository.findOne({
      order: orderId, 'items.product': item.productId,
      status: { $in: IN_FLIGHT_RETURN_STATUSES },
    });
    if (inFlight) {
      throw new AppError(`A return for "${label}" is already in progress.`, 409);
    }

    // 3. Never give back more units than were bought. Counts everything already in
    //    flight or refunded across this order's returns.
    const alreadyReturned = consumedByProduct.get(String(item.productId)) || 0;
    const remaining = orderLine.quantity - alreadyReturned;
    if (remaining <= 0) {
      throw new AppError(`All ${orderLine.quantity} of "${label}" have already been returned.`, 409);
    }
    if (requested > remaining) {
      throw new AppError(
        `You can return ${remaining} more of "${label}" — ${alreadyReturned} of ${orderLine.quantity} `
        + 'have already been returned.',
        409,
      );
    }
    const qty = requested;
    returnItems.push({
      product: item.productId,
      variantId: orderLine.variantId || null,
      quantity: qty,
      reason: item.reason,
      unitPrice: money(orderLine.price),
    });
  }

  if (returnItems.length === 0) {
    throw new AppError('Select at least one item to return.', 400);
  }

  // ── Debit-card EMI: all-or-nothing ──────────────────────────────────────────
  //
  // The issuer holds ONE loan against the whole capture and is never told what was in
  // the order, so it can cancel the loan or nothing — a partial refund is rejected
  // outright (see utils/paymentMethodDetails.js).
  //
  // This is checked HERE, at request time, and not only at refund time. The refund-time
  // guard is a backstop that fires at the END of the flow — after the return is
  // approved, after WE have paid for the courier pickup, and after the goods are back
  // in the warehouse. Discovering the constraint at that point costs real money and
  // strands the customer. Discovering it here costs nothing.
  //
  // Single-item orders can never trip this: returning the only line IS a full return.
  const payment = order.payment ? await paymentRepository.findById(order.payment) : null;
  if (payment && !supportsPartialRefund(payment)) {
    const paidBy = describeEmiPlan(payment) || 'Debit Card EMI';

    // A full return is only possible if every line is actually returnable. If any is
    // not (electrical/custom/imported/installed), no valid request exists at all — say
    // so plainly instead of rejecting them item by item.
    const blocked = order.items.find((oi) => oi.product?.returnPolicy?.returnable === false);
    if (blocked) {
      throw new AppError(
        `This order was paid using ${paidBy}, which your bank can only refund in full — but ` +
        `"${blocked.product?.name || 'one of the items'}" is not eligible for return, so the whole order ` +
        `cannot be sent back. Please contact support and we will settle this for you.`,
        422
      );
    }

    // Sum per product on both sides — an order may legitimately carry the same product
    // on more than one line, and the line lookup above matches on product id alone.
    const tally = (rows, key, qty) => rows.reduce((m, r) => {
      const id = String(key(r));
      return m.set(id, (m.get(id) || 0) + qty(r));
    }, new Map());

    const wanted = tally(order.items, (oi) => oi.product?._id || oi.product, (oi) => oi.quantity);
    const chosen = tally(returnItems, (ri) => ri.product, (ri) => ri.quantity);
    const isFullReturn = wanted.size === chosen.size
      && [...wanted].every(([id, qty]) => chosen.get(id) === qty);

    if (!isFullReturn) {
      throw new AppError(
        `This order was paid using ${paidBy}. Your bank can only cancel the whole EMI plan — it cannot ` +
        `refund part of it. To get a refund, every item in this order needs to be returned. You can ` +
        `re-order anything you would like to keep straight away.`,
        422
      );
    }
  }

  // 3) Mandatory documentation — all three, or reject.
  const desc = typeof problemDescription === 'string' ? problemDescription.trim() : '';
  if (!desc) {
    throw new AppError('A description of the problem is required.', 400);
  }
  const videoAsset = await validateAsset(video, {
    label: 'Unboxing video', allowedResourceTypes: ['video'], maxBytes: VIDEO_MAX_BYTES, formats: VIDEO_FORMATS, capLabel: '60MB',
    slotKeys: ['video'],
  });
  if (!videoAsset) {
    throw new AppError('A continuous unboxing video is required.', 400);
  }
  const proofAsset = await validateAsset(proofOfPurchase, {
    label: 'Proof of purchase', allowedResourceTypes: ['image', 'raw'], maxBytes: PROOF_MAX_BYTES, formats: PROOF_FORMATS, capLabel: '15MB',
    slotKeys: ['proof'],
  });
  if (!proofAsset) {
    throw new AppError('Proof of purchase (invoice or payment confirmation) is required.', 400);
  }
  // Optional extra photos.
  const photoAssets = [];
  for (const raw of (Array.isArray(images) ? images.slice(0, MAX_PHOTOS) : [])) {
    const a = await validateAsset(raw, {
      label: 'Photo', allowedResourceTypes: ['image'], maxBytes: PHOTO_MAX_BYTES, formats: IMAGE_FORMATS, capLabel: '10MB',
      slotKeys: RETURN_SLOTS.filter((sl) => sl.key.startsWith('photo')).map((sl) => sl.key),
    });
    if (a) photoAssets.push(a);
  }

  // Discount-adjusted from the start: Σ(unitPrice × qty) is the LIST value, not what
  // was paid, and seeding the refund with it is what let a gross figure reach the
  // gateway. `productValue` is the refundable base; the gross sits alongside it for
  // display. Recomputed again at initiation — the order is the record, this is a hint.
  const { grossRupees, netRupees, discountShareRupees } = refundableForLines(order, returnItems);

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
    refund: {
      productValue: netRupees,
      listValue: grossRupees,
      discountShare: discountShareRupees,
      finalAmount: netRupees,
      method: 'original_payment',
      status: 'pending',
    },
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

  // Open a linked support ticket for the CONVERSATION only. This ReturnRequest
  // remains the system of record for refund maths, evidence and the policy
  // window — the ticket never drives any of that.
  enqueueNotification('create-support-ticket', {
    sourceModel: 'ReturnRequest',
    sourceId: returnId,
  });

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
      throw new AppError('Returns are only accepted for a wrong item, transit damage, or a manufacturing defect.', 400);
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
      variantId: orderLine.variantId || null,
      // Clamped to what was actually bought — the refund base is Σ(unitPrice × qty),
      // so an over-entered quantity is an over-refund.
      quantity: Math.min(Number(item.quantity) || 1, orderLine.quantity),
      reason: item.reason,
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
  const rr = await returnRequestRepository.findById(req.params.id).populate('items.product', 'name');
  if (!rr) {
    throw new AppError('Return request not found', 404);
  }
  const { order, payment, refundable, headroom } = await resolveRefundBasis(rr);

  // Suggested restocking = sum of the price-threshold limb over returned lines.
  const suggestedRestocking = money(
    rr.items.reduce((sum, it) => sum + suggestedRestockingRupees(it.unitPrice, it.quantity), 0)
  );
  res.json({
    success: true,
    preview: {
      // Payment-instrument constraints the operator has to know BEFORE choosing an
      // amount — chiefly debit-card EMI, which the bank can only refund in full.
      paidBy: describeEmiPlan(payment) || null,
      fullRefundOnly: !supportsPartialRefund(payment),
      // What the customer actually paid for these lines — the number the refund is
      // computed from and the one shown on the button.
      productValue: refundable.netRupees,
      // Context for the operator: the list value we used to (wrongly) refund, and the
      // slice of the order-level coupon/karma discount attributable to these lines.
      listValue: refundable.grossRupees,
      discountShare: refundable.discountShareRupees,
      couponCode: order.couponCode || null,
      // Gateway headroom. Razorpay rejects anything above this outright.
      orderTotal: headroom.capturedRupees,
      alreadyRefunded: headroom.alreadyRefundedRupees,
      maxRefundable: headroom.remainingRupees,
      suggestedRestocking, // operator may accept, change, or zero this
      shippingDeductionDefault: rr.shippingBorneBy === 'customer' ? null : 0,
      note: 'Refunds are based on what the customer actually paid, after any coupon or karma discount. The original delivery charge is never refunded. Restocking (10%) suggested for items over ₹1,00,000; add manually for oversized items. Enter the actual return-shipping cost to deduct when the customer bears it.',
    },
  });
});

/** Human label for an offline payout method, for timeline + email copy. */
const OFFLINE_METHOD_LABELS = Object.freeze({
  cash: 'cash',
  bank_transfer: 'bank transfer',
  upi: 'UPI',
  cheque: 'cheque',
  other: 'an offline payout',
});

/**
 * Settle a refund that was ALREADY paid outside the gateway.
 *
 * Called only after claimForRefund has won the atomic claim, so this owns a return that
 * no other request can be paying out concurrently.
 *
 * ORDERING IS THE WHOLE DESIGN HERE, and it is the opposite of the gateway path's.
 * There, the money moves last, so a failure before it means nothing was paid. Here the
 * money moved BEFORE the request arrived — a customer is already holding cash. So:
 *
 *   Phase 1 (must succeed)  Write the completed refund to the ReturnRequest. That doc is
 *                           the system of record and the ONLY thing remainingRefundable
 *                           counts, so until it lands the payout is invisible and a
 *                           gateway refund could pay the same money a second time.
 *   Phase 2 (best-effort)   The order mirror, the Payment row, net LTV, emails. Each is
 *                           individually guarded: a failure here is logged and reported
 *                           in `warnings`, and must NEVER walk phase 1 back to `failed`.
 *                           That rollback is precisely how recorded cash would vanish
 *                           from the headroom while the pre-check (`status === 'received'`)
 *                           blocked the retry the operator was told to make.
 *
 * Only a phase-1 failure marks the refund `failed`, and it also rewinds `status` to
 * `received` so claimForRefund can re-claim on a retry.
 */
const recordOfflineRefund = async (req, res, { rr, order, payment, finalAmount, offlineMethod, reference, paidAt }) => {
  const label = OFFLINE_METHOD_LABELS[offlineMethod] || 'an offline payout';
  const settledAt = paidAt || new Date();
  const warnings = [];

  /** Run a phase-2 step without letting it fail the recorded payout. */
  const bestEffort = async (what, fn) => {
    try {
      await fn();
    } catch (err) {
      warnings.push(what);
      console.error(`[ReturnRefund] offline refund ${rr._id}: ${what} failed — ${err.message}`);
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setContext('return_refund', { returnId: rr._id.toString(), orderId: String(rr.order), step: what });
          scope.setTag('payment_action', 'return_refund_offline');
          scope.setTag('severity', 'high');
          Sentry.captureException(err);
        });
      }
    }
  };

  // ── Phase 1 ────────────────────────────────────────────────────────────────
  try {
    rr.refund.status = 'completed';
    rr.refund.completedAt = settledAt;
    transition(rr, 'refunded', `Refund of ₹${finalAmount} recorded as paid by ${label} (ref ${reference})`, req.user._id);
    await returnRequestRepository.save(rr);
  } catch (err) {
    // Nothing durable was written, so make the return claimable again rather than
    // stranding it: `received` + a non-terminal refund is what claimForRefund needs.
    rr.status = 'received';
    rr.timeline = (rr.timeline || []).filter((t) => t.status !== 'refunded');
    rr.refund.status = 'failed';
    rr.refund.failureReason = err.message;
    try { await returnRequestRepository.save(rr); } catch { /* already failing; nothing more to do */ }

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('return_refund', { returnId: rr._id.toString(), orderId: String(rr.order), finalAmount, offlineMethod });
        scope.setTag('payment_action', 'return_refund_offline');
        scope.setTag('severity', 'high');
        Sentry.captureException(err);
      });
    }
    throw new AppError(`Could not record the offline refund: ${err.message}. Nothing was recorded — try again.`, 500);
  }

  // ── Phase 2 ────────────────────────────────────────────────────────────────
  await bestEffort('order mirror', async () => {
    order.refundDetails = {
      requestedAt: rr.refund.initiatedAt,
      amount: finalAmount,
      refundType: finalAmount >= order.totalAmount ? 'full' : 'partial',
      refundMethod: 'offline',
      itemsRefunded: rr.items.map((it) => ({ product: it.product, quantity: it.quantity, amount: money(it.unitPrice * it.quantity) })),
      status: 'completed',
      processedBy: req.user._id,
      processedAt: settledAt,
      // The operator's reference IS the transaction id for a payout with no gateway.
      transactionId: reference,
      // `remainingRefundable` keys off this prefix to tell a return-sourced summary
      // apart from a cancellation refund — do not reword without updating it.
      notes: `Return ${rr._id}`,
    };
    // Payment axis, matching applyReturnRefundWebhook exactly: only a refund covering
    // the whole order value flips it: a partial per-line return leaves the order `paid`.
    // Without this an offline full refund left the order reading `paid` forever — there
    // is no webhook coming to do it — so revenue/LTV reporting kept counting it as a sale.
    if (finalAmount >= order.totalAmount) {
      order.paymentStatus = 'refunded';
    }
    await order.save();
    await orderRepository.setReturnRequestStatus(rr.order, 'refund_processed');
  });

  // Only when a Payment row exists — a legacy order may have none, and there is then
  // nothing to accumulate against.
  if (payment) {
    await bestEffort('payment record', async () => {
      if (await returnRequestRepository.claimPaymentRecord(rr._id)) {
        await paymentRepository.recordRefund(payment._id, finalAmount, 'return_refund_offline');
      }
    });
  }
  // reverseReturnLtvOnce swallows its own errors, but wrap it anyway so a future
  // change there cannot reach back into this path.
  await bestEffort('LTV reversal', () => reverseReturnLtvOnce(rr._id.toString()));

  // Finance always hears about money leaving. The customer is told only on request —
  // they were handed the money in person, so an unsolicited "your refund is on its
  // way, allow 5-9 working days" would be actively wrong.
  await bestEffort('notifications', async () => {
    enqueueNotification('send-admin-return-refunded-alert', { returnId: rr._id.toString() });
    if (req.body.notifyCustomer && rr.user) {
      enqueueNotification('send-return-status-email', { returnId: rr._id.toString(), event: 'refunded' });
    }
  });

  await bestEffort('audit log', () => auditLogger.logAction(req, 'RETURN_OFFLINE_REFUND', 'ReturnRequest', rr._id, {
    orderId: String(rr.order),
    amount: finalAmount,
    offlineMethod,
    reference,
  }));

  return res.json({
    success: true,
    message: warnings.length
      ? `Recorded ₹${finalAmount} refunded by ${label}. Some follow-up steps need checking: ${warnings.join(', ')}.`
      : `Recorded ₹${finalAmount} refunded by ${label}.`,
    refund: { id: reference, status: 'completed', amount: finalAmount, method: 'offline' },
    ...(warnings.length ? { warnings } : {}),
    request: rr,
  });
};

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
  const method = req.body.method === 'offline' ? 'offline' : 'original_payment';
  const isOffline = method === 'offline';
  const OFFLINE_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'other'];
  const offlineMethod = isOffline ? String(req.body.offlineMethod || '').trim() : null;
  const reference = isOffline ? String(req.body.reference || '').trim() : null;
  if (isOffline) {
    if (!OFFLINE_METHODS.includes(offlineMethod)) {
      throw new AppError(`How the money was paid back is required (${OFFLINE_METHODS.join(', ')}).`, 400);
    }
    if (!reference) {
      throw new AppError('A reference (UTR, cheque number, or receipt number) is required — it is the only proof the money moved.', 400);
    }
  }
  const paidAt = isOffline && req.body.paidAt ? new Date(req.body.paidAt) : null;
  if (paidAt && Number.isNaN(paidAt.getTime())) {
    throw new AppError('The payout date is not a valid date.', 400);
  }

  const existing = await returnRequestRepository.findById(req.params.id);
  if (!existing) {
    throw new AppError('Return request not found', 404);
  }
  // Friendly pre-checks for a fast, readable 4xx. These are NOT the real guard —
  // the atomic claimForRefund() below is what actually serializes concurrent
  // requests; these just avoid doing work / returning an opaque 409 in the common case.
  if (existing.status !== 'received' || existing.inspection?.passed !== true) {
    throw new AppError('Refund can only be initiated after the item is received and passes inspection.', 400);
  }
  if (['processing', 'completed'].includes(existing.refund?.status)) {
    throw new AppError(`A refund for this return is already ${existing.refund.status}.`, 409);
  }

  // Recompute the base from the ORDER — never from existing.refund.productValue, which
  // is a create-time hint and, for returns raised before 2026-08-03, a GROSS figure.
  const { order, payment, refundable, headroom } = await resolveRefundBasis(existing);

  const shippingDeduction = money(Math.max(0, Number(req.body.shippingDeduction) || 0));
  const restockingDeduction = money(Math.max(0, Number(req.body.restockingDeduction) || 0));
  const productValue = refundable.netRupees;
  const finalAmount = money(productValue - shippingDeduction - restockingDeduction);

  // finalAmount can only be ≤ productValue (both deductions are clamped ≥ 0), so the
  // only real bound to assert is that something is left to refund after deductions.
  if (finalAmount <= 0) {
    throw new AppError('The refund amount after deductions must be greater than ₹0.', 400);
  }

  // Gateway headroom guard. Razorpay rejects a refund above the captured amount with
  // an opaque error AFTER we have already claimed the return into `processing`; this
  // catches it first, before any state moves, and says which number is wrong. It is
  // also the backstop against a second return on the same order over-drawing it.
  if (finalAmount > headroom.remainingRupees) {
    throw new AppError(
      `Refund of ₹${finalAmount} exceeds what is left on this order (₹${headroom.remainingRupees} of ₹${headroom.capturedRupees} captured` +
      `${headroom.alreadyRefundedRupees > 0 ? `, ₹${headroom.alreadyRefundedRupees} already refunded` : ''}). ` +
      'Reduce the amount or refund the balance manually in the Razorpay dashboard.',
      422
    );
  }

  // Money can only be given back if it was taken in the first place. This gate applies
  // to BOTH paths: the headroom above is derived from `order.totalAmount`, which is what
  // the order is WORTH, not what was collected — so without this an unpaid order (an
  // offline deal whose Razorpay payment link was never paid, sitting at
  // `awaiting_payment`) would happily accept a full "refund" of money nobody ever sent.
  if (order.paymentStatus !== 'paid') {
    throw new AppError(
      `This order is not paid (payment status "${order.paymentStatus || 'pending'}"), so there is nothing to refund. ` +
      'If money was collected outside the system, record the payment on the order first.',
      422,
    );
  }

  // The two remaining preconditions are GATEWAY-specific and are skipped for money
  // already handed back by hand: a paid legacy/imported order can have no Razorpay
  // payment id to refund against, and the debit-card-EMI constraint belongs to the
  // ISSUER, which a cash payout never touches. Between them these are what the old code
  // meant by "settle outside the gateway and record manually" while offering no way to
  // record it.
  if (!isOffline) {
    // Resolve the captured Razorpay payment on the order BEFORE claiming, so an order
    // that can't be refunded online never leaves a return stranded in `processing`.
    if (!payment || !payment.gatewayPaymentId) {
      throw new AppError('No Razorpay payment id on file — refund in the dashboard and record it here as an offline refund.', 422);
    }

    // Instrument constraint (debit-card EMI = full refund only). Checked HERE, after the
    // amount is final but before claimForRefund, so a refund the gateway would reject
    // never leaves the return stranded in `processing`.
    const blockReason = partialRefundBlockReason(payment, finalAmount, headroom.capturedRupees);
    if (blockReason) {
      throw new AppError(blockReason, 422);
    }
  }

  const amountPaise = Math.round(finalAmount * 100);

  // Atomically claim the refund into `processing` (the serialization point) BEFORE
  // touching the gateway. A double-click / two-admin race resolves to a single
  // winner here; the loser matches zero docs, gets null, and 409s — never firing a
  // second Razorpay refund. `rr` is the freshly-claimed document we mutate below.
  const rr = await returnRequestRepository.claimForRefund(req.params.id, {
    productValue,
    listValue: refundable.grossRupees,
    discountShare: refundable.discountShareRupees,
    shippingDeduction, restockingDeduction, finalAmount, initiatedBy: req.user._id,
    method, offlineMethod, reference, paidAt,
  });
  if (!rr) {
    throw new AppError('This refund is already being processed.', 409);
  }

  if (isOffline) {
    return recordOfflineRefund(req, res, {
      rr, order, payment, finalAmount, offlineMethod, reference, paidAt,
    });
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
      // `remainingRefundable` keys off this prefix to tell a return-sourced summary
      // apart from a cancellation refund — do not reword without updating it.
      notes: `Return ${rr._id}`,
    };
    await order.save();
    await orderRepository.setReturnRequestStatus(rr.order, 'refund_processed');

    // Payment axis: a partial return refund never touched the Payment row, so the
    // finance view read ₹0 refunded on an order that had money sent back. ACCUMULATE
    // (never assign) — an order can have several partial refunds and each must add.
    // Only the full-value case marks the row `refunded`; a partial leaves it `completed`.
    //
    // Behind a once-only claim: the $inc is not idempotent, and for an instant refund
    // the refund.processed webhook can arrive before the save above lands, at which
    // point both paths believe they are the one to record it.
    if (completed && await returnRequestRepository.claimPaymentRecord(rr._id)) {
      await paymentRepository.recordRefund(payment._id, finalAmount, 'return_refund');
    }

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
    // 502, and OPERATIONAL: a gateway rejection is the gateway's answer, not a fault in
    // this service. Thrown as a bare Error it became a 500 that paged on-call and showed
    // the operator "Something went wrong" while the real reason sat in the logs.
    throw new AppError(`Refund failed at the gateway: ${err.message}`, 502);
  }
});
