/**
 * Returns in the team panel — the owner-approved workflow (2026-10-30, rule 9).
 *
 *   1. Request        a salesperson raises it for the customer, or the customer on the
 *                     website (which alerts the seller to call them)
 *   2. Check 1        operations reviews the evidence: approve/reject, confirm the fault
 *                     per line, confirm where the item goes (our warehouse, or straight
 *                     to the supplier — pre-filled from the order)
 *   3. Pickup         our warehouse: operations books the courier or marks "dropped at
 *                     store". Direct to supplier: procurement arranges it. Two failed
 *                     pickups cancel the request.
 *   4. Check 2        operations inspects the item (for a direct-to-supplier return,
 *                     procurement records the supplier's check and operations confirms it)
 *   5. Three INDEPENDENT tracks, none waiting for another:
 *        A. the customer refund (accounts) — services/returnRefundService.js
 *        B. the supplier claim (procurement), only for lines bought from a supplier
 *        C. replacement — phase 2
 *   6. Supplier money received (accounts), once, compare-and-set
 *
 * Every step is a compare-and-set on the state the person saw, so a double-click or two
 * people at once get one winner. Every step is audit-logged, posts to team chat (which
 * also pushes to phones) and, where the customer should know, emails them once.
 *
 * Who may do what (rule 9 "Permissions"):
 *   raise                                  canSell, operations, admin
 *   check 1, check 2, pickup to warehouse  operations, admin
 *   supplier track, direct-to-supplier     procurement, admin
 *   customer refund                        accounts (≤ ₹25,000), accounts head, admin
 *                                          — Razorpay only; bank/cash payouts: admin
 *   supplier money received                accounts, admin
 * Procurement can never send customer refunds; sales can never approve or refund.
 */

import { closeExtrasBestEffort } from './extraChargeEffects.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import * as Sentry from '@sentry/node';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import productRepository from '../repositories/productRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import { enqueueNotification } from '../queue/queues.js';
import { RETURN_CHAT_JOB } from './chatBusinessUpdates.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import {
  RETURN_REASONS,
  STAFF_ONLY_REASONS,
  IN_FLIGHT_RETURN_STATUSES,
  FAULTS,
  DISPOSITIONS,
  FAILED_INSPECTION_ACTIONS,
  HOLD_REJECTED_DAYS,
  MAX_FAILED_PICKUPS,
  REPEAT_RETURNER_DAYS,
  ACCOUNTS_REFUND_LIMIT_RUPEES,
  SUPPLIER_SETTLEMENT_KINDS,
  SUPPLIER_MONEY_METHODS,
  RETURN_REASON_LABELS,
  RETURN_MAX_PHOTOS as MAX_RETURN_PHOTOS,
  claimedFaultFor,
  effectiveFault,
  windowDaysFor,
  VIDEO_MAX_MB,
} from '../config/returnPolicy.js';
import { refundableForLines, matchOrderLine, returnRefundBreakdown, RefundBreakdownError } from './refundMathService.js';
import { previewRefund, initiateRefund, money } from './returnRefundService.js';
import { verifyVideo, verifyProof, verifyPhotos, uploadTargets, withSignedEvidence } from './returnEvidence.js';
import { verifyVideoLink } from '../utils/returnVideoLink.js';
import { supportsPartialRefund, describeEmiPlan } from '../utils/paymentMethodDetails.js';
import { deliveredAtForItem } from '../utils/orderFulfilment.js';
import { coversEveryDeliveredLine, deliveredQuantityByProduct } from '../utils/orderReturns.js';
import { variantDisplayName } from '../utils/orderLines.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { and, amountOf, istRange, keysetPage, plainQuery, searchClauses, searchWords } from '../utils/listQuery.js';
import { storeAll } from './storage/storeAll.js';
import { cleanRichTextWithin, richTextToPlain } from '../utils/richText.js';

const PAGE_SIZE = 25;
const FILE_FOLDER = 'return-files'; // a PRIVATE prefix (storage/assetScope.js)
const DAY_MS = 24 * 60 * 60 * 1000;

const fail = (message, status) => new AppError(message, status, { expose: true });
const RACE = 'Someone else just updated this return. Refresh and try again.';

// ── Who is acting ───────────────────────────────────────────────────────────────

const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isHeadOf = (u, team) => onTeam(u, team) && u.staff.isHead === true;
const actorName = (u) => u?.name || (isAdmin(u) ? 'Admin' : 'Staff');

export const can = {
  raise: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.OPERATIONS) || canSell(u),
  operations: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.OPERATIONS),
  procurement: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.PROCUREMENT),
  /** May open the refund queue at all (the amount limit is checked per refund). */
  accounts: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS),
  /** May send a customer refund of `rupees` by `method`. */
  refund: (u, rupees, method = 'original_payment') => {
    if (isAdmin(u)) return true;
    if (!onTeam(u, STAFF_TEAMS.ACCOUNTS)) return false;
    // Bank-transfer / cash payouts are recorded by an admin only (owner, 2026-10-30).
    if (method === 'offline') return false;
    return isHeadOf(u, STAFF_TEAMS.ACCOUNTS) || Number(rupees) <= ACCOUNTS_REFUND_LIMIT_RUPEES;
  },
  /** Everything, newest first: every team that works returns, plus the GTM head. */
  seeAll: (u) => isAdmin(u)
    || [STAFF_TEAMS.OPERATIONS, STAFF_TEAMS.PROCUREMENT, STAFF_TEAMS.ACCOUNTS].some((t) => onTeam(u, t))
    || isHeadOf(u, STAFF_TEAMS.SALES),
};

/** May this person see this return? A GTM lead sees the ones they raised or sold. */
function canView(u, rr) {
  if (can.seeAll(u)) return true;
  if (!canSell(u)) return false;
  return idOf(rr.raisedBy) === idOf(u._id) || idOf(rr.seller) === idOf(u._id);
}

// ── Small shared pieces ─────────────────────────────────────────────────────────

// The same reference the team order lists show.
const orderRef = (order) => order?.orderNumber || (order?.wpId ? `#${order.wpId}` : idOf(order?._id).slice(-8).toUpperCase());
const returnRef = (rr) => idOf(rr?._id).slice(-8).toUpperCase();
const customerName = (order) => order?.shippingAddress?.fullName || order?.user?.name || 'the customer';
/** Last 10 digits — one customer, however the number was typed. */
export const phoneKey = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};
const daysSince = (date) => (Date.now() - new Date(date).getTime()) / DAY_MS;
const timelineEntry = (status, note, actor) => ({ status, note, updatedBy: actor?._id || null, timestamp: new Date() });
const trimmed = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/**
 * The supplier's check notes: internal (procurement and operations only), so they
 * may be formatted. Cleaned here; the timeline gets the plain words, which is also
 * what the customer-facing pieces (rejection reason, emails) are built from elsewhere.
 */
const SUPPLIER_NOTES_MAX = 1000;
function supplierNotes(raw) {
  if (raw != null && typeof raw !== 'string') throw fail('The notes must be text.', 400);
  const { value, tooLong } = cleanRichTextWithin(raw, SUPPLIER_NOTES_MAX);
  if (tooLong) throw fail(`Keep the notes under ${SUPPLIER_NOTES_MAX} characters.`, 400);
  return { notes: value, plain: richTextToPlain(value).replace(/\s+/g, ' ') };
}
/**
 * A plain copy of a return line. A line loaded from the database is a Mongoose
 * subdocument, and spreading one copies none of its fields — the same trap that once
 * priced every database-loaded refund at ₹0 (refundMathService.returnRefundBreakdown).
 */
const plain = (item) => (typeof item?.toObject === 'function' ? item.toObject() : item);

const chat = (event, rr, extra = {}) =>
  enqueueNotification(RETURN_CHAT_JOB, { event, returnId: idOf(rr._id), ...extra });
const emailCustomer = (rr, event) =>
  enqueueNotification('send-return-status-email', { returnId: idOf(rr._id), event });

/**
 * Move the order onto the `returned` fulfilment stage — but ONLY if the returns now
 * account for everything the customer received. Moved here from returnController (the
 * reasoning is unchanged and lives there in the git history): a partial return leaves
 * the order `delivered` so the rest stays returnable. Compare-and-set, never throws.
 */
export const syncOrderReturnedStatus = async (orderId, userId, note) => {
  try {
    const order = await orderRepository.findById(orderId);
    if (!order) return false;
    const returnedByProduct = await returnRequestRepository.returnedQuantityByProduct(orderId);
    if (!coversEveryDeliveredLine(order, returnedByProduct)) return false;
    const returned = await orderRepository.markReturnedOnReturnApproval(orderId, userId, note);
    if (returned) await closeExtrasBestEffort(orderId, 'Order returned');
    return returned;
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

/** Load a return the actor may see, or 404 (never say it exists to someone who may not). */
async function loadVisible(actor, id) {
  const rr = await returnRequestRepository.findById(id);
  if (!rr || !canView(actor, rr)) throw fail('Return not found.', 404);
  return rr;
}

// ── Raising a return (staff, on the customer's behalf) ──────────────────────────

/**
 * When a line reached the customer. Per parcel on a split order (deliveredAtForItem);
 * a legacy order with no parcels falls back to the order's own delivery date.
 */
const lineDeliveredAt = (order, orderLine) => {
  const hasParcels = (order.shipments || []).length > 0;
  return deliveredAtForItem(order, orderLine._id)
    ?? (hasParcels ? null : (order.deliveredAt || order.updatedAt || null));
};

const RETURNABLE_ORDER_STATUSES = ['delivered', 'returned'];

/**
 * Validate and snapshot the lines of a new return against the order. The rules are the
 * owner-approved ones, applied the same whoever raises it:
 *   - an order line (never a custom/installation line — those are refunded WITH a return);
 *   - delivered, and inside its window — 7 days for our fault, 4 for the customer's reason;
 *   - a customer-reason line needs a returnable product (the non-returnable list applies
 *     to customer reasons ONLY: defective/wrong goods are always accepted — Consumer
 *     Protection (E-Commerce) Rules 2020) and the unused-in-box declaration;
 *   - never more units than were delivered and are not already claimed;
 *   - one in-flight return per product; a rejected product goes to support, not a retry.
 */
export async function buildLines(order, items, { allowStaffReasons, unusedDeclared, products }) {
  const isSplit = (order.shipments || []).length > 0;
  const statuses = isSplit ? [...RETURNABLE_ORDER_STATUSES, 'shipped'] : RETURNABLE_ORDER_STATUSES;
  if (!statuses.includes(order.status)) throw fail('Only delivered orders can be returned.', 400);
  if (!Array.isArray(items) || items.length === 0) throw fail('Choose at least one item to return.', 400);

  const seen = new Set();
  const lines = [];
  for (const item of items) {
    const orderLine = matchOrderLine(order.items, { itemId: item.itemId, product: item.productId, variantId: item.variantId });
    if (!orderLine) throw fail('One of the chosen items is not part of this order.', 400);
    const lineKey = idOf(orderLine._id);
    if (seen.has(lineKey)) throw fail('The same item is listed twice — enter the full quantity once.', 400);
    seen.add(lineKey);

    const productId = orderLine.product?._id || orderLine.product;
    const product = productId ? products?.get(idOf(productId)) : null;
    const name = variantDisplayName(product?.name || orderLine.name, orderLine.variantLabel);
    if (orderLine.custom === true || !productId) {
      throw fail(`"${orderLine.name || 'This line'}" is not a catalogue item. Installation is refunded with the item's return, not on its own.`, 400);
    }
    if (!RETURN_REASONS.includes(item.reason)) throw fail(`Choose a return reason for "${name}".`, 400);
    if (!allowStaffReasons && STAFF_ONLY_REASONS.includes(item.reason)) {
      throw fail('Damage by our installer is recorded by our team — please call us.', 400);
    }

    const fault = claimedFaultFor(item.reason);
    const deliveredAt = lineDeliveredAt(order, orderLine);
    if (!deliveredAt) throw fail(`"${name}" hasn't been delivered yet, so it can't be returned.`, 400);
    const windowDays = windowDaysFor(fault);
    if (daysSince(deliveredAt) > windowDays) {
      throw fail(
        `The return window for "${name}" has closed: ${windowDays} days from delivery for `
        + `${fault === 'ours' ? 'a fault on our side' : "the customer's own reason"}.`,
        400,
      );
    }
    if (fault === 'customer') {
      if (product?.returnPolicy?.returnable === false) {
        throw fail(`"${name}" can't be returned for the customer's own reason (it is on the non-returnable list). A fault on our side is always accepted.`, 400);
      }
      if (!unusedDeclared) {
        throw fail('A return for the customer\'s own reason needs the item unused, not installed, and in its original box — tick the declaration.', 400);
      }
    }

    const quantity = Math.floor(Number(item.quantity) || 0);
    if (quantity < 1) throw fail(`Enter how many of "${name}" are coming back.`, 400);
    lines.push({
      product: productId,
      orderItemId: orderLine._id,
      variantId: orderLine.variantId || null,
      variantLabel: orderLine.variantLabel || null,
      quantity,
      reason: item.reason,
      fault: { claimed: fault },
      unitPrice: money(orderLine.price),
      _name: name,
    });
  }

  // One read for every line: in-flight and rejected returns on these products.
  const productIds = lines.map((l) => l.product);
  const clashes = await returnRequestRepository.find({
    order: order._id,
    'items.product': { $in: productIds },
    status: { $in: [...IN_FLIGHT_RETURN_STATUSES, 'rejected'] },
  }).select('status items.product').lean();
  for (const line of lines) {
    const hit = clashes.find((c) => (c.items || []).some((i) => idOf(i.product) === idOf(line.product)));
    if (hit?.status === 'rejected') {
      throw fail(`A return for "${line._name}" was reviewed and declined. Raise it with admin if it should be looked at again.`, 409);
    }
    if (hit) throw fail(`A return for "${line._name}" is already in progress.`, 409);
  }

  // Never more units than were DELIVERED (cancelled units never were) and are unclaimed.
  const delivered = deliveredQuantityByProduct(order);
  const consumed = await returnRequestRepository.returnedQuantityByProduct(order._id);
  const wanted = new Map();
  for (const line of lines) wanted.set(idOf(line.product), (wanted.get(idOf(line.product)) || 0) + line.quantity);
  for (const [productId, qty] of wanted) {
    const left = (delivered.get(productId) || 0) - (consumed.get(productId) || 0);
    if (qty > left) {
      const name = lines.find((l) => idOf(l.product) === productId)._name;
      throw fail(left > 0 ? `Only ${left} of "${name}" can still be returned.` : `Every delivered "${name}" has already been returned.`, 409);
    }
  }
  return lines.map(({ _name, ...l }) => l);
}

/** Name + return policy of every catalogue product on the order, by id. */
const returnProducts = (order) => productRepository.findReturnPolicies(
  (order.items || []).map((l) => l.product).filter(Boolean),
);

/**
 * Debit-card EMI is refundable only in full at the issuer, so a partial return on such an
 * order can never be paid back. Caught here, before we pay for a pickup.
 */
async function assertEmiAllowsReturn(order, lines) {
  const payment = order.payment ? await paymentRepository.findById(order.payment) : null;
  if (!payment || supportsPartialRefund(payment)) return;
  const live = deliveredQuantityByProduct(order);
  const chosen = new Map();
  for (const l of lines) chosen.set(idOf(l.product), (chosen.get(idOf(l.product)) || 0) + l.quantity);
  const full = live.size === chosen.size && [...live].every(([id, q]) => chosen.get(id) === q);
  if (!full) {
    throw fail(
      `This order was paid using ${describeEmiPlan(payment) || 'Debit Card EMI'}, which the bank can only refund in full. `
      + 'Every item has to come back — or settle it with admin.',
      422,
    );
  }
}

/**
 * The evidence rule: at least one photo, and the unboxing video — uploaded, or a
 * Google Drive / YouTube link when it is too big — on EVERY return (owner, 2026-11-02;
 * see config/returnPolicy.js). Checked only when a return is raised, so requests made
 * under the older rule keep moving.
 */
async function verifyEvidence({ video, videoLink, images, proofOfPurchase }) {
  const linkUrl = verifyVideoLink(videoLink);
  const [videoAsset, photoAssets, proofAsset] = await Promise.all([
    verifyVideo(video), verifyPhotos(images), verifyProof(proofOfPurchase),
  ]);
  if (photoAssets.length === 0) throw fail('Add at least one photo the customer sent.', 400);
  if (!videoAsset && !linkUrl) {
    throw fail(`The unboxing video is required. Upload it (up to ${VIDEO_MAX_MB}MB) or paste a Google Drive or YouTube link.`, 400);
  }
  return { videoAsset, videoLink: videoAsset ? null : linkUrl, photoAssets, proofAsset };
}

/**
 * Staff raise a return for the customer (phone, WhatsApp, walk-in) — origin `staff`.
 * Every policy gate applies; the customer's own photo/video is mandatory.
 */
export async function raiseReturn(actor, input = {}, req = null) {
  if (!can.raise(actor)) throw fail('Only GTM sellers, operations and admin can raise a return.', 403);
  const order = await orderRepository.findForReturn(input.orderId);
  if (!order) throw fail('Order not found.', 404);
  if (order.paymentStatus !== 'paid') {
    throw fail('This order was never paid, so there is nothing to return against.', 422);
  }
  const description = trimmed(input.description, 2000);
  if (!description) throw fail('Describe the problem in a line or two.', 400);

  const products = await returnProducts(order);
  const lines = await buildLines(order, input.items, { allowStaffReasons: true, unusedDeclared: input.unusedDeclared === true, products });
  await assertEmiAllowsReturn(order, lines);
  const { videoAsset, videoLink, photoAssets, proofAsset } = await verifyEvidence(input);

  const { grossRupees, netRupees, discountShareRupees } = refundableForLines(order, lines);
  let rr;
  try {
    rr = await returnRequestRepository.create({
      order: order._id,
      user: order.user || undefined,
      items: lines,
      origin: 'staff',
      raisedBy: actor._id,
      seller: order.salesUser || null,
      customerPhone: phoneKey(order.shippingAddress?.phone),
      unusedDeclaredAt: lines.some((l) => l.fault.claimed === 'customer') ? new Date() : null,
      status: 'pending',
      problemDescription: description,
      video: videoAsset,
      videoLink,
      proofOfPurchase: proofAsset,
      images: photoAssets,
      refund: { productValue: netRupees, listValue: grossRupees, discountShare: discountShareRupees, finalAmount: netRupees, status: 'pending' },
      timeline: [timelineEntry('pending', `Raised by ${actorName(actor)} for the customer`, actor)],
    });
  } catch (err) {
    // unique_inflight_return_per_order_product: someone raised one for the same item first.
    if (err?.code === 11000) throw fail('A return for one of these items was just raised. Refresh and check.', 409);
    throw err;
  }

  await orderRepository.setReturnRequestStatus(order._id, 'pending').catch(() => {});
  // The customer gets the same "we've received your request" email as on the website.
  enqueueNotification('send-return-submitted', { returnId: idOf(rr._id) });
  enqueueNotification('send-admin-return-alert', { returnId: idOf(rr._id) });
  chat('raised_ops', rr);
  auditLogger.logAction(req, 'RETURN_STAFF_RAISE', 'ReturnRequest', rr._id, {
    orderId: idOf(order._id), lines: lines.length, by: actorName(actor),
  });
  return getReturn(actor, rr._id);
}

/**
 * The customer raises a return on the website — the SAME rules as a staff-raised one
 * (buildLines, the EMI check, the evidence rule), minus the staff-only reason. The
 * customer's own photo and the unboxing video (or a Drive/YouTube link) are mandatory;
 * proof of purchase is optional (we hold the order). Their seller — or, for a website
 * order, the sales heads — is told to call them.
 */
export async function createCustomerReturn(user, input = {}, req = null) {
  const order = await orderRepository.findOwnedForReturn(input.orderId, user._id);
  if (!order) throw fail('Order not found', 404);
  const description = trimmed(input.problemDescription, 2000);
  if (!description) throw fail('A description of the problem is required.', 400);

  const products = await returnProducts(order);
  const lines = await buildLines(order, (input.items || []).map((i) => ({
    itemId: i.itemId, productId: i.productId, variantId: i.variantId, quantity: i.quantity, reason: i.reason,
  })), { allowStaffReasons: false, unusedDeclared: input.unusedDeclared === true, products });
  await assertEmiAllowsReturn(order, lines);
  const { videoAsset, videoLink, photoAssets, proofAsset } = await verifyEvidence(input);

  const { grossRupees, netRupees, discountShareRupees } = refundableForLines(order, lines);
  let rr;
  try {
    rr = await returnRequestRepository.create({
      order: order._id,
      user: user._id,
      items: lines,
      origin: 'customer',
      seller: order.salesUser || null,
      customerPhone: phoneKey(order.shippingAddress?.phone),
      unusedDeclaredAt: lines.some((l) => l.fault.claimed === 'customer') ? new Date() : null,
      status: 'pending',
      problemDescription: description,
      video: videoAsset,
      videoLink,
      proofOfPurchase: proofAsset,
      images: photoAssets,
      refund: { productValue: netRupees, listValue: grossRupees, discountShare: discountShareRupees, finalAmount: netRupees, status: 'pending' },
      timeline: [timelineEntry('pending', 'Return request submitted', user)],
    });
  } catch (err) {
    if (err?.code === 11000) throw fail('A return for one of these items is already in progress.', 409);
    throw err;
  }

  // The legacy one-return summary on the order, still read by older admin views.
  await orderRepository.setReturnRequestSummary(order._id, {
    requestedAt: new Date(),
    requestedBy: user._id,
    status: 'pending',
    items: lines.map((l) => ({ product: l.product, quantity: l.quantity, reason: l.reason })),
  }).catch(() => {});

  const returnId = idOf(rr._id);
  enqueueNotification('send-return-submitted', { returnId });
  enqueueNotification('send-admin-return-alert', { returnId });
  enqueueNotification('create-support-ticket', { sourceModel: 'ReturnRequest', sourceId: returnId });
  chat('raised_ops', rr);
  chat('raised_sales', rr);
  auditLogger.logAction(req, 'RETURN_CUSTOMER_CREATE', 'ReturnRequest', rr._id, { orderId: idOf(order._id), lines: lines.length });
  return rr;
}

/**
 * What the customer will roughly get back, before they submit (rule: "the customer sees
 * an estimate"). The server's breakdown for these lines, with no deductions: a
 * customer-reason return also loses the real pickup cost, which is only known later,
 * and installation is refunded only when staff confirm it was ours.
 */
export async function estimateForCustomer(user, input = {}) {
  const order = await orderRepository.findOwnedForReturn(input.orderId, user._id);
  if (!order) throw fail('Order not found', 404);
  const lines = [];
  for (const i of input.items || []) {
    const orderLine = matchOrderLine(order.items || [], { itemId: i.itemId, product: i.productId });
    if (!orderLine || orderLine.custom === true) continue;
    const quantity = Math.max(1, Math.min(Number(i.quantity) || 1, Number(orderLine.quantity) || 1));
    lines.push({ orderItemId: orderLine._id, product: orderLine.product, quantity, reason: i.reason, unitPrice: orderLine.price });
  }
  if (!lines.length) throw fail('Choose at least one item.', 400);
  const b = returnRefundBreakdown(order, { items: lines });
  return {
    goods: fromPaise(b.goodsNetPaise),
    shippingShare: fromPaise(b.shippingSharePaise),
    total: fromPaise(b.totalPaise),
    pickupCostDeducted: b.hasCustomerFault,
    installationOnBill: b.hasOurFault && (order.items || []).some((l) => l.custom === true),
  };
}

/**
 * What the "Raise return" dialog needs for one order: each line still returnable, with
 * its windows, plus the repeat-returner flag. Read-only.
 */
export async function raiseOptions(actor, orderId) {
  if (!can.raise(actor)) throw fail('Not authorized.', 403);
  const order = await orderRepository.findForReturn(orderId);
  if (!order) throw fail('Order not found.', 404);
  const delivered = deliveredQuantityByProduct(order);
  const [consumed, products] = await Promise.all([
    returnRequestRepository.returnedQuantityByProduct(order._id),
    returnProducts(order),
  ]);
  const left = new Map([...delivered].map(([p, q]) => [p, Math.max(0, q - (consumed.get(p) || 0))]));

  const lines = (order.items || [])
    .filter((l) => l.custom !== true && l.product)
    .map((l) => {
      const at = lineDeliveredAt(order, l);
      const productId = idOf(l.product);
      const product = products.get(productId);
      return {
        itemId: idOf(l._id),
        name: variantDisplayName(product?.name || l.name, l.variantLabel),
        unitPrice: l.price,
        quantity: l.quantity,
        returnableQuantity: left.get(productId) || 0,
        deliveredAt: at,
        // When each window closes — the dialog greys out the reasons that are too late.
        windowEnds: at ? {
          ours: new Date(new Date(at).getTime() + windowDaysFor('ours') * DAY_MS),
          customer: new Date(new Date(at).getTime() + windowDaysFor('customer') * DAY_MS),
        } : null,
        returnableForCustomerReason: product?.returnPolicy?.returnable !== false,
      };
    });
  return {
    orderId: idOf(order._id),
    orderNumber: orderRef(order),
    customer: customerName(order),
    paid: order.paymentStatus === 'paid',
    lines,
    repeatReturns: await repeatCount({ user: order.user, customerPhone: phoneKey(order.shippingAddress?.phone) }),
  };
}

/** Requests from this customer in the last six months — a flag for staff, never a block. */
function repeatCount(rr) {
  return returnRequestRepository.countRecentForCustomer(
    { user: rr.user ? idOf(rr.user) : null, phone: rr.customerPhone || null },
    new Date(Date.now() - REPEAT_RETURNER_DAYS * DAY_MS),
  );
}

/** Upload targets for the customer's photos/videos (same store and checks as the website). */
export async function evidenceUploadTargets(actor, files) {
  if (!can.raise(actor)) throw fail('Not authorized.', 403);
  return uploadTargets(files);
}

// ── Check 1: review ─────────────────────────────────────────────────────────────

/**
 * Where an approved item should go, pre-filled for operations: our warehouse by default,
 * with the supplier each returned line came from (the order's workflow line) offered.
 */
export function destinationOptions(order, rr) {
  const wfLines = order?.workflow?.lines || [];
  const suppliers = new Set();
  for (const item of rr.items || []) {
    const orderLine = matchOrderLine(order.items || [], { ...plain(item), itemId: item.orderItemId });
    const wf = orderLine && wfLines.find((l) => idOf(l.itemId) === idOf(orderLine._id));
    if (wf?.supplierName && wf.stock !== 'own_stock') suppliers.add(wf.supplierName);
  }
  return { default: 'warehouse', suppliers: [...suppliers] };
}

/**
 * Operations' check 1. Approve (confirming the fault on every line and where the item
 * goes) or reject with a reason. Installer-damage cases go to admin.
 */
export async function reviewReturn(actor, id, input = {}, req = null) {
  if (!can.operations(actor)) throw fail('Only operations can review a return.', 403);
  const rr = await loadVisible(actor, id);
  if (rr.status !== 'pending') throw fail(`This return was already ${rr.status.replace('_', ' ')}.`, 409);
  const decision = input.decision;
  const notes = trimmed(input.notes, 1000);

  if (decision === 'reject') {
    const reason = trimmed(input.rejectionReason, 1000);
    if (!reason) throw fail('Say why the return is rejected — the customer is told.', 400);
    const done = await returnRequestRepository.transitionIf(id, { status: 'pending' }, {
      $set: { status: 'rejected', rejectionReason: reason, reviewedBy: actor._id, reviewedAt: new Date(), ...(notes && { adminNotes: notes }) },
      $push: { timeline: timelineEntry('rejected', reason, actor) },
    });
    if (!done) throw fail(RACE, 409);
    await orderRepository.setReturnRequestStatus(done.order, 'rejected').catch(() => {});
    emailCustomer(done, 'rejected');
    chat('rejected', done);
    auditLogger.logAction(req, 'RETURN_REJECT', 'ReturnRequest', done._id, { reason });
    return getReturn(actor, id);
  }
  if (decision !== 'approve') throw fail('Approve or reject.', 400);

  if (rr.items.some((i) => i.reason === 'installer_damage') && !isAdmin(actor)) {
    throw fail('Damage by our installer is decided by admin.', 403);
  }

  // Confirm each line's fault (default: what the reason claimed). A change needs a note.
  const faults = input.faults || {};
  const now = new Date();
  const items = rr.items.map((item, i) => {
    const key = idOf(item.orderItemId) || String(i);
    const choice = faults[key] || faults[String(i)] || {};
    const claimed = item.fault?.claimed || claimedFaultFor(item.reason);
    const confirmed = choice.confirmed ?? claimed;
    if (!FAULTS.includes(confirmed)) throw fail('Choose "our fault" or "customer\'s reason" for each item.', 400);
    const note = trimmed(choice.note, 500);
    if (confirmed !== claimed && !note) throw fail('Add a note when you change whose fault it is.', 400);
    return { ...item.toObject(), fault: { claimed, confirmed, changedBy: actor._id, changedAt: now, note: note || null } };
  });

  // Where it goes. Supplier needs the supplier's name.
  const kind = input.destination?.kind || 'warehouse';
  if (!['warehouse', 'supplier'].includes(kind)) throw fail('Choose where the item goes.', 400);
  const supplierName = kind === 'supplier' ? trimmed(input.destination?.supplierName, 120) : null;
  if (kind === 'supplier' && !supplierName) throw fail('Name the supplier the item goes to.', 400);

  const done = await returnRequestRepository.transitionIf(id, { status: 'pending' }, {
    $set: {
      status: 'approved',
      items,
      destination: { kind, supplierName },
      reviewedBy: actor._id,
      reviewedAt: now,
      resolution: 'refund',
      ...(notes && { adminNotes: notes }),
    },
    $push: { timeline: timelineEntry('approved', kind === 'supplier' ? `Approved — goes straight to ${supplierName}` : 'Approved — pickup to our warehouse', actor) },
  });
  if (!done) throw fail(RACE, 409);

  await orderRepository.setReturnRequestStatus(done.order, 'approved').catch(() => {});
  await syncOrderReturnedStatus(done.order, actor._id, `Return ${done._id} approved`);
  emailCustomer(done, 'approved');
  chat('approved', done);
  if (kind === 'supplier') chat('supplier_pickup', done);
  auditLogger.logAction(req, 'RETURN_APPROVE', 'ReturnRequest', done._id, {
    destination: kind, faults: items.map((i) => i.fault.confirmed),
  });
  return getReturn(actor, id);
}

// ── Pickup ──────────────────────────────────────────────────────────────────────

/**
 * Book (or correct) the pickup: a courier to our warehouse (operations), or straight to
 * the supplier (procurement, recording whether the supplier or we booked it). Courier
 * and AWB are mandatory — they are our only claim handle if the parcel goes missing.
 */
export async function bookPickup(actor, id, input = {}, req = null) {
  const rr = await loadVisible(actor, id);
  const toSupplier = rr.destination?.kind === 'supplier';
  if (toSupplier ? !can.procurement(actor) : !can.operations(actor)) {
    throw fail(toSupplier ? 'Procurement arranges a pickup that goes to the supplier.' : 'Operations books the pickup.', 403);
  }
  if (!['approved', 'courier_booked'].includes(rr.status)) {
    throw fail(rr.status === 'pending' ? 'Approve the return first.' : `The pickup can no longer be changed (this return is ${rr.status}).`, 409);
  }
  const provider = trimmed(input.provider, 80);
  const trackingNumber = trimmed(input.trackingNumber, 80);
  if (!provider) throw fail('Enter the courier name.', 400);
  if (!trackingNumber) throw fail('Enter the tracking / AWB number.', 400);
  const bookedBy = toSupplier ? (input.bookedBy === 'supplier' ? 'supplier' : 'us') : 'us';

  const isCorrection = rr.status === 'courier_booked';
  if (isCorrection && rr.courier?.provider === provider && rr.courier?.trackingNumber === trackingNumber) {
    return getReturn(actor, id);
  }
  const done = await returnRequestRepository.transitionIf(id, { status: rr.status, 'courier.trackingNumber': rr.courier?.trackingNumber ?? null }, {
    $set: {
      status: 'courier_booked',
      courier: {
        provider,
        trackingNumber,
        bookedAt: rr.courier?.bookedAt || new Date(),
        bookedBy: actor._id,
        correctedAt: isCorrection ? new Date() : null,
      },
      pickup: { mode: toSupplier ? 'supplier_direct' : 'courier', bookedBy, at: rr.pickup?.at || new Date(), note: null },
    },
    $push: {
      timeline: timelineEntry('courier_booked', isCorrection
        ? `Courier details corrected to ${provider} (AWB ${trackingNumber})`
        : `${toSupplier ? `Pickup to ${rr.destination.supplierName}` : 'Pickup'} booked${bookedBy === 'supplier' ? ' by the supplier' : ''} with ${provider} (AWB ${trackingNumber})`, actor),
    },
  });
  if (!done) throw fail(RACE, 409);
  emailCustomer(done, 'courier_booked');
  auditLogger.logAction(req, 'RETURN_PICKUP_BOOKED', 'ReturnRequest', done._id, { provider, trackingNumber, toSupplier, isCorrection });
  return getReturn(actor, id);
}

/** Operations: the customer brought the item to the store — straight to `received`. */
export async function markDroppedAtStore(actor, id, input = {}, req = null) {
  if (!can.operations(actor)) throw fail('Operations records a drop-off.', 403);
  const rr = await loadVisible(actor, id);
  if (rr.destination?.kind === 'supplier') throw fail('This return goes to the supplier, not our store.', 409);
  if (rr.status !== 'approved') throw fail(rr.status === 'pending' ? 'Approve the return first.' : `This return is already ${rr.status.replace('_', ' ')}.`, 409);
  const note = trimmed(input.note, 500);
  const done = await returnRequestRepository.transitionIf(id, { status: 'approved' }, {
    $set: { status: 'received', pickup: { mode: 'dropped_at_store', bookedBy: null, note: note || null, at: new Date() } },
    $push: { timeline: timelineEntry('received', `Dropped at the store${note ? ` — ${note}` : ''} — waiting for inspection`, actor) },
  });
  if (!done) throw fail(RACE, 409);
  await orderRepository.setReturnRequestStatus(done.order, 'item_received').catch(() => {});
  emailCustomer(done, 'received');
  auditLogger.logAction(req, 'RETURN_DROPPED_AT_STORE', 'ReturnRequest', done._id, { note });
  return getReturn(actor, id);
}

/**
 * The item arrived: at our warehouse (operations), or at the supplier for a
 * direct-to-supplier return (procurement).
 */
export async function markReceived(actor, id, input = {}, req = null) {
  const rr = await loadVisible(actor, id);
  const atSupplier = rr.pickup?.mode === 'supplier_direct';
  if (atSupplier ? !can.procurement(actor) : !can.operations(actor)) {
    throw fail(atSupplier ? 'Procurement records that the supplier has it.' : 'Operations records the item as received.', 403);
  }
  if (rr.status !== 'courier_booked') throw fail('The item can be marked received only after the pickup is booked.', 409);
  const note = trimmed(input.note, 500);
  const done = await returnRequestRepository.transitionIf(id, { status: 'courier_booked' }, {
    $set: { status: 'received' },
    $push: { timeline: timelineEntry('received', atSupplier
      ? `Reached ${rr.destination?.supplierName || 'the supplier'}${note ? ` — ${note}` : ''} — waiting for the supplier's check`
      : `Item received at our warehouse${note ? ` — ${note}` : ''} — waiting for inspection`, actor) },
  });
  if (!done) throw fail(RACE, 409);
  await orderRepository.setReturnRequestStatus(done.order, 'item_received').catch(() => {});
  emailCustomer(done, 'received');
  auditLogger.logAction(req, 'RETURN_RECEIVED', 'ReturnRequest', done._id, { atSupplier });
  return getReturn(actor, id);
}

/**
 * A pickup attempt failed. The attempt is pushed only while fewer than
 * MAX_FAILED_PICKUPS are recorded, so two people recording the same failure at once
 * still count it as two only if they were two; the request is cancelled exactly once
 * when the count reaches the limit (compare-and-set on its status).
 */
export async function recordPickupFailed(actor, id, input = {}, req = null) {
  const rr = await loadVisible(actor, id);
  const toSupplier = rr.destination?.kind === 'supplier';
  if (toSupplier ? !can.procurement(actor) : !can.operations(actor)) throw fail('Not authorized.', 403);
  if (!['approved', 'courier_booked'].includes(rr.status)) throw fail('There is no pickup waiting on this return.', 409);
  const note = trimmed(input.note, 500);
  if (!note) throw fail('Say what happened (customer not home, refused, wrong address…).', 400);
  const seen = (rr.pickupAttempts || []).length;
  if (seen >= MAX_FAILED_PICKUPS) throw fail(RACE, 409);

  const pushed = await returnRequestRepository.transitionIf(id, {
    status: { $in: ['approved', 'courier_booked'] },
    [`pickupAttempts.${seen}`]: { $exists: false },
  }, {
    $push: {
      pickupAttempts: { at: new Date(), note, by: actor._id },
      timeline: timelineEntry(rr.status, `Pickup attempt ${seen + 1} failed — ${note}`, actor),
    },
  });
  if (!pushed) throw fail(RACE, 409);
  auditLogger.logAction(req, 'RETURN_PICKUP_FAILED', 'ReturnRequest', pushed._id, { attempt: seen + 1, note });

  if ((pushed.pickupAttempts || []).length < MAX_FAILED_PICKUPS) return getReturn(actor, id);

  const cancelled = await returnRequestRepository.transitionIf(id, { status: { $in: ['approved', 'courier_booked'] } }, {
    $set: { status: 'cancelled' },
    $push: { timeline: timelineEntry('cancelled', `Cancelled automatically after ${MAX_FAILED_PICKUPS} failed pickups`, null) },
  });
  if (cancelled) {
    await orderRepository.setReturnRequestStatus(cancelled.order, 'cancelled').catch(() => {});
    // The customer still has the goods: undo an approval-time `returned` flip.
    await orderRepository.revertReturnToDelivered(cancelled.order, actor._id, `Return ${cancelled._id} cancelled after failed pickups`).catch(() => {});
    emailCustomer(cancelled, 'pickup_failed');
    chat('pickup_cancelled', cancelled);
    auditLogger.logAction(req, 'RETURN_AUTO_CANCELLED', 'ReturnRequest', cancelled._id, { reason: 'failed_pickups' });
  }
  return getReturn(actor, id);
}

// ── Files staff attach ──────────────────────────────────────────────────────────

const resourceTypeOf = (ref) => (ref?.contentType === 'application/pdf' ? 'raw' : 'image');
const removeFiles = (refs) => Promise.all(refs.map((r) =>
  deletePrivateAsset({ publicId: r.publicId, resourceType: resourceTypeOf(r), provider: r.provider }).catch(() => {})));

/** Check, then store privately, a batch of photos/PDFs; all or nothing. */
async function storeFiles(files, { rr, actor, purpose, claimId = null, existing = 0 }) {
  const checked = checkAttachments(files, { existing, noun: 'photo' });
  if (!checked.length) return [];
  return storeAll(checked, async ({ file, contentType, ext, name }) => {
    const ref = await putPrivateAsset({
      buffer: file.buffer, folder: FILE_FOLDER,
      basename: `${purpose}-${idOf(rr._id)}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
      contentType, cloudinaryPrivate: true,
    });
    return {
      _id: new mongoose.Types.ObjectId(),
      purpose, claimId, publicId: ref.publicId, provider: ref.provider, url: ref.url || undefined,
      contentType, bytes: ref.bytes, name, uploadedAt: new Date(), uploadedBy: actor._id,
    };
  }, (r) => removeFiles([r]));
}

/** One attached file, streamed through us after the same permission check as the return. */
export async function getStaffFile(actor, id, fileId) {
  const rr = await loadVisible(actor, id);
  const file = (rr.staffFiles || []).find((f) => idOf(f._id) === String(fileId));
  if (!file) throw fail('File not found.', 404);
  const buffer = await readPrivateAsset(file, async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`File fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  return { buffer, contentType: file.contentType || 'image/jpeg', name: file.name || '' };
}

// ── Check 2: inspection ─────────────────────────────────────────────────────────

/**
 * Procurement records the SUPPLIER's check of a direct-to-supplier return (pass/fail,
 * their photos and notes). Operations then confirms it with recordInspection — the
 * fault decision towards the customer is always operations'.
 */
export async function recordSupplierCheck(actor, id, input = {}, files = [], req = null) {
  if (!can.procurement(actor)) throw fail('Procurement records the supplier\'s check.', 403);
  const rr = await loadVisible(actor, id);
  if (rr.pickup?.mode !== 'supplier_direct' || rr.status !== 'received') throw fail('This return is not waiting for a supplier check.', 409);
  if (rr.inspection?.passed != null) throw fail('Operations has already confirmed the inspection.', 409);
  if (typeof input.passed !== 'boolean') throw fail('Did the item pass the supplier\'s check?', 400);
  const { notes, plain: notesText } = supplierNotes(input.notes);
  if (!notes) throw fail('Add the supplier\'s notes.', 400);

  const stored = await storeFiles(files, { rr, actor, purpose: 'supplier_check', existing: 0 });
  const done = await returnRequestRepository.transitionIf(id, { status: 'received', 'inspection.passed': null }, {
    $set: {
      'inspection.supplierCheck': { passed: input.passed, notes, by: actor._id, byName: actorName(actor), at: new Date() },
    },
    $push: {
      ...(stored.length && { staffFiles: { $each: stored } }),
      timeline: timelineEntry('received', `Supplier's check: ${input.passed ? 'passed' : 'failed'} — ${notesText}`, actor),
    },
  });
  if (!done) {
    await removeFiles(stored);
    throw fail(RACE, 409);
  }
  auditLogger.logAction(req, 'RETURN_SUPPLIER_CHECK', 'ReturnRequest', done._id, { passed: input.passed });
  return getReturn(actor, id);
}

/**
 * Operations' check 2: pass or fail, with photos (a direct-to-supplier return may rely on
 * the supplier's photos), a disposition when it passes, and — when it fails — whether it
 * goes back at the customer's cost or is held 30 days. The fault may be changed here,
 * line by line, with a note.
 *
 * Passing opens the supplier track for every line bought from a supplier (own stock
 * skips it) and puts the refund in accounts' queue. Neither waits for the other.
 */
export async function recordInspection(actor, id, input = {}, files = [], req = null) {
  if (!can.operations(actor)) throw fail('Operations records the inspection.', 403);
  const rr = await loadVisible(actor, id);
  if (rr.status !== 'received' || rr.inspection?.passed != null) throw fail('This return is not waiting for inspection.', 409);
  const atSupplier = rr.pickup?.mode === 'supplier_direct';
  if (atSupplier && rr.inspection?.supplierCheck?.passed == null) {
    throw fail('Procurement has to record the supplier\'s check first.', 409);
  }
  if (typeof input.passed !== 'boolean') throw fail('Did the item pass inspection?', 400);
  const notes = trimmed(input.notes, 1000);
  if (!notes) throw fail('Add a note on what you found.', 400);
  const passed = input.passed;
  const disposition = passed ? input.disposition : null;
  if (passed && !DISPOSITIONS.includes(disposition)) throw fail('Choose what happens to the item: resell, open-box, back to supplier or scrap.', 400);
  const failAction = passed ? null : input.failAction;
  if (!passed && !FAILED_INSPECTION_ACTIONS.includes(failAction)) throw fail('Choose: send it back at the customer\'s cost, or hold it for 30 days.', 400);

  // Fault changes at inspection (rule 2), each with a note.
  const changes = input.faults || {};
  const now = new Date();
  let faultChanged = false;
  const items = rr.items.map((item, i) => {
    const key = idOf(item.orderItemId) || String(i);
    const choice = changes[key] || changes[String(i)];
    const plain = item.toObject();
    if (!choice || choice.confirmed == null || choice.confirmed === effectiveFault(item)) return plain;
    if (!FAULTS.includes(choice.confirmed)) throw fail('Choose "our fault" or "customer\'s reason".', 400);
    const note = trimmed(choice.note, 500);
    if (!note) throw fail('Add a note when you change whose fault it is.', 400);
    faultChanged = true;
    return { ...plain, fault: { ...(plain.fault || {}), claimed: plain.fault?.claimed || claimedFaultFor(item.reason), confirmed: choice.confirmed, changedBy: actor._id, changedAt: now, note } };
  });

  // The real pickup cost, for customer-reason lines (rule 1: operations enters it, with
  // a reason). Checked against the breakdown now, so a figure the refund would refuse
  // is refused here instead of surprising accounts later.
  const pickupCost = passed ? Math.max(0, Number(input.pickupCostRupees) || 0) : 0;
  const pickupCostReason = trimmed(input.pickupCostReason, 500);
  if (pickupCost > 0) {
    if (!pickupCostReason) throw fail('Say what the pickup cost is for (courier and AWB, or the receipt).', 400);
    const order = await orderRepository.findById(rr.order);
    try {
      returnRefundBreakdown(order, { items: faultChanged ? items : rr.items }, {
        pickupDeductionPaise: toPaise(pickupCost), pickupDeductionReason: pickupCostReason,
      });
    } catch (err) {
      if (err instanceof RefundBreakdownError) throw fail(err.message, err.status);
      throw err;
    }
  }

  const stored = await storeFiles(files, { rr, actor, purpose: 'inspection', existing: 0 });
  if (!stored.length && !atSupplier) {
    throw fail('Add at least one photo of the item.', 400);
  }

  const inspection = {
    ...(rr.toObject().inspection || {}),
    passed,
    notes,
    at: now,
    by: actor._id,
    disposition,
    failAction,
    holdUntil: failAction === 'hold' ? new Date(now.getTime() + HOLD_REJECTED_DAYS * DAY_MS) : null,
  };
  const update = {
    $set: {
      inspection,
      ...(faultChanged && { items }),
      ...(passed ? {} : { status: 'rejected', rejectionReason: notes }),
      ...(pickupCost > 0 && {
        'refund.pickupDeduction': money(pickupCost),
        'refund.shippingDeduction': money(pickupCost),
        'refund.pickupDeductionReason': pickupCostReason,
      }),
    },
    $push: {
      ...(stored.length && { staffFiles: { $each: stored } }),
      timeline: timelineEntry(passed ? 'received' : 'rejected', passed ? `Passed inspection — ${notes}` : `Failed inspection — ${notes}`, actor),
    },
  };
  const done = await returnRequestRepository.transitionIf(id, { status: 'received', 'inspection.passed': null }, update);
  if (!done) {
    await removeFiles(stored);
    throw fail(RACE, 409);
  }
  auditLogger.logAction(req, passed ? 'RETURN_INSPECTION_PASSED' : 'RETURN_INSPECTION_FAILED', 'ReturnRequest', done._id, {
    disposition, failAction, faultChanged,
  });

  if (!passed) {
    await orderRepository.setReturnRequestStatus(done.order, 'rejected').catch(() => {});
    await orderRepository.revertReturnToDelivered(done.order, actor._id, `Return ${done._id} failed inspection`).catch(() => {});
    emailCustomer(done, 'rejected');
    chat('inspected_fail', done);
    return getReturn(actor, id);
  }

  chat('inspected_pass', done);
  await openSupplierClaims(done).catch((err) => {
    // The supplier track must never fail the inspection — procurement can open it by hand.
    console.error(`[Returns] could not open supplier claims for ${done._id}: ${err.message}`);
    Sentry.captureException(err);
  });
  return getReturn(actor, id);
}

// ── Track A: the customer refund ────────────────────────────────────────────────

/** The refund preview, for accounts (or admin). */
export async function refundPreviewFor(actor, id, body = null) {
  if (!can.accounts(actor)) throw fail('Only accounts sends return refunds.', 403);
  await loadVisible(actor, id);
  const out = await previewRefund(id, body);
  const p = out.preview;
  return { ...out, preview: { ...p, canSend: can.refund(actor, p.refundNow ?? 0, 'original_payment'), limit: ACCOUNTS_REFUND_LIMIT_RUPEES } };
}

/**
 * Send the customer refund from the team panel — the SAME code as the admin route
 * (returnRefundService.initiateRefund), with the team's rule added on the server's own
 * figure: accounts up to ₹25,000, the accounts head or admin above it; Razorpay only —
 * a bank-transfer/cash payout is recorded by an admin.
 */
export async function sendRefund(actor, id, req) {
  if (!can.accounts(actor)) throw fail('Only accounts sends return refunds.', 403);
  await loadVisible(actor, id);
  const out = await initiateRefund(req, {
    authorize: (finalAmount, method) => {
      if (method === 'offline' && !isAdmin(actor)) {
        throw fail('A bank-transfer or cash refund is recorded by an admin.', 403);
      }
      if (!can.refund(actor, finalAmount, method)) {
        throw fail(`Refunds above ₹${ACCOUNTS_REFUND_LIMIT_RUPEES.toLocaleString('en-IN')} need the accounts head or an admin.`, 403);
      }
    },
  });
  return out;
}

// ── Track B: the supplier claim ─────────────────────────────────────────────────

/**
 * Open one claim per supplier the passed lines came from — automatically, after check 2.
 * Own stock (and lines with no known supplier) skip it. Idempotent: only a return with
 * no claims yet gets them (compare-and-set on the empty array).
 */
export async function openSupplierClaims(rr) {
  if ((rr.supplierClaims || []).length) return rr;
  const order = await orderRepository.findForWorkflow(rr.order);
  if (!order) return rr;
  const wfLines = order.workflow?.lines || [];
  const groups = new Map();
  for (const item of rr.items || []) {
    const orderLine = matchOrderLine(order.items || [], { ...plain(item), itemId: item.orderItemId });
    const wf = orderLine && wfLines.find((l) => idOf(l.itemId) === idOf(orderLine._id));
    if (!wf?.supplierName || wf.stock === 'own_stock') continue;
    const name = wf.supplierName.trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(orderLine._id);
  }
  if (!groups.size) return rr;

  const requests = await paymentRequestRepository.findForOrder(order._id).catch(() => []);
  const claims = [...groups].map(([supplierName, orderItemIds]) => {
    // The supplier payment that paid for these lines: the newest that covers one of them.
    const pr = (requests || []).find((r) => r.status !== 'cancelled' && r.status !== 'declined'
      && (r.itemIds || []).some((x) => orderItemIds.some((o) => idOf(o) === idOf(x))));
    return {
      status: 'open',
      supplierName,
      orderItemIds,
      paymentRequest: pr?._id || null,
      paymentRequestRef: pr?.number || null,
      openedAt: new Date(),
    };
  });
  const done = await returnRequestRepository.transitionIf(rr._id, { 'supplierClaims.0': { $exists: false } }, {
    $set: { supplierClaims: claims },
    $push: { timeline: timelineEntry(rr.status, `Supplier claim opened with ${[...groups.keys()].join(', ')}`, null) },
  });
  if (done) chat('supplier_claim_opened', done);
  return done || rr;
}

/**
 * Procurement opens a claim by hand — for a line the workflow never recorded a supplier
 * for (an order from before the team panel, a legacy import).
 */
export async function openSupplierClaim(actor, id, input = {}, req = null) {
  if (!can.procurement(actor)) throw fail('Procurement handles supplier claims.', 403);
  const rr = await loadVisible(actor, id);
  if (rr.inspection?.passed !== true) throw fail('A supplier claim starts once the item has passed inspection.', 409);
  const supplierName = trimmed(input.supplierName, 120);
  if (!supplierName) throw fail('Name the supplier.', 400);
  const wanted = new Set((input.orderItemIds || []).map(String));
  const lineIds = (rr.items || []).map((i) => i.orderItemId).filter((x) => x && (!wanted.size || wanted.has(idOf(x))));
  if (!lineIds.length) throw fail('Choose the items this claim covers.', 400);
  const taken = new Set((rr.supplierClaims || []).flatMap((c) => (c.orderItemIds || []).map(idOf)));
  if (lineIds.some((x) => taken.has(idOf(x)))) throw fail('One of these items is already in a supplier claim.', 409);

  const done = await returnRequestRepository.transitionIf(id, { 'supplierClaims.orderItemIds': { $nin: lineIds } }, {
    $push: {
      supplierClaims: { status: 'open', supplierName, orderItemIds: lineIds, openedAt: new Date() },
      timeline: timelineEntry(rr.status, `Supplier claim opened with ${supplierName} by ${actorName(actor)}`, actor),
    },
  });
  if (!done) throw fail(RACE, 409);
  auditLogger.logAction(req, 'RETURN_SUPPLIER_CLAIM_OPEN', 'ReturnRequest', done._id, { supplierName });
  return getReturn(actor, id);
}

const claimOf = (rr, claimId) => {
  const claim = (rr.supplierClaims || []).find((c) => idOf(c._id) === String(claimId));
  if (!claim) throw fail('Supplier claim not found.', 404);
  return claim;
};

/** Compare-and-set one field set on one claim, guarded by the claim's status. */
async function updateClaim(rr, claim, fromStatuses, set, note, actor) {
  const prefixed = Object.fromEntries(Object.entries(set).map(([k, v]) => [`supplierClaims.$.${k}`, v]));
  const done = await returnRequestRepository.transitionIf(rr._id, {
    supplierClaims: { $elemMatch: { _id: claim._id, status: { $in: fromStatuses } } },
  }, {
    $set: prefixed,
    $push: { timeline: timelineEntry(rr.status, note, actor) },
  });
  if (!done) throw fail(RACE, 409);
  return done;
}

/**
 * The supplier's answer: accepted (with their RMA/reference) or rejected. A rejection of
 * a claim operations confirmed as OUR fault records the loss against the supplier — the
 * customer is refunded regardless (track A never waits for this).
 */
export async function recordSupplierAnswer(actor, id, claimId, input = {}, req = null) {
  if (!can.procurement(actor)) throw fail('Procurement handles supplier claims.', 403);
  const rr = await loadVisible(actor, id);
  const claim = claimOf(rr, claimId);
  if (typeof input.accepted !== 'boolean') throw fail('Did the supplier accept the claim?', 400);
  const note = trimmed(input.note, 1000);
  const reference = trimmed(input.reference, 120);
  if (!input.accepted && !note) throw fail('Note why the supplier rejected it.', 400);

  const ourFault = (rr.items || []).some((i) => (claim.orderItemIds || []).some((x) => idOf(x) === idOf(i.orderItemId)) && effectiveFault(i) === 'ours');
  const now = new Date();
  const set = {
    status: input.accepted ? 'accepted' : 'rejected',
    answer: { accepted: input.accepted, reference: reference || null, note: note || null, by: actor._id, byName: actorName(actor), at: now },
    ...(!input.accepted && {
      closedAt: now,
      loss: ourFault ? { recorded: true, note: note || null, by: actor._id, byName: actorName(actor), at: now } : { recorded: false },
    }),
  };
  const done = await updateClaim(rr, claim, ['open'], set,
    `${claim.supplierName} ${input.accepted ? `accepted the claim${reference ? ` (ref ${reference})` : ''}` : `rejected the claim — ${note}${ourFault ? ' (recorded as a loss against the supplier)' : ''}`}`, actor);
  auditLogger.logAction(req, 'RETURN_SUPPLIER_ANSWER', 'ReturnRequest', done._id, {
    claimId: String(claimId), accepted: input.accepted, lossRecorded: !input.accepted && ourFault,
  });
  return getReturn(actor, id);
}

/** The item on its way back to the supplier (it came to our warehouse first). */
export async function recordShipBack(actor, id, claimId, input = {}, files = [], req = null) {
  if (!can.procurement(actor)) throw fail('Procurement handles supplier claims.', 403);
  const rr = await loadVisible(actor, id);
  const claim = claimOf(rr, claimId);
  const courier = trimmed(input.courier, 80);
  const trackingNumber = trimmed(input.trackingNumber, 80);
  if (!courier || !trackingNumber) throw fail('Enter the courier and the tracking number.', 400);
  const stored = await storeFiles(files, { rr, actor, purpose: 'supplier_ship_back', claimId: claim._id });
  try {
    const done = await updateClaim(rr, claim, ['open', 'accepted', 'promised'], {
      shipBack: { courier, trackingNumber, by: actor._id, byName: actorName(actor), at: new Date() },
    }, `Sent back to ${claim.supplierName} with ${courier} (AWB ${trackingNumber})`, actor);
    if (stored.length) await returnRequestRepository.transitionIf(done._id, {}, { $push: { staffFiles: { $each: stored } } });
  } catch (err) {
    await removeFiles(stored);
    throw err;
  }
  auditLogger.logAction(req, 'RETURN_SUPPLIER_SHIP_BACK', 'ReturnRequest', rr._id, { claimId: String(claimId), courier, trackingNumber });
  return getReturn(actor, id);
}

/** The supplier's own check of an item we sent back to them. */
export async function recordClaimCheck(actor, id, claimId, input = {}, files = [], req = null) {
  if (!can.procurement(actor)) throw fail('Procurement handles supplier claims.', 403);
  const rr = await loadVisible(actor, id);
  const claim = claimOf(rr, claimId);
  if (typeof input.passed !== 'boolean') throw fail('Did the item pass the supplier\'s check?', 400);
  const { notes, plain: notesText } = supplierNotes(input.notes);
  const stored = await storeFiles(files, { rr, actor, purpose: 'supplier_check', claimId: claim._id });
  try {
    const done = await updateClaim(rr, claim, ['open', 'accepted', 'promised'], {
      supplierCheck: { passed: input.passed, notes: notes || null, by: actor._id, byName: actorName(actor), at: new Date() },
    }, `${claim.supplierName}'s check: ${input.passed ? 'passed' : 'failed'}${notes ? ` — ${notesText}` : ''}`, actor);
    if (stored.length) await returnRequestRepository.transitionIf(done._id, {}, { $push: { staffFiles: { $each: stored } } });
  } catch (err) {
    await removeFiles(stored);
    throw err;
  }
  auditLogger.logAction(req, 'RETURN_SUPPLIER_CLAIM_CHECK', 'ReturnRequest', rr._id, { claimId: String(claimId), passed: input.passed });
  return getReturn(actor, id);
}

/**
 * What the supplier PROMISED to settle with: a credit note, a refund to us, or a free
 * replacement — with the amount and their reference. It then sits in "Suppliers owe us"
 * until accounts confirms it arrived.
 */
export async function promiseSettlement(actor, id, claimId, input = {}, req = null) {
  if (!can.procurement(actor)) throw fail('Procurement handles supplier claims.', 403);
  const rr = await loadVisible(actor, id);
  const claim = claimOf(rr, claimId);
  if (!SUPPLIER_SETTLEMENT_KINDS.includes(input.kind)) throw fail('Choose credit note, refund to us, or free replacement.', 400);
  const amount = Number(input.amountRupees);
  const needsAmount = input.kind !== 'free_replacement';
  if (needsAmount && !(amount > 0)) throw fail('Enter the amount the supplier promised.', 400);
  if (Number.isFinite(amount) && amount < 0) throw fail('The amount cannot be negative.', 400);
  const reference = trimmed(input.reference, 120);
  const amountPaise = Number.isFinite(amount) && amount > 0 ? toPaise(amount) : 0;
  const done = await updateClaim(rr, claim, ['accepted'], {
    status: 'promised',
    'settlement.kind': input.kind,
    'settlement.amountPaise': amountPaise,
    'settlement.reference': reference || null,
    'settlement.promisedAt': new Date(),
    'settlement.promisedBy': actor._id,
    'settlement.promisedByName': actorName(actor),
  }, `${claim.supplierName} promised ${input.kind.replace('_', ' ')}${amountPaise ? ` of ₹${fromPaise(amountPaise)}` : ''}${reference ? ` (ref ${reference})` : ''}`, actor);
  chat('settlement_promised', done, { claimId: String(claimId) });
  auditLogger.logAction(req, 'RETURN_SUPPLIER_PROMISE', 'ReturnRequest', done._id, { claimId: String(claimId), kind: input.kind, amountPaise });
  return getReturn(actor, id);
}

/**
 * Accounts: the promised money ARRIVED — into the bank (UTR), or taken off a named later
 * supplier payment request (PR-0000). A free replacement is confirmed with a note.
 * Money IN is recorded, never sent. Confirmed exactly once: compare-and-set on
 * `promised`, so a double-click or two people at once get one winner.
 */
export async function confirmSupplierMoney(actor, id, claimId, input = {}, req = null) {
  const rr = await loadVisible(actor, id);
  const claim = claimOf(rr, claimId);
  const replacement = claim.settlement?.kind === 'free_replacement';
  if (!(can.accounts(actor) || (replacement && can.procurement(actor)))) {
    throw fail('Accounts confirms money received from a supplier.', 403);
  }
  if (claim.status !== 'promised') throw fail(claim.status === 'settled' ? 'This was already confirmed.' : 'Nothing has been promised on this claim yet.', 409);
  const note = trimmed(input.note, 500);
  let received;
  if (replacement) {
    if (!note) throw fail('Note how the replacement arrived.', 400);
    received = { method: null, utr: null, deductedFromRef: null, deductedFrom: null, note };
  } else {
    if (!SUPPLIER_MONEY_METHODS.includes(input.method)) throw fail('Choose: received in the bank, or deducted from a supplier bill.', 400);
    if (input.method === 'bank') {
      const utr = trimmed(input.utr, 120);
      if (!utr) throw fail('Enter the bank reference (UTR).', 400);
      received = { method: 'bank', utr, deductedFromRef: null, deductedFrom: null, note: note || null };
    } else {
      const ref = trimmed(input.deductedFromRef, 20).toUpperCase();
      if (!ref) throw fail('Enter the supplier payment request it was deducted from (PR-0000).', 400);
      const pr = await paymentRequestRepository.findByNumber(ref);
      if (!pr || pr.kind !== 'supplier') throw fail(`${ref} is not a supplier payment request.`, 400);
      received = { method: 'deducted', utr: null, deductedFromRef: pr.number, deductedFrom: pr._id, note: note || null };
    }
  }
  const now = new Date();
  const done = await updateClaim(rr, claim, ['promised'], {
    status: 'settled',
    closedAt: now,
    'settlement.received': { ...received, by: actor._id, byName: actorName(actor), at: now },
  }, replacement
    ? `${claim.supplierName}'s free replacement received — ${note}`
    : `₹${fromPaise(claim.settlement?.amountPaise || 0)} from ${claim.supplierName} ${received.method === 'bank' ? `received (UTR ${received.utr})` : `deducted from ${received.deductedFromRef}`}`, actor);
  auditLogger.logAction(req, 'RETURN_SUPPLIER_MONEY_RECEIVED', 'ReturnRequest', done._id, {
    claimId: String(claimId), method: received.method, utr: received.utr, deductedFromRef: received.deductedFromRef,
    amountPaise: claim.settlement?.amountPaise || 0,
  });
  return getReturn(actor, id);
}

/*
  "Suppliers owe us" search / filter / sort. Rows are one promised settlement each
  (returnRequestRepository.owedStages flattens them), so these fields are top-level.
*/
export const OWED_SORTS = Object.freeze({
  oldest: { field: 'sortAt', dir: 1, type: 'date' },
  newest: { field: 'sortAt', dir: -1, type: 'date' },
  amount_desc: { field: 'amountPaise', dir: -1, type: 'number' },
  amount_asc: { field: 'amountPaise', dir: 1, type: 'number' },
});
const OWED_SEARCH = ['supplierName', 'ref', 'claim.settlement.reference', 'claim.paymentRequestRef'];
const LIST_SUMMARY_CAP = 1000;

/** The "Suppliers owe us" filter: search words, one supplier, one kind of settlement. */
export function owedQuery(f) {
  const words = searchWords(f.q).map((w) => w.replace(/^#+/, '')).filter(Boolean);
  return and(
    typeof f.supplier === 'string' && f.supplier ? { supplierName: f.supplier } : null,
    SUPPLIER_SETTLEMENT_KINDS.includes(f.kind) ? { 'claim.settlement.kind': f.kind } : null,
    searchClauses(words, OWED_SEARCH, (w) => {
      const n = amountOf(w);
      return n ? [{ amountPaise: toPaise(n) }] : [];
    }),
  );
}

/**
 * "Suppliers owe us": every settlement promised and not yet received, oldest first,
 * with a total per supplier. Keyset-paged. The per-supplier totals are always the
 * whole picture (click one to see only that supplier); the summary is what matches.
 */
export async function suppliersOweUs(actor, params = {}) {
  if (!(can.accounts(actor) || can.procurement(actor))) throw fail('Not authorized.', 403);
  const f = plainQuery(params);
  const sortName = OWED_SORTS[f.sort] ? f.sort : 'oldest';
  const [page, totals] = await Promise.all([
    keysetPage({
      query: owedQuery(f), sorts: OWED_SORTS, sortName, cursor: f.cursor, pageSize: PAGE_SIZE,
      find: (q, o) => returnRequestRepository.owedPage(q, o),
      count: (q) => returnRequestRepository.owedSummary(q, LIST_SUMMARY_CAP),
    }),
    f.cursor ? Promise.resolve(null) : returnRequestRepository.owedTotals(),
  ]);
  const now = Date.now();
  const items = page.items.map((r) => ({
    returnId: idOf(r.returnId),
    returnRef: r.ref,
    orderId: idOf(r.order),
    claimId: idOf(r._id),
    supplierName: r.supplierName,
    kind: r.claim.settlement?.kind || null,
    amount: fromPaise(r.amountPaise),
    reference: r.claim.settlement?.reference || null,
    paymentRequestRef: r.claim.paymentRequestRef || null,
    promisedAt: r.promisedAt || null,
    ageDays: r.promisedAt ? Math.floor((now - new Date(r.promisedAt).getTime()) / DAY_MS) : null,
  }));
  return {
    items,
    sort: page.sort,
    ...(page.summary ? { summary: { ...page.summary, total: page.summary.total == null ? null : fromPaise(page.summary.total) } } : {}),
    totals: totals && totals.map((t) => ({
      supplierName: t._id, amount: fromPaise(t.amountPaise), claims: t.claims, oldestPromisedAt: t.oldestPromisedAt,
    })),
    nextCursor: page.nextCursor,
  };
}

// ── Lists and detail ────────────────────────────────────────────────────────────

/**
 * Each queue is ONE query, shared by the list and the bell count so the two can never
 * disagree. Keys are what the team pages ask for.
 */
export const QUEUES = Object.freeze({
  // Operations: check 1.
  review: { allowed: can.operations, query: () => ({ status: 'pending' }) },
  // Operations: pickups to our warehouse (book, or wait for arrival).
  pickup: {
    allowed: can.operations,
    query: () => ({ status: { $in: ['approved', 'courier_booked'] }, 'destination.kind': { $ne: 'supplier' } }),
  },
  // Operations: check 2 — at our warehouse, or confirming the supplier's check.
  inspect: {
    allowed: can.operations,
    query: () => ({
      status: 'received',
      'inspection.passed': null,
      $or: [{ 'pickup.mode': { $ne: 'supplier_direct' } }, { 'inspection.supplierCheck.passed': { $in: [true, false] } }],
    }),
  },
  // Procurement: direct-to-supplier returns (arrange the pickup; record the supplier's check).
  supplier_pickup: {
    allowed: can.procurement,
    query: () => ({
      $or: [
        { status: { $in: ['approved', 'courier_booked'] }, 'destination.kind': 'supplier' },
        { status: 'received', 'pickup.mode': 'supplier_direct', 'inspection.passed': null, 'inspection.supplierCheck.passed': null },
      ],
    }),
  },
  // Accounts: passed inspection, refund not sent (or failed).
  refund: {
    allowed: can.accounts,
    query: () => ({ status: 'received', 'inspection.passed': true, 'refund.status': { $nin: ['processing', 'completed'] } }),
  },
  // Procurement: supplier claims still being chased.
  supplier: { allowed: can.procurement, query: () => ({ 'supplierClaims.status': { $in: ['open', 'accepted'] } }) },
  // Whoever raised or sold it.
  mine: { allowed: can.raise, query: (u) => ({ $or: [{ raisedBy: u._id }, { seller: u._id }] }) },
  all: { allowed: can.seeAll, query: () => ({}) },
});

const STAGE = {
  pending: 'Check 1 — evidence',
  approved: 'Pickup to book',
  courier_booked: 'Pickup booked',
  received: 'Check 2 — inspection',
  refunded: 'Refunded',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const stageOf = (rr) => {
  if (rr.status === 'received' && rr.inspection?.passed === true) {
    return ['processing', 'completed'].includes(rr.refund?.status) ? 'Refund sent' : 'Refund to send';
  }
  if (rr.status === 'received' && rr.pickup?.mode === 'supplier_direct' && rr.inspection?.supplierCheck?.passed == null) {
    return "Supplier's check";
  }
  if (rr.status === 'approved' && rr.destination?.kind === 'supplier') return 'Pickup to supplier';
  return STAGE[rr.status] || rr.status;
};

function rowOf(rr) {
  return {
    id: idOf(rr._id),
    ref: returnRef(rr),
    orderId: idOf(rr.order),
    orderNumber: rr.order && typeof rr.order === 'object' ? orderRef(rr.order) : null,
    customer: rr.order?.shippingAddress?.fullName || '',
    items: (rr.items || []).map((i) => ({
      name: variantDisplayName(i.product?.name, i.variantLabel),
      quantity: i.quantity,
      reason: i.reason,
      reasonLabel: RETURN_REASON_LABELS[i.reason] || i.reason,
      fault: effectiveFault(i),
    })),
    status: rr.status,
    stage: stageOf(rr),
    origin: rr.origin,
    destination: rr.destination?.kind || null,
    supplierName: rr.destination?.supplierName || null,
    pickupMode: rr.pickup?.mode || null,
    pickupAttempts: (rr.pickupAttempts || []).length,
    refund: { status: rr.refund?.status || 'pending', amount: rr.refund?.finalAmount || 0 },
    claims: (rr.supplierClaims || []).map((c) => ({ id: idOf(c._id), supplierName: c.supplierName, status: c.status })),
    createdAt: rr.createdAt,
    ageDays: Math.floor(daysSince(rr.createdAt)),
  };
}

/*
  Team list search / filter / sort, the same on every queue. The queue's own rule
  (QUEUES above — what the bell counts) is ANDed with these, never replaced.
*/
export const RETURN_SORTS = Object.freeze({
  newest: { field: 'createdAt', dir: -1, type: 'date' },
  oldest: { field: 'createdAt', dir: 1, type: 'date' },
});
// The "Came from" filter → ReturnRequest.origin.
const ORIGIN_OF = Object.freeze({ website: 'customer', staff: 'staff', recorded: 'admin_offline' });

/** Reason on any line, where it came from, the day it was raised (India time). */
export function returnFilters(f) {
  const raised = istRange(f.from, f.to);
  return and(
    RETURN_REASONS.includes(f.reason) ? { 'items.reason': f.reason } : null,
    ORIGIN_OF[f.origin] ? { origin: ORIGIN_OF[f.origin] } : null,
    raised ? { createdAt: raised } : null,
  );
}

/** Everything a return can be found by, lower-case: its number, the order's, customer, phone, products, suppliers. */
function searchTextOf(row) {
  const o = row.order?.[0] || {};
  return [
    returnRef(row), o._id ? orderRef(o) : '', o._id ? idOf(o._id).slice(-8) : '', o.wpId ? String(o.wpId) : '',
    o.name, o.phone, row.customerPhone, ...(row.products || []).map((p) => p.name), row.destination, ...(row.claims || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Those of `base` whose every word appears in searchTextOf. The order number, customer
 * and product names live on other documents, so this reads one small row per return in
 * the list (returnRequestRepository.searchRows) — the whole collection is a few thousand.
 */
async function searchedIds(base, words) {
  const { rows, capped } = await returnRequestRepository.searchRows(base);
  const ids = rows.filter((r) => {
    const text = searchTextOf(r);
    return words.every((w) => text.includes(w));
  }).map((r) => r._id);
  return { ids, capped };
}

/**
 * One team queue, keyset-paged (PAGE_SIZE): newest (default) or oldest first, with
 * search (`q`), `reason`, `origin` (website / staff / recorded) and `from` / `to`.
 */
export async function listReturns(actor, params = {}) {
  const f = plainQuery(params);
  const q = QUEUES[f.queue || 'all'];
  if (!q) throw fail('Unknown list.', 400);
  if (!q.allowed(actor)) throw fail('Not authorized.', 403);
  const sortName = RETURN_SORTS[f.sort] ? f.sort : 'newest';
  const base = and(q.query(actor), returnFilters(f));
  const words = searchWords(f.q).map((w) => w.replace(/^#+/, '')).filter(Boolean);
  const found = words.length ? await searchedIds(base, words) : null;
  const { items, ...page } = await keysetPage({
    query: found ? and(base, { _id: { $in: found.ids } }) : base,
    sorts: RETURN_SORTS, sortName, cursor: f.cursor, pageSize: PAGE_SIZE,
    find: (query, o) => returnRequestRepository.page(query, o),
    count: (query) => returnRequestRepository.summary(query, LIST_SUMMARY_CAP),
  });
  return { ...page, returns: items.map(rowOf), ...(found?.capped ? { searchCapped: true } : {}) };
}

const RETURN_STATUSES = ['pending', 'approved', 'courier_booked', 'received', 'refunded', 'rejected', 'cancelled'];

/**
 * The admin Returns list (GET /returns/admin/all): the same search, filters and sorts as
 * the team lists, over every return, with an optional `status`. Keyset-paged; the page
 * read (`find`) is the controller's, which shapes rows for that screen.
 */
export async function adminReturnsPage(params, { pageSize, find }) {
  const f = plainQuery(params);
  const sortName = RETURN_SORTS[f.sort] ? f.sort : 'newest';
  const base = and(RETURN_STATUSES.includes(f.status) ? { status: f.status } : null, returnFilters(f));
  const words = searchWords(f.q).map((w) => w.replace(/^#+/, '')).filter(Boolean);
  const found = words.length ? await searchedIds(base, words) : null;
  const page = await keysetPage({
    query: found ? and(base, { _id: { $in: found.ids } }) : base,
    sorts: RETURN_SORTS, sortName, cursor: f.cursor, pageSize, find,
    count: (query) => returnRequestRepository.summary(query, LIST_SUMMARY_CAP),
  });
  return { ...page, ...(found?.capped ? { searchCapped: true } : {}) };
}

/** The bell: how many returns wait on this person, per queue they work. Same queries as the lists. */
export async function countsFor(actor) {
  const mine = [
    ['review', 'Returns to check', '/team/returns?tab=review'],
    ['pickup', 'Return pickups', '/team/returns?tab=pickup'],
    ['inspect', 'Returns to inspect', '/team/returns?tab=inspect'],
    ['supplier_pickup', 'Returns going to suppliers', '/team/returns?tab=supplier_pickup'],
    ['supplier', 'Supplier claims to chase', '/team/returns?tab=supplier'],
    ['refund', 'Return refunds to send', '/team/return-refunds'],
  ].filter(([key]) => {
    if (!QUEUES[key].allowed(actor)) return false;
    // Admin's bell stays short: what only they unblock day to day.
    return !isAdmin(actor) || ['review', 'refund'].includes(key);
  });
  const counts = await Promise.all(mine.map(([key]) => returnRequestRepository.countDocuments(QUEUES[key].query(actor))));
  // An admin has no /team: the same tabs live on /admin/returns-workflow.
  const items = mine.map(([key, label, href], i) => ({
    key: `returns_${key}`, label, count: counts[i], href: isAdmin(actor) ? `/admin/returns-workflow?tab=${key}` : href,
  }));
  if (can.accounts(actor) && !isAdmin(actor)) {
    const owed = await returnRequestRepository.countDocuments({ 'supplierClaims.status': 'promised' });
    items.push({ key: 'returns_supplier_money', label: 'Supplier money to confirm', count: owed, href: '/team/returns?tab=owed' });
  }
  return items;
}

/** One return in full for the team panel, with what this person may do next. */
export async function getReturn(actor, id) {
  const rr = await returnRequestRepository.findById(id)
    .populate('user', 'name email phone')
    .populate('items.product', 'name images')
    .populate('raisedBy', 'name')
    .lean();
  if (!rr || !canView(actor, rr)) throw fail('Return not found.', 404);
  const order = await orderRepository.findForWorkflow(rr.order);
  const [signed, repeats] = await Promise.all([withSignedEvidence(rr), repeatCount(rr)]);
  const payment = order?.payment && typeof order.payment === 'object' ? order.payment : null;

  return {
    ...rowOf({ ...rr, order }),
    problemDescription: rr.problemDescription,
    raisedBy: rr.raisedBy?.name || null,
    customerContact: {
      name: customerName(order),
      phone: order?.shippingAddress?.phone || rr.user?.phone || '',
      email: rr.user?.email || order?.guestEmail || '',
    },
    seller: order?.salesUser?.name || (order?.salesUser ? 'Sales team' : 'Website'),
    lines: (rr.items || []).map((i, n) => ({
      key: idOf(i.orderItemId) || String(n),
      orderItemId: idOf(i.orderItemId) || null,
      name: variantDisplayName(i.product?.name, i.variantLabel),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      reason: i.reason,
      reasonLabel: RETURN_REASON_LABELS[i.reason] || i.reason,
      fault: { claimed: i.fault?.claimed || claimedFaultFor(i.reason), confirmed: i.fault?.confirmed || null, note: i.fault?.note || null },
    })),
    evidence: { video: signed.video, videoLink: rr.videoLink || null, proofOfPurchase: signed.proofOfPurchase, images: signed.images },
    files: (rr.staffFiles || []).map((f) => ({
      id: idOf(f._id), purpose: f.purpose, claimId: f.claimId ? idOf(f.claimId) : null, name: f.name, contentType: f.contentType,
    })),
    destinationOptions: order ? destinationOptions(order, rr) : { default: 'warehouse', suppliers: [] },
    courier: rr.courier || null,
    pickup: rr.pickup || null,
    pickupAttemptsList: rr.pickupAttempts || [],
    inspection: rr.inspection || null,
    rejectionReason: rr.rejectionReason || null,
    refundDetail: rr.refund || null,
    // Accounts sends Razorpay refunds; a bank-transfer/cash order is paid back by admin.
    refundRoute: payment?.gatewayPaymentId ? 'gateway' : 'offline',
    supplierClaims: rr.supplierClaims || [],
    repeatReturns: repeats,
    timeline: rr.timeline || [],
    can: {
      review: can.operations(actor) && rr.status === 'pending',
      pickup: (rr.destination?.kind === 'supplier' ? can.procurement(actor) : can.operations(actor))
        && ['approved', 'courier_booked'].includes(rr.status),
      droppedAtStore: can.operations(actor) && rr.status === 'approved' && rr.destination?.kind !== 'supplier',
      received: (rr.pickup?.mode === 'supplier_direct' ? can.procurement(actor) : can.operations(actor)) && rr.status === 'courier_booked',
      supplierCheck: can.procurement(actor) && rr.status === 'received' && rr.pickup?.mode === 'supplier_direct' && rr.inspection?.passed == null,
      inspect: can.operations(actor) && rr.status === 'received' && rr.inspection?.passed == null
        && (rr.pickup?.mode !== 'supplier_direct' || rr.inspection?.supplierCheck?.passed != null),
      refund: can.accounts(actor) && rr.status === 'received' && rr.inspection?.passed === true
        && !['processing', 'completed'].includes(rr.refund?.status),
      supplierClaims: can.procurement(actor),
      supplierMoney: can.accounts(actor),
      edit: mayEdit(actor, rr) && !editBlock(rr),
      editReason: rr.status === 'pending',
      editRemoveLine: LINE_REMOVABLE_STATUSES.includes(rr.status),
    },
    // Why Edit is closed (shown on the card); null when it is open or not this person's.
    editLock: mayEdit(actor, rr) ? editBlock(rr) : null,
    updatedAt: rr.updatedAt,
  };
}

// ── Editing a return (owner, 2026-11-06) ────────────────────────────────────────

/** Statuses a return can still be edited in — the refund decides the rest (below). */
export const EDITABLE_RETURN_STATUSES = Object.freeze(['pending', 'approved', 'courier_booked', 'received']);
/** Lines can be dropped only until the item is back with us — then inspection decides. */
const LINE_REMOVABLE_STATUSES = Object.freeze(['pending', 'approved', 'courier_booked']);
const REFUND_LOCKED = Object.freeze(['processing', 'completed']);
export const REFUND_LOCKED_MESSAGE = 'The refund is already with Accounts — this return can\'t be changed now.';

/** May this person edit this return? The one who raised it, operations, admin. */
const mayEdit = (u, rr) => can.operations(u) || (can.raise(u) && idOf(rr.raisedBy) === idOf(u?._id));

/** Why editing is closed for this return, or null when it is open. */
function editBlock(rr) {
  if (REFUND_LOCKED.includes(rr.refund?.status)) return REFUND_LOCKED_MESSAGE;
  if (!EDITABLE_RETURN_STATUSES.includes(rr.status)) return `This return is ${rr.status.replace('_', ' ')} and can no longer be changed.`;
  return null;
}

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const assetId = (a) => (a?.publicId ? String(a.publicId) : '');

/**
 * The evidence after an edit. Kept photos are matched against what the return already
 * holds (never re-trusted from the client); anything NEW is verified exactly like at
 * raise. Nothing that was there can be taken away without a replacement — the evidence
 * rule (≥1 photo, the video or its link) stays met on every return that met it.
 */
async function editedEvidence(rr, ev) {
  if (!ev || typeof ev !== 'object') return null;
  const had = rr.images || [];
  // Kept photos are named by their position in the return's own list (the order the
  // view shows them in), so no storage key ever goes to the browser.
  const keep = Array.isArray(ev.keepImages) ? new Set(ev.keepImages.map(Number)) : null;
  const kept = had.filter((_, i) => !keep || keep.has(i)).map(plain);
  const added = await verifyPhotos(ev.newImages);
  const images = [...kept, ...added];
  if (images.length > MAX_RETURN_PHOTOS) throw fail(`Up to ${MAX_RETURN_PHOTOS} photos.`, 400);
  if (had.length > 0 && images.length === 0) throw fail('Keep at least one photo the customer sent.', 400);

  let video = rr.video ? plain(rr.video) : null;
  let videoLink = rr.videoLink || null;
  if (ev.video) {
    video = await verifyVideo(ev.video);
    videoLink = null;
  } else if (typeof ev.videoLink === 'string' && ev.videoLink.trim()) {
    const link = verifyVideoLink(ev.videoLink);
    if (!link) throw fail('Paste a Google Drive or YouTube link for the video.', 400);
    if (link !== videoLink) { videoLink = link; video = null; }
  }
  const proofOfPurchase = ev.proofOfPurchase ? await verifyProof(ev.proofOfPurchase) : (rr.proofOfPurchase ? plain(rr.proofOfPurchase) : null);

  const changes = [];
  const removedPhotos = had.length - kept.length;
  if (added.length) changes.push(`${added.length} photo${added.length > 1 ? 's' : ''} added`);
  if (removedPhotos) changes.push(`${removedPhotos} photo${removedPhotos > 1 ? 's' : ''} removed`);
  if (assetId(video) !== assetId(rr.video) || (videoLink || null) !== (rr.videoLink || null)) changes.push('unboxing video replaced');
  if (assetId(proofOfPurchase) !== assetId(rr.proofOfPurchase)) changes.push('proof of purchase replaced');
  if (!changes.length) return null;
  return { set: { images, video, videoLink, proofOfPurchase }, changes };
}

/**
 * The lines after an edit. Quantity only ever goes DOWN (so the refund can only go
 * down — the price is the order's and never typed by staff); a line can be dropped
 * while the item is still on its way; the reason can change only before review, and
 * then every gate a new return's reason faces applies again.
 */
function editedLines(rr, order, products, input) {
  const wanted = Array.isArray(input.lines) ? input.lines : null;
  if (!wanted) return null;
  const byKey = new Map(wanted.map((w) => [String(w?.key ?? ''), w]));
  const changes = [];
  const lines = [];
  rr.items.forEach((item, i) => {
    const key = idOf(item.orderItemId) || String(i);
    const w = byKey.get(key) || byKey.get(String(i));
    if (!w) { lines.push(plain(item)); return; }
    const orderLine = matchOrderLine(order.items, { itemId: item.orderItemId, product: item.product, variantId: item.variantId });
    // The order's own line name when the catalogue product is gone — History must say what changed.
    const name = variantDisplayName(products?.get(idOf(item.product))?.name || orderLine?.name || 'Item', item.variantLabel);
    if (w.remove === true) {
      if (!LINE_REMOVABLE_STATUSES.includes(rr.status)) throw fail('An item can be taken off the return only until it reaches us. After that, inspection decides.', 409);
      changes.push(`${name} taken off the return`);
      return;
    }
    const next = plain(item);
    if (w.quantity != null) {
      const qty = Math.floor(Number(w.quantity));
      if (!Number.isFinite(qty) || qty < 1) throw fail(`Enter how many of "${name}" are coming back (at least 1).`, 400);
      if (qty > item.quantity) throw fail(`The quantity of "${name}" can only go down. To return more, raise a new return.`, 400);
      if (qty !== item.quantity) { changes.push(`${name}: quantity ${item.quantity} → ${qty}`); next.quantity = qty; }
    }
    if (w.reason != null && w.reason !== item.reason) {
      if (rr.status !== 'pending') throw fail('The reason can only be changed before the return is approved. Operations can change whose fault it is at inspection.', 409);
      if (!RETURN_REASONS.includes(w.reason)) throw fail(`Choose a return reason for "${name}".`, 400);
      const fault = claimedFaultFor(w.reason);
      if (fault === 'customer') {
        const deliveredAt = orderLine ? lineDeliveredAt(order, orderLine) : null;
        const windowDays = windowDaysFor(fault);
        if (deliveredAt && daysSince(deliveredAt) > windowDays) {
          throw fail(`"${name}" is past the ${windowDays}-day window for the customer's own reason.`, 400);
        }
        if (products?.get(idOf(item.product))?.returnPolicy?.returnable === false) {
          throw fail(`"${name}" can't be returned for the customer's own reason (it is on the non-returnable list).`, 400);
        }
        if (!rr.unusedDeclaredAt && input.unusedDeclared !== true) {
          throw fail('A return for the customer\'s own reason needs the item unused, not installed, and in its original box — tick the declaration.', 400);
        }
      }
      changes.push(`${name}: reason "${RETURN_REASON_LABELS[item.reason] || item.reason}" → "${RETURN_REASON_LABELS[w.reason]}"`);
      next.reason = w.reason;
      next.fault = { claimed: fault, confirmed: null, changedBy: null, changedAt: null, note: null };
    }
    lines.push(next);
  });
  if (!changes.length) return null;
  if (lines.length === 0) throw fail('At least one item has to stay on the return. To drop all of it, reject the return instead.', 400);
  return { lines, changes };
}

/**
 * Edit a return staff already raised: the problem text, the evidence, and the lines
 * (quantity down, drop a line, the reason before review). Money is never typed: the
 * refund is recomputed from the ORDER's prices, so an edit can only lower it, and the
 * send step still caps it at what is left to refund on the order.
 *
 * Locked once the refund is processing/completed (or the return is closed). The write
 * is a compare-and-set on status + updatedAt + refund status, so it can't land on top
 * of a refund Accounts just started or another person's edit. Saving with nothing
 * changed writes nothing — a double-click adds no second History line.
 */
export async function editReturn(actor, id, input = {}, req = null) {
  const rr = await loadVisible(actor, id);
  if (!mayEdit(actor, rr)) throw fail('Only the person who raised this return, operations or admin can edit it.', 403);
  const blocked = editBlock(rr);
  if (blocked) throw fail(blocked, 409);
  if (input.updatedAt && new Date(input.updatedAt).getTime() !== new Date(rr.updatedAt).getTime()) {
    throw fail(RACE, 409);
  }

  const set = {};
  const changes = [];

  if (input.description != null) {
    const description = trimmed(input.description, 2000);
    if (!description) throw fail('Describe the problem in a line or two.', 400);
    if (description !== rr.problemDescription) {
      set.problemDescription = description;
      changes.push('problem text changed');
    }
  }

  let lineEdit = null;
  if (Array.isArray(input.lines)) {
    const order = await orderRepository.findForReturn(rr.order);
    if (!order) throw fail('The order for this return no longer exists.', 404);
    const products = await returnProducts(order);
    lineEdit = editedLines(rr, order, products, input);
    if (lineEdit) {
      await assertEmiAllowsReturn(order, lineEdit.lines);
      const before = rr.refund?.finalAmount || 0;
      const { grossRupees, netRupees, discountShareRupees } = refundableForLines(order, lineEdit.lines);
      set.items = lineEdit.lines;
      set['refund.productValue'] = netRupees;
      set['refund.listValue'] = grossRupees;
      set['refund.discountShare'] = discountShareRupees;
      set['refund.finalAmount'] = netRupees;
      if (lineEdit.lines.some((l) => claimedFaultFor(l.reason) === 'customer') && !rr.unusedDeclaredAt) set.unusedDeclaredAt = new Date();
      const money = netRupees !== before ? ` (refund ${rupees(before)} → ${rupees(netRupees)})` : '';
      changes.push(...lineEdit.changes.map((c, i) => (i === lineEdit.changes.length - 1 ? `${c}${money}` : c)));
    }
  }

  const evidence = await editedEvidence(rr, input.evidence);
  if (evidence) {
    Object.assign(set, evidence.set);
    changes.push(...evidence.changes);
  }

  if (!changes.length) return getReturn(actor, id);

  const note = `Edited by ${actorName(actor)}: ${changes.join('; ')}`;
  const done = await returnRequestRepository.transitionIf(id, {
    status: rr.status,
    updatedAt: rr.updatedAt,
    'refund.status': { $nin: REFUND_LOCKED },
  }, {
    $set: set,
    $push: { timeline: timelineEntry(rr.status, note, actor) },
  });
  if (!done) {
    const now = await returnRequestRepository.findById(id).select('refund.status status').lean();
    throw fail(now && REFUND_LOCKED.includes(now.refund?.status) ? REFUND_LOCKED_MESSAGE : RACE, 409);
  }

  /*
    No order-status roll-up: an edit only ever takes units OFF a return, so it can never
    make the order fully returned. (An order already rolled up to `returned` stays there;
    `returned` orders remain returnable, so the units left with the customer are not lost.)
  */
  auditLogger.logAction(req, 'RETURN_EDIT', 'ReturnRequest', done._id, { changes, by: actorName(actor) });
  return getReturn(actor, id);
}

export default {
  editReturn,
  createCustomerReturn, estimateForCustomer, raiseReturn, raiseOptions, evidenceUploadTargets, reviewReturn, bookPickup, markDroppedAtStore, markReceived,
  recordPickupFailed, recordSupplierCheck, recordInspection, refundPreviewFor, sendRefund, openSupplierClaims,
  openSupplierClaim, recordSupplierAnswer, recordShipBack, recordClaimCheck, promiseSettlement, confirmSupplierMoney,
  suppliersOweUs, listReturns, countsFor, getReturn, getStaffFile, syncOrderReturnedStatus, destinationOptions,
};
