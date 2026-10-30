/**
 * Team workflow — what each team does with a paid order, from the /team panel.
 *
 *   procurement : stock check per item (in stock / ordered from supplier / our warehouse /
 *                 out of stock), then uploads the supplier's photo + courier + tracking →
 *                 shipped. Our own warehouse stock skips the supplier entirely: no supplier
 *                 payment, so no accounts approval or admin payment — procurement packs it
 *                 and adds courier + tracking (photo optional) → shipped
 *   sales       : out of stock → asks the customer: wait for stock, or refund
 *   accounts    : approves (or sends back) a refund the customer asked for, and an
 *                 approval SENDS it (Razorpay); a failed send is retried from here too
 *   operations  : follows the parcel — picked up, in transit, out for delivery,
 *                 delivery failed (shown to the customer) — and marks it delivered
 *   admin       : can do everything above; the admin Refunds page still works too
 *
 * ── ONE SET OF RECORDS ──────────────────────────────────────────────────────────
 * Nothing here writes shipments or refunds itself. "Shipped" is a parcel created by
 * shipmentService, "delivered" is shipmentService.markShipmentDelivered, and an
 * approved refund is a cancellation recorded by cancellationService — the very
 * services the admin panel uses. So the double-ship guard, the discount-aware refund
 * amount, the per-parcel customer emails and the status roll-up all apply unchanged,
 * and the admin panel sees every team action as if an admin had done it.
 *
 * ── RACES ───────────────────────────────────────────────────────────────────────
 * Each line change is a compare-and-set on the line's current state
 * (orderRepository.updateWorkflowLineIf): two people acting on the same item at once
 * cannot both win; the loser is told to refresh. Accounts' approval is CLAIMED before
 * the cancellation is recorded and released if recording fails, so one approval can
 * never create two refunds.
 *
 * ── THE ONE PLACE MONEY MOVES ───────────────────────────────────────────────────
 * Accounts' approval records the cancellation and then sends its refund through
 * cancellationService.refundCancellation — the same routine behind the admin
 * Refunds button. Its atomic claim on the cancellation's refund is what makes a
 * double-click, a retry, or Accounts and an admin pressing at once pay ONCE; the
 * amount is recomputed there from the order against what is still refundable.
 * Only out-of-stock refunds raised in this workflow are sent from here — returns
 * are still refunded by an admin after inspection.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import shipmentService from './shipmentService.js';
import cancellationService from './cancellationService.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { storeAll } from './storage/storeAll.js';
import { MAX_ATTACHMENT_BYTES } from '../config/attachments.js';
import { parcelProofs, proofFilePath, LEGACY_PROOF_ID } from '../utils/shipmentView.js';
import { getNotificationsQueue } from '../queue/queues.js';
import { STAFF_TEAMS, STAFF_TEAM_LABELS, canSell } from '../config/staff.js';
import { workflowView, STAGE, STOCK, STAGE_LABELS, unshippedQuantity } from '../utils/teamWorkflow.js';
import { readListFilters, rowMatches } from '../utils/orderListFilters.js';
import { SHIPMENT_STATUS, rewardShipped } from '../utils/orderFulfilment.js';
import { istDay, parseEtaDay, etaDayProblem, etaState, etaSummary, formatEtaDay, MAX_ETA_HISTORY } from '../utils/parcelEta.js';
import { PARCEL_STEP_VALUES, PARCEL_STEP_LABELS, TRACKING_EVENT_STATUS, MAX_PARCEL_STEPS, MAX_STEP_NOTE } from '../utils/parcelSteps.js';
import { owesGoodie, variantDisplayName } from '../utils/orderLines.js';
import { WORKFLOW_CHAT_JOB } from './chatBusinessUpdates.js';
import { assertNoPendingSupplierPayment, openSupplierPaymentFor } from './paymentRequestService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const PAGE_SIZE = 25;
const SCAN_BATCH = 50;
const MAX_SCAN = 500;
export const MAX_PROOF_BYTES = MAX_ATTACHMENT_BYTES;
const PROOF_FOLDER = 'shipping-slips'; // already a PRIVATE prefix (storage/assetScope.js)

// ── Who is acting ───────────────────────────────────────────────────────────────

const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isHeadOf = (u, team) => onTeam(u, team) && u.staff.isHead === true;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const actorTeam = (u) => (isAdmin(u) ? 'admin' : u?.staff?.team || '');

/** Teams (plus admin) that may perform each action. */
const can = {
  procurement: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.PROCUREMENT),
  accounts: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS),
  operations: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.OPERATIONS),
  /** The customer's decision: the sales person on the order, or any sales head (website orders have no seller). */
  /** The expected delivery date on a parcel: whoever chases the courier — procurement or operations. */
  planDelivery: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.PROCUREMENT) || onTeam(u, STAFF_TEAMS.OPERATIONS),
  decide: (u, order) => isAdmin(u)
    || isHeadOf(u, STAFF_TEAMS.SALES)
    || (onTeam(u, STAFF_TEAMS.SALES) && order.salesUser && idOf(order.salesUser) === idOf(u._id)),
};

/** May this person see this order in the team panel at all? */
function canView(u, order) {
  if (isAdmin(u)) return true;
  if (!isActiveStaff(u)) return false;
  const inWorkflow = !!order.workflow?.enteredAt;
  switch (u.staff.team) {
    case STAFF_TEAMS.PROCUREMENT:
    case STAFF_TEAMS.ACCOUNTS:
    case STAFF_TEAMS.OPERATIONS:
      return inWorkflow || (!!order.salesUser && order.paymentStatus === 'paid');
    case STAFF_TEAMS.SALES:
      if (u.staff.isHead) return inWorkflow || !!order.salesUser;
      return !!order.salesUser && idOf(order.salesUser) === idOf(u._id);
    default:
      return false;
  }
}

/** Which queue each team works from, and who may open it. */
const QUEUES = {
  procurement: { team: 'procurement', allowed: can.procurement },
  // GTM head and leads only — executives and support do not take customer decisions.
  decisions: { team: 'sales', allowed: (u) => isAdmin(u) || canSell(u) },
  refunds: { team: 'accounts', allowed: can.accounts },
  deliveries: { team: 'operations', allowed: can.operations },
};

// ── Shapes ─────────────────────────────────────────────────────────────────────

const itemName = (item) => (item ? variantDisplayName(item.name, item.variantLabel) : 'Item');

const customerOf = (o) => ({
  name: o.user?.name || o.shippingAddress?.fullName || '',
  email: o.user?.email || o.guestEmail || '',
  phone: o.shippingAddress?.phone || o.user?.phone || '',
});

/** A list row: enough to decide which order to open. */
function row(o, view) {
  return {
    id: idOf(o._id),
    orderNumber: o.orderNumber || idOf(o._id).slice(-8).toUpperCase(),
    createdAt: o.createdAt,
    enteredAt: o.workflow?.enteredAt || null,
    status: o.status,
    paymentStatus: o.paymentStatus,
    totalAmount: o.totalAmount,
    source: o.salesUser ? 'sales' : 'website',
    soldBy: o.salesUser?.name || (o.salesUser ? 'Sales team' : 'Website'),
    customer: customerOf(o),
    city: [o.shippingAddress?.city, o.shippingAddress?.state].filter(Boolean).join(', '),
    summary: view?.summary || null,
    summaryStage: view?.summaryStage || null,
    needs: view?.needs || [],
    // Parcels in transit against their expected delivery date (badges + filter); null when none.
    eta: etaSummary(o.shipments, istDay()),
    lines: (o.items || []).map((it) => {
      const wl = view?.lines.find((l) => l.itemId === idOf(it._id));
      return {
        itemId: idOf(it._id),
        // For the panel's "open on the website" link (resolved to a slug on click).
        productId: it.product ? idOf(it.product) : null,
        variantId: it.variantId ? idOf(it.variantId) : null,
        name: it.name,
        variantLabel: it.variantLabel || null,
        quantity: it.quantity,
        price: it.price,
        stage: wl?.stage || null,
        stageLabel: wl?.stageLabel || null,
      };
    }),
  };
}

/** What this person may do to this line right now (drives the buttons; re-checked on submit). */
function lineActions(u, order, line) {
  const out = [];
  if (can.procurement(u)) {
    switch (line.stage) {
      // 'ship' here too: "Ship all" sends lines nobody stock-checked yet — shipping them proves they were in stock.
      case STAGE.STOCK_CHECK: out.push('in_stock', 'own_stock', 'ordered', 'out_of_stock', 'ship'); break;
      // "Ordered from supplier" comes from paying the supplier now (a supplier payment
      // request), and the old manual "payment initiated" mark is replaced by it.
      case STAGE.TO_SHIP: out.push('own_stock', 'out_of_stock', 'ship'); break;
      // Our warehouse ships only through its own dispatch (courier + tracking), never in a supplier parcel.
      case STAGE.OWN_STOCK: out.push('out_of_stock', 'dispatch_own'); break;
      // Not 'own_stock': the supplier is already paid for this one.
      case STAGE.WITH_SUPPLIER: out.push('in_stock', 'ordered', 'out_of_stock', 'ship'); break;
      case STAGE.CUSTOMER_DECISION: out.push('in_stock', 'own_stock', 'ordered'); break;
      case STAGE.ACCOUNTS_APPROVAL: if (!line.accountsApprovedAt) out.push('in_stock', 'own_stock', 'ordered'); break;
      default: break;
    }
  }
  if (line.stage === STAGE.CUSTOMER_DECISION && can.decide(u, order)) out.push('wait', 'refund');
  if (mayUndoStock(u, line)) out.push('stock_undo');
  if (undoableDecision(u, order, line)) out.push('decision_undo');
  if (line.stage === STAGE.ACCOUNTS_APPROVAL && !line.accountsApprovedAt && can.accounts(u)) out.push('approve', 'reject');
  return out;
}

const HISTORY_LABELS = {
  entered: 'Paid — waiting for a stock check',
  stock_in_stock: 'Marked in stock',
  stock_own_stock: 'From our warehouse',
  stock_ordered: 'Ordered from supplier',
  stock_out_of_stock: 'Marked out of stock',
  payment_initiated: 'Supplier payment initiated',
  payment_undone: 'Supplier payment mark removed',
  customer_waits: 'Customer will wait for stock',
  refund_requested: 'Customer wants a refund',
  refund_rejected: 'Refund sent back by accounts',
  refund_approved: 'Refund approved by accounts',
  refund_approval_failed: 'Refund approval could not be recorded',
  refund_sent: 'Refund sent to the customer',
  refund_send_failed: 'Refund could not be sent — retry it',
  shipped: 'Supplier proof uploaded — shipped',
  shipped_own: 'Dispatched from our warehouse',
  delivered: 'Marked delivered',
  parcel_step: 'Parcel update',
  delivery_undone: 'Delivery undone — back in transit',
  payment_pending: 'Supplier payment requested — Payment Pending',
  payment_cleared: 'Supplier payment cancelled',
  stock_undone: 'Stock decision undone',
  decision_undone: 'Customer decision undone',
  dispatch_edited: 'Dispatch details corrected',
  eta_set: 'Expected delivery date set',
};

const photoPath = (orderId, shipmentId) => `/api/v1/staff/work/orders/${orderId}/parcels/${shipmentId}/photo`;

/** The full order for the detail view, with the actions this person may take. */
function detail(u, o) {
  const view = workflowView(o);
  const today = istDay();
  const base = row(o, view);
  const wfLines = new Map((view?.lines || []).map((l) => [l.itemId, l]));
  const names = new Map((o.items || []).map((it) => [idOf(it._id), itemName(it)]));

  return {
    ...base,
    inWorkflow: !!view,
    shippingAddress: o.shippingAddress || null,
    owesGoodie: owesGoodie(o),
    payment: o.payment && typeof o.payment === 'object'
      ? { razorpayPaymentId: o.payment.gatewayPaymentId || null, method: o.payment.method || null }
      : null,
    lines: base.lines.map((l) => {
      const wl = wfLines.get(l.itemId);
      return {
        ...l,
        stock: wl?.stock || null,
        supplierName: wl?.supplierName || '',
        paymentInitiatedAt: wl?.paymentInitiatedAt || null,
        supplierPaymentRef: wl?.supplierPaymentAt ? wl.supplierPaymentRef || '' : '',
        refundRequestedAt: wl?.refundRequestedAt || null,
        accountsApprovedAt: wl?.accountsApprovedAt || null,
        unshipped: unshippedQuantity(o, l.itemId),
        actions: wl ? lineActions(u, o, wl) : [],
      };
    }),
    parcels: (o.shipments || []).map((s) => ({
      id: idOf(s._id),
      sequence: s.sequence,
      status: s.status,
      courier: s.carrier?.name || '',
      trackingNumber: s.trackingNumber || '',
      shippedAt: s.shippedAt || null,
      deliveredAt: s.deliveredAt || null,
      items: (s.lines || []).map((l) => ({ name: names.get(idOf(l.itemId)) || 'Item', quantity: l.quantity })),
      // photoUrl: the first proof (the WhatsApp "we shared a photo" line keys off it).
      photoUrl: parcelProofs(s).length ? photoPath(idOf(o._id), idOf(s._id)) : null,
      photos: parcelProofs(s).map(({ id, ref }) => ({
        id, url: proofFilePath(idOf(o._id), idOf(s._id), id), contentType: ref.contentType || 'image/jpeg', name: ref.name || '',
      })),
      canMarkDelivered: s.status === SHIPMENT_STATUS.SHIPPED && can.operations(u),
      // Marked delivered by mistake: operations (or the admin) puts it back in transit.
      canUndoDelivered: s.status === SHIPMENT_STATUS.DELIVERED && can.operations(u),
      canEdit: mayEditShipment(u, s),
      // Courier progress, newest first; operations adds to it while in transit.
      steps: (s.trackingSteps || []).slice().reverse().map((t) => ({
        status: t.status, label: PARCEL_STEP_LABELS[t.status] || t.status, note: t.note || '', at: t.at, by: t.byName || '',
      })),
      stepCount: s.stepCount || 0,
      canAddStep: s.status === SHIPMENT_STATUS.SHIPPED && can.operations(u),
      // The team's expected delivery date (never shown to the customer).
      eta: s.eta?.day ? { date: s.eta.day, setBy: s.eta.setByName || '', setAt: s.eta.setAt || null } : null,
      etaState: etaState(s, today),
      etaHistory: (s.etaHistory || []).slice().reverse().map((h) => ({ from: h.from || '', to: h.to, by: h.byName || '', at: h.at })),
      canSetEta: s.status === SHIPMENT_STATUS.SHIPPED && can.planDelivery(u),
    })),
    cancellations: (o.cancellations || []).map((c) => ({
      id: idOf(c._id),
      items: (c.lines || []).map((l) => ({ name: names.get(idOf(l.itemId)) || 'Item', quantity: l.quantity })),
      reason: c.reason || '',
      cancelledAt: c.cancelledAt || null,
      refundStatus: c.refund?.status || null,
      refundAmount: c.refund?.productValuePaise != null ? c.refund.productValuePaise / 100 : null,
      refundFailure: c.refund?.status === 'failed' ? c.refund.failureReason || '' : '',
      canSendRefund: canSendRefund(u, o, c),
    })),
    history: (o.workflow?.history || []).slice().reverse().map((h) => ({
      at: h.at,
      by: h.byName || (h.by ? 'Staff' : 'System'),
      team: h.team ? (STAFF_TEAM_LABELS[h.team] || (h.team === 'admin' ? 'Admin' : h.team)) : '',
      action: HISTORY_LABELS[h.action] || h.action,
      // The raw action and line, so the order-journey tracker can place each
      // entry on its step without matching on the display label above.
      code: h.action,
      itemId: h.itemId ? idOf(h.itemId) : null,
      item: h.itemId ? names.get(idOf(h.itemId)) || '' : '',
      note: h.note || '',
    })),
    canShip: can.procurement(u) && (view?.lines || []).some((l) => SHIP_STAGES.has(l.stage)),
    canDispatchOwn: can.procurement(u) && (view?.lines || []).some((l) => l.stage === STAGE.OWN_STOCK),
    // Talking to the customer is the sales side's job: the seller, a sales head, or admin.
    canContactCustomer: can.decide(u, o),
    // The customer's saved bank account (refunds / NEFT): accounts and admin.
    canSeeCustomerBank: can.accounts(u),
  };
}

// ── Cursor (keyset) ─────────────────────────────────────────────────────────────

const encodeCursor = (date, id) => Buffer.from(`${new Date(date).toISOString()}|${id}`).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !/^[a-f0-9]{24}$/i.test(id || '')) return null;
    return { at, id };
  } catch {
    return null;
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────────

/**
 * One team's work queue, newest first (what the teams asked for). Reads only OPEN orders (indexed), works out
 * each one's current stages, and keeps the ones waiting on this team. An order that
 * turns out to have nothing left (an admin finished it from the admin panel) is
 * closed on the way past, so the queue heals itself.
 */
export async function listQueue(actor, queue, { cursor, ...filters } = {}) {
  const q = QUEUES[queue];
  if (!q) throw fail('Unknown work list.', 400);
  if (!q.allowed(actor)) throw fail('Not authorized.', 403);

  const f = readListFilters(filters);
  const newestFirst = f.sort !== 'oldest';
  const decoded = decodeCursor(cursor);
  let after = decoded ? { enteredAt: decoded.at, id: decoded.id } : null;
  const orders = [];
  let scanned = 0;
  let nextCursor = null;

  for (;;) {
    const batch = await orderRepository.findOpenWorkflowPage({ after, limit: SCAN_BATCH, newestFirst });
    let last = null;
    for (const o of batch) {
      scanned += 1;
      last = o;
      const view = workflowView(o);
      if (!view?.open) {
        orderRepository.setWorkflowOpen(o._id, false).catch(() => {});
        continue;
      }
      if (!view.needs.includes(q.team)) continue;
      if (q.team === 'sales' && !can.decide(actor, o)) continue;
      const r = row(o, view);
      if (!rowMatches(r, f)) continue;
      orders.push(r);
      if (orders.length >= PAGE_SIZE) break;
    }
    if (!last) break;                                   // nothing more at all
    const lastCursor = encodeCursor(last.workflow.enteredAt, idOf(last._id));
    if (orders.length >= PAGE_SIZE) { nextCursor = lastCursor; break; } // page full; more may follow
    if (batch.length < SCAN_BATCH) break;               // reached the end of the queue
    if (scanned >= MAX_SCAN) { nextCursor = lastCursor; break; }        // bounded work per request
    after = { enteredAt: last.workflow.enteredAt, id: last._id };
  }

  return { orders, nextCursor };
}

/** One order in full, if this person may see it. */
export async function getOrder(actor, orderId) {
  const o = await orderRepository.findForWorkflow(orderId);
  if (!o || !canView(actor, o)) throw fail('Order not found.', 404);
  return detail(actor, o);
}

/**
 * One proof of a parcel (by id; the first when none is given) — streamed through
 * us after the same permission check as the order, never a public link.
 */
export async function getProofPhoto(actor, orderId, shipmentId, photoId = null) {
  const o = await orderRepository.findForWorkflow(orderId);
  if (!o || !canView(actor, o)) throw fail('Not found.', 404);
  const parcel = (o.shipments || []).find((s) => idOf(s._id) === String(shipmentId));
  const proofs = parcelProofs(parcel);
  const found = photoId == null ? proofs[0] : proofs.find((p) => p.id === String(photoId));
  if (!found) throw fail(proofs.length ? 'Photo not found.' : 'This parcel has no photo.', 404);
  const { ref } = found;
  const buffer = await readPrivateAsset(ref, fetchBuffer);
  return { buffer, contentType: ref.contentType || 'image/jpeg', name: ref.name || '' };
}

const resourceTypeOf = (ref) => (ref?.contentType === 'application/pdf' ? 'raw' : 'image');
const removeProofs = (refs) => Promise.all(refs.map((r) =>
  deletePrivateAsset({ publicId: r.publicId, resourceType: resourceTypeOf(r), provider: r.provider }).catch(() => {})));

/** Check a parcel's proofs (photos or PDFs) before anything is stored. */
const checkProofs = (files, { existing = 0 } = {}) => checkAttachments(files, { existing, noun: 'photo' });

/** Store checked proofs privately, a few at a time; a failure part-way removes what was stored. */
async function storeProofs(checked, orderId, actor) {
  return storeAll(checked, async ({ file, contentType, ext, name }) => {
    const ref = await putPrivateAsset({
      buffer: file.buffer, folder: PROOF_FOLDER,
      basename: `proof-${orderId}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
      contentType, cloudinaryPrivate: true,
    });
    return {
      _id: new mongoose.Types.ObjectId(),
      publicId: ref.publicId, provider: ref.provider, url: ref.url || undefined,
      contentType, bytes: ref.bytes, name, uploadedAt: new Date(), uploadedBy: actor._id,
    };
  }, (r) => removeProofs([r]));
}

async function fetchBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Photo fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Writes ─────────────────────────────────────────────────────────────────────

const event = (actor, action, { itemId, note } = {}) => ({
  at: new Date(),
  by: actor._id,
  byName: actor.name,
  team: actorTeam(actor),
  action,
  ...(itemId && { itemId }),
  ...(note && { note: String(note).slice(0, 500) }),
});

const enqueue = (name, data) => {
  if (!process.env.REDIS_URL) return;
  getNotificationsQueue()
    .add(name, data)
    .catch((err) => console.error(`[TeamWorkflow] Failed to enqueue ${name}:`, err.message));
};

/** Re-derive whether the order still has team work, and file it accordingly. */
async function refreshOpen(orderId) {
  const o = await orderRepository.findForWorkflow(orderId);
  const view = o && workflowView(o);
  if (view) await orderRepository.setWorkflowOpen(orderId, view.open);
}

/** Load an order in the workflow and one of its lines, with that line's current stage. */
async function loadLine(orderId, itemId) {
  const o = await orderRepository.findForWorkflow(orderId);
  if (!o?.workflow?.enteredAt) throw fail('Order not found in the team workflow.', 404);
  const view = workflowView(o);
  const line = view.lines.find((l) => l.itemId === String(itemId));
  if (!line) throw fail('That item is not on this order.', 404);
  return { order: o, line };
}

const RACE = 'Someone else just updated this item. Refresh and try again.';

/**
 * Lines a supplier parcel may take: anything not out of stock, refunded, already
 * shipped — or from our own warehouse, which has its own dispatch (dispatchOwnStock).
 */
const SHIP_STAGES = new Set([STAGE.STOCK_CHECK, STAGE.TO_SHIP, STAGE.WITH_SUPPLIER]);

/*
  Supplier payments move the line (called by paymentRequestService, so a
  payment request and the line's stage can never disagree):
    raised            → "Payment Pending"          (markPaymentPending)
    paid by the admin → "Ordered From Supplier"    (markPaidOrdered)
    cancelled/declined→ back to where it was        (clearPaymentPending)
  Each is a compare-and-set on the line; none moves money.
*/

/** A supplier payment was raised for these lines: they read "Payment Pending". */
export async function markPaymentPending(actor, orderId, itemId, { supplierName, ref } = {}, req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can update stock.', 403);
  const { line } = await loadLine(orderId, itemId);
  if (![STAGE.STOCK_CHECK, STAGE.TO_SHIP, STAGE.WITH_SUPPLIER, STAGE.PAYMENT_PENDING].includes(line.stage)) return;
  const supplier = String(supplierName || '').trim().slice(0, 120);
  const updated = await orderRepository.updateWorkflowLineIf(
    orderId, itemId,
    { stock: line.stock, refundRequestedAt: line.refundRequestedAt || null, accountsApprovedAt: null },
    {
      set: { supplierPaymentAt: new Date(), supplierPaymentRef: String(ref || '').slice(0, 20), ...(supplier && { supplierName: supplier }) },
      // The manual "payment initiated" mark is replaced by the real request.
      unset: line.paymentInitiatedAt ? ['paymentInitiatedBy', 'paymentInitiatedAt'] : [],
    },
    event(actor, 'payment_pending', { itemId: line.itemId, note: [ref, supplier].filter(Boolean).join(' · ') }),
  );
  if (!updated) throw fail(RACE, 409);
  await refreshOpen(orderId);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_payment_pending', itemId: String(itemId), ref });
}

/**
 * The admin paid the supplier: the lines are now "Ordered From Supplier".
 * Best-effort by design — the payment is already recorded; a failure here is
 * logged and the line can be moved by hand. Never throws.
 */
export async function markPaidOrdered(actor, orderId, itemIds, supplierName) {
  for (const itemId of itemIds) {
    try {
      const { line } = await loadLine(orderId, itemId);
      if (line.stage !== STAGE.PAYMENT_PENDING) continue;
      const supplier = String(supplierName || line.supplierName || '').trim().slice(0, 120);
      await orderRepository.updateWorkflowLineIf(
        orderId, itemId,
        { stock: line.stock, supplierPaymentAt: line.supplierPaymentAt },
        {
          set: { stock: STOCK.ORDERED, stockBy: actor._id, stockAt: new Date(), ...(supplier && { supplierName: supplier }) },
          unset: ['supplierPaymentAt', 'supplierPaymentRef'],
        },
        event(actor, 'stock_ordered', { itemId: line.itemId, note: `Supplier paid${supplier ? ` · ${supplier}` : ''}` }),
      );
      enqueue(WORKFLOW_CHAT_JOB, { event: 'ordered', orderId: String(orderId), itemId: String(itemId), supplier, by: actor.name });
    } catch (err) {
      console.error(`[Workflow] could not mark ${orderId}/${itemId} ordered after payment (fix by hand):`, err.message);
    }
  }
  await refreshOpen(orderId).catch(() => {});
}

/** The payment was cancelled or declined: the lines go back to where they were. Never throws. */
export async function clearPaymentPending(actor, orderId, itemIds, reason) {
  for (const itemId of itemIds) {
    try {
      const { line } = await loadLine(orderId, itemId);
      if (!line.supplierPaymentAt) continue;
      await orderRepository.updateWorkflowLineIf(
        orderId, itemId,
        { supplierPaymentAt: line.supplierPaymentAt },
        { set: {}, unset: ['supplierPaymentAt', 'supplierPaymentRef'] },
        event(actor, 'payment_cleared', { itemId: line.itemId, note: reason }),
      );
    } catch (err) {
      console.error(`[Workflow] could not clear payment pending on ${orderId}/${itemId}:`, err.message);
    }
  }
  await refreshOpen(orderId).catch(() => {});
}

/*
  Undo, with no time limit, by anyone on the team that owns the step (and the
  admin) — but only while nothing has happened since: the state checks below are
  what keep stock and money right, not the clock. Steps that move money
  (approving, paying, refunds, confirming a transfer) and "Delivered" (which
  emails the customer, awards points and opens the return window) are not undone.
*/

/** May `u` undo this line's stock decision (In Stock / Our Warehouse / Out of Stock) now? */
function mayUndoStock(u, line) {
  if (!can.procurement(u) || line.supplierPaymentAt || line.refundRequestedAt) return false;
  if (!((line.stage === STAGE.TO_SHIP && line.stock === STOCK.IN_STOCK)
    || (line.stage === STAGE.OWN_STOCK && line.stock === STOCK.OWN_STOCK)
    || (line.stage === STAGE.CUSTOMER_DECISION && line.stock === STOCK.OUT_OF_STOCK))) return false;
  return true;
}

/** Procurement: take back "In Stock" / "Our Warehouse" / "Out of Stock" — the line is a New Order again. */
export async function undoStock(actor, orderId, itemId, req) {
  const { line } = await loadLine(orderId, itemId);
  if (!mayUndoStock(actor, line)) {
    throw fail('This stock decision can no longer be undone — something else has happened on this item since.', 409);
  }
  const updated = await orderRepository.updateWorkflowLineIf(
    orderId, itemId,
    { stock: line.stock, stockAt: line.stockAt, refundRequestedAt: null, supplierPaymentAt: null },
    { set: { stock: STOCK.PENDING }, unset: ['stockBy', 'stockAt', 'paymentInitiatedBy', 'paymentInitiatedAt'] },
    event(actor, 'stock_undone', { itemId: line.itemId, note: `Was: ${STAGE_LABELS[line.stage]}` }),
  );
  if (!updated) throw fail(RACE, 409);
  await refreshOpen(orderId);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_stock_undone', itemId: String(itemId) });
  return getOrder(actor, orderId);
}

/** The customer's last decision on this line, if it can still be taken back by `u`. */
function undoableDecision(u, order, line) {
  if (!can.decide(u, order)) return null;
  if (line.stage === STAGE.ACCOUNTS_APPROVAL && !line.accountsApprovedAt && line.refundRequestedAt) {
    return 'refund';
  }
  if (line.stage === STAGE.STOCK_CHECK && line.stock === STOCK.PENDING) {
    const last = [...(order.workflow?.history || [])].reverse().find((h) => h.itemId && idOf(h.itemId) === line.itemId);
    if (last?.action === 'customer_waits') return 'wait';
  }
  return null;
}

/** Sales: take back "Customer will wait" / "Customer wants refund" (before accounts acts). */
export async function undoDecision(actor, orderId, itemId, req) {
  const { order, line } = await loadLine(orderId, itemId);
  const which = undoableDecision(actor, order, line);
  if (!which) {
    throw fail('The customer\'s decision can no longer be undone — accounts has already acted on it.', 409);
  }
  const updated = which === 'refund'
    ? await orderRepository.updateWorkflowLineIf(
      orderId, itemId,
      { refundRequestedAt: line.refundRequestedAt, accountsApprovedAt: null },
      { set: {}, unset: ['refundRequestedBy', 'refundRequestedAt'] },
      event(actor, 'decision_undone', { itemId: line.itemId, note: 'Refund request taken back' }),
    )
    : await orderRepository.updateWorkflowLineIf(
      orderId, itemId,
      { stock: STOCK.PENDING },
      { set: { stock: STOCK.OUT_OF_STOCK, stockBy: actor._id, stockAt: new Date() }, unset: [] },
      event(actor, 'decision_undone', { itemId: line.itemId, note: '"Customer will wait" taken back' }),
    );
  if (!updated) throw fail(RACE, 409);
  await refreshOpen(orderId);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_decision_undone', itemId: String(itemId), which });
  return getOrder(actor, orderId);
}

/**
 * Procurement: correct a parcel's dispatch details (courier, tracking number) and
 * its proofs — add photos / PDFs, remove chosen ones — while it is in transit.
 *
 * The proof list is written whole (`$set`), guarded on the exact list read, so two
 * people editing at once cannot lose each other's photos: the second is refused
 * and asked to refresh. A parcel still on the single legacy `proofPhoto` has it
 * folded into the list here.
 */
export async function editShipment(actor, orderId, shipmentId, { courierName, trackingNumber, removePhotoIds } = {}, files = [], req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can change dispatch details.', 403);
  const o = await orderRepository.findForWorkflow(orderId);
  if (!o?.workflow?.enteredAt) throw fail('Order not found in the team workflow.', 404);
  const parcel = (o.shipments || []).find((s) => idOf(s._id) === String(shipmentId));
  if (!parcel) throw fail('Parcel not found on this order.', 404);
  if (!mayEditShipment(actor, parcel)) {
    throw fail('Dispatch details can only be corrected while the parcel is in transit.', 409);
  }
  const set = {};
  const unset = {};
  const changes = [];
  if (courierName != null) {
    const c = String(courierName).trim().slice(0, 80);
    if (c !== (parcel.carrier?.name || '')) { set['shipments.$.carrier.name'] = c; changes.push(`courier ${c || '—'}`); }
  }
  if (trackingNumber != null) {
    const t = String(trackingNumber).trim().slice(0, 80);
    if (t !== (parcel.trackingNumber || '')) { set['shipments.$.trackingNumber'] = t; changes.push(`tracking ${t || '—'}`); }
  }

  let removeIds = removePhotoIds;
  if (typeof removeIds === 'string') { try { removeIds = JSON.parse(removeIds); } catch { removeIds = [removeIds]; } }
  removeIds = new Set((Array.isArray(removeIds) ? removeIds : []).map(String));
  const proofs = parcelProofs(parcel);
  const removing = proofs.filter((p) => removeIds.has(p.id));
  const keeping = proofs.filter((p) => !removeIds.has(p.id));
  const checked = checkProofs(files, { existing: keeping.length });
  if (proofs.length && !keeping.length && !checked.length) {
    throw fail('Keep at least one photo of the parcel, or add a new one.', 400);
  }
  if (removing.length) changes.push(`${removing.length} proof${removing.length === 1 ? '' : 's'} removed`);
  if (checked.length) changes.push(`${checked.length} proof${checked.length === 1 ? '' : 's'} added`);
  if (!changes.length) return getOrder(actor, orderId);

  // Guard: the proofs are exactly what we read (same legacy ref, same list).
  const guard = { status: SHIPMENT_STATUS.SHIPPED };
  let stored = [];
  if (removing.length || checked.length) {
    const listIds = (parcel.proofPhotos || []).map((p) => p._id);
    guard.proofPhotos = listIds.length ? { $size: listIds.length, $all: listIds.map((id) => ({ $elemMatch: { _id: id } })) } : { $in: [null, []] };
    guard['proofPhoto.publicId'] = parcel.proofPhoto?.publicId || { $exists: false };
    stored = await storeProofs(checked, orderId, actor);
    set['shipments.$.proofPhotos'] = [
      ...keeping.map(({ id, ref }) => (id === LEGACY_PROOF_ID ? { ...ref, _id: new mongoose.Types.ObjectId() } : ref)),
      ...stored,
    ];
    if (parcel.proofPhoto?.publicId) unset['shipments.$.proofPhoto'] = '';
  }

  const updated = await orderRepository.updateShipmentIf(orderId, shipmentId, guard, set,
    event(actor, 'dispatch_edited', { note: `Parcel ${parcel.sequence}: ${changes.join(', ')}` }), { unset });
  if (!updated) {
    await removeProofs(stored);
    throw fail('This parcel changed just now — refresh and try again.', 409);
  }
  await removeProofs(removing.map((p) => p.ref));
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_dispatch_edited', shipmentId: String(shipmentId), fields: changes });
  return getOrder(actor, orderId);
}

function mayEditShipment(u, parcel) {
  if (!can.procurement(u) || parcel.status !== SHIPMENT_STATUS.SHIPPED) return false;
  return true;
}

/**
 * Procurement: record the stock check for one item.
 * @param {'in_stock'|'own_stock'|'ordered'|'out_of_stock'} stock
 */
export async function setStock(actor, orderId, itemId, { stock, supplierName } = {}, req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can update stock.', 403);
  if (![STOCK.IN_STOCK, STOCK.OWN_STOCK, STOCK.ORDERED, STOCK.OUT_OF_STOCK].includes(stock)) throw fail('Unknown stock status.', 400);
  const supplier = String(supplierName || '').trim();
  if (stock === STOCK.ORDERED && !supplier) throw fail('Enter the supplier you ordered from.', 400);

  const { order, line } = await loadLine(orderId, itemId);
  const allowed = lineActions(actor, order, line);
  if (!allowed.includes(stock)) {
    throw fail(`This item is "${STAGE_LABELS[line.stage]}" — it can't be changed to that now.`, 409);
  }
  if (stock === STOCK.OWN_STOCK) {
    // The stage check above already rules out "Payment Pending"; this is the
    // record itself, so a request that never reached the line still blocks it —
    // we must not pay a supplier for something we send ourselves.
    const open = await openSupplierPaymentFor(orderId, [itemId]);
    if (open) throw fail(`Supplier payment ${open.number} is open for this item — cancel it before sending it from our warehouse.`, 409);
  }

  const backFromRefund = !!line.refundRequestedAt;
  const clearsPayment = !!line.paymentInitiatedAt && stock !== STOCK.IN_STOCK;
  const updated = await orderRepository.updateWorkflowLineIf(
    orderId, itemId,
    { stock: line.stock, refundRequestedAt: line.refundRequestedAt || null, accountsApprovedAt: null },
    {
      set: {
        stock,
        stockBy: actor._id,
        stockAt: new Date(),
        ...(stock === STOCK.ORDERED && { supplierName: supplier }),
      },
      unset: [
        // Our own stock has no supplier: an old supplier name would mislead.
        ...(stock === STOCK.OWN_STOCK && line.supplierName ? ['supplierName'] : []),
        ...(backFromRefund && stock !== STOCK.OUT_OF_STOCK ? ['refundRequestedBy', 'refundRequestedAt'] : []),
        // "Payment initiated" belongs to an in-stock line only; leaving in stock drops it.
        ...(clearsPayment ? ['paymentInitiatedBy', 'paymentInitiatedAt'] : []),
      ],
    },
    event(actor, `stock_${stock}`, {
      itemId: line.itemId,
      note: [
        stock === STOCK.ORDERED ? `Supplier: ${supplier}` : (backFromRefund ? 'Stock found — refund request withdrawn' : ''),
        clearsPayment ? 'Supplier payment mark removed' : '',
      ].filter(Boolean).join(' · '),
    }),
  );
  if (!updated) throw fail(RACE, 409);

  await refreshOpen(orderId);
  if (stock === STOCK.OUT_OF_STOCK) enqueue('send-team-out-of-stock-alert', { orderId: String(orderId), itemId: String(itemId) });
  if (stock === STOCK.ORDERED) {
    enqueue(WORKFLOW_CHAT_JOB, { event: 'ordered', orderId: String(orderId), itemId: String(itemId), supplier, by: actor.name });
  }
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_stock', itemId: String(itemId), stock });
  return getOrder(actor, orderId);
}

/**
 * Procurement: mark (or unmark) that payment to the supplier has been initiated for an
 * in-stock item. A status marker everyone viewing the order can see — no money moves,
 * and the tracking upload does not wait for it.
 *
 * Compare-and-set on the line's current mark, so a double press or two people at once
 * record it once; the loser is told to refresh.
 */
export async function setPaymentInitiated(actor) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can update supplier payment.', 403);
  // Replaced by real supplier payment requests ("Payment Pending" → "Ordered From Supplier").
  throw fail('"Payment initiated" is replaced by "Request supplier payment" on the item.', 410);
}

/**
 * The lines a parcel will carry: the chosen items (or every eligible one), each with
 * what is still owed. Only lines in `stages` may go; asking for any other is a 409.
 */
function parcelLines(o, stages, itemIds, refusal) {
  const view = workflowView(o);
  const eligible = view.lines.filter((l) => stages.has(l.stage));
  const wanted = itemIds.length ? eligible.filter((l) => itemIds.map(String).includes(l.itemId)) : eligible;
  if (itemIds.length && wanted.length !== new Set(itemIds.map(String)).size) throw fail(refusal, 409);
  const lines = wanted
    .map((l) => ({ itemId: l.itemId, quantity: unshippedQuantity(o, l.itemId) }))
    .filter((l) => l.quantity > 0);
  if (!lines.length) throw fail('Nothing on this order is left to ship.', 409);
  return { wanted, lines };
}

/**
 * Store the checked proofs (photos / PDFs, may be none), create the parcel through
 * shipmentService (which emails the customer exactly as an admin shipment does and
 * rolls the order status up), and record it. The proofs are removed again if the
 * parcel cannot be recorded.
 */
async function createTeamParcel(actor, orderId, { lines, proofs = [], courier, tracking, includesReward, notes, action }) {
  const stored = await storeProofs(proofs, orderId, actor);

  const result = await shipmentService.createShipment(orderId, {
    lines,
    trackingNumber: tracking || undefined,
    carrier: courier ? { name: courier } : undefined,
    proofPhotos: stored,
    includesReward,
    notes,
  }, { userId: actor._id });

  if (!result.success) {
    await removeProofs(stored);
    throw fail(result.message || 'Could not record the shipment.', 409);
  }

  await orderRepository.pushWorkflowEvent(orderId, event(actor, action, {
    note: [courier, tracking].filter(Boolean).join(' · ') || 'Photo only',
  }));
  return result.shipment;
}

/**
 * Procurement: the supplier has dispatched — upload their photo (+ courier and
 * tracking when known). Creates a parcel for the chosen items through
 * shipmentService, which emails the customer exactly as an admin shipment does.
 */
export async function shipWithProof(actor, orderId, { itemIds = [], courierName, trackingNumber } = {}, files = [], req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can upload shipping proof.', 403);
  const proofs = checkProofs(files);
  if (!proofs.length) throw fail('Add a photo of the parcel, the courier receipt, or the supplier\'s screenshot.', 400);

  const o = await orderRepository.findForWorkflow(orderId);
  if (!o?.workflow?.enteredAt) throw fail('Order not found in the team workflow.', 404);
  const { wanted, lines } = parcelLines(o, SHIP_STAGES, itemIds,
    'Items marked out of stock, refunded, already shipped or from our warehouse can\'t go in a supplier parcel. Refresh and choose again.');
  // A supplier payment still awaiting approval or payment holds its items back:
  // procurement asks the supplier for shipping once accounts has paid.
  await assertNoPendingSupplierPayment(orderId, lines.map((l) => l.itemId));

  const shipment = await createTeamParcel(actor, orderId, {
    lines,
    proofs,
    courier: String(courierName || '').trim().slice(0, 80),
    tracking: String(trackingNumber || '').trim().slice(0, 80),
    // Drop-shipped by a supplier: any free gift owed on the order is NOT in this box.
    // The admin sends it separately, so it is never marked as shipped by mistake.
    includesReward: false,
    notes: `Supplier proof uploaded in the team panel by ${actor.name}`,
    action: 'shipped',
  });

  // Lines shipped straight from the stock check were in stock — record it, so the
  // line's history reads true. Compare-and-set on "still unchecked": if someone else
  // set the stock meanwhile, theirs stands. The parcel itself already makes the line
  // "Shipped" (stage is derived from parcels), so this is the record, not the gate.
  const shippedIds = new Set(lines.map((l) => l.itemId));
  for (const l of wanted.filter((x) => x.stage === STAGE.STOCK_CHECK && shippedIds.has(x.itemId))) {
    await orderRepository.updateWorkflowLineIf(
      orderId, l.itemId,
      { stock: { $in: [STOCK.PENDING, null] }, refundRequestedAt: null, accountsApprovedAt: null },
      { set: { stock: STOCK.IN_STOCK, stockBy: actor._id, stockAt: new Date() }, unset: [] },
      event(actor, `stock_${STOCK.IN_STOCK}`, { itemId: l.itemId, note: 'Shipped without a separate stock check' }),
    );
  }
  await refreshOpen(orderId);
  enqueue('send-team-shipped-alert', { orderId: String(orderId), shipmentId: String(shipment._id) });
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, {
    change: 'team_shipped', shipmentId: String(shipment._id), lines: lines.length,
  });
  return getOrder(actor, orderId);
}

const OWN_STOCK_STAGES = new Set([STAGE.OWN_STOCK]);

/**
 * Procurement: dispatch items from our own warehouse. No supplier and so no supplier
 * payment, accounts approval or admin payment: courier + tracking number (and an
 * optional parcel photo) and the items are shipped — operations follows them to
 * delivery like any other parcel, and the customer gets the same shipped email.
 *
 * We pack this box ourselves, so a free gift still owed rides in it.
 *
 * A double press or two people at once create ONE parcel: shipmentService's
 * compare-and-set re-validates against what is still owed, and the loser is refused.
 */
export async function dispatchOwnStock(actor, orderId, { itemIds = [], courierName, trackingNumber } = {}, files = [], req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can dispatch from our warehouse.', 403);
  const courier = String(courierName || '').trim().slice(0, 80);
  const tracking = String(trackingNumber || '').trim().slice(0, 80);
  if (!courier) throw fail('Enter the courier name.', 400);
  if (!tracking) throw fail('Enter the tracking number.', 400);
  const proofs = checkProofs(files); // optional here

  const o = await orderRepository.findForWorkflow(orderId);
  if (!o?.workflow?.enteredAt) throw fail('Order not found in the team workflow.', 404);
  const { lines } = parcelLines(o, OWN_STOCK_STAGES, itemIds,
    'Only items marked "Our Warehouse" can go in this parcel. Refresh and choose again.');
  // Belt and braces: an open supplier payment means someone is paying a supplier
  // for this item — do not also send it ourselves.
  await assertNoPendingSupplierPayment(orderId, lines.map((l) => l.itemId));

  const shipment = await createTeamParcel(actor, orderId, {
    lines,
    proofs,
    courier,
    tracking,
    includesReward: owesGoodie(o) && !rewardShipped(o),
    notes: `Dispatched from our warehouse in the team panel by ${actor.name}`,
    action: 'shipped_own',
  });

  await refreshOpen(orderId);
  enqueue('send-team-shipped-alert', { orderId: String(orderId), shipmentId: String(shipment._id), fromWarehouse: true });
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, {
    change: 'team_dispatched_own', shipmentId: String(shipment._id), lines: lines.length,
  });
  return getOrder(actor, orderId);
}

/** Sales: the customer's answer for an out-of-stock item. */
export async function recordDecision(actor, orderId, itemId, { decision, note } = {}, req) {
  if (!['wait', 'refund'].includes(decision)) throw fail('Choose "will wait" or "wants a refund".', 400);
  const { order, line } = await loadLine(orderId, itemId);
  if (!can.decide(actor, order)) throw fail('Only the sales person on this order (or a sales head) can record this.', 403);
  if (line.stage !== STAGE.CUSTOMER_DECISION) throw fail('This item is not waiting for the customer\'s decision.', 409);

  const updated = await orderRepository.updateWorkflowLineIf(
    orderId, itemId,
    { stock: STOCK.OUT_OF_STOCK, refundRequestedAt: null },
    decision === 'wait'
      ? { set: { stock: STOCK.PENDING, stockBy: actor._id, stockAt: new Date() } }
      : { set: { refundRequestedBy: actor._id, refundRequestedAt: new Date() } },
    event(actor, decision === 'wait' ? 'customer_waits' : 'refund_requested', { itemId: line.itemId, note }),
  );
  if (!updated) throw fail(RACE, 409);

  await refreshOpen(orderId);
  if (decision === 'refund') enqueue('send-team-refund-requested-alert', { orderId: String(orderId), itemId: String(itemId) });
  else enqueue(WORKFLOW_CHAT_JOB, { event: 'customer_waits', orderId: String(orderId), itemId: String(itemId), by: actor.name });
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_customer_decision', itemId: String(itemId), decision });
  return getOrder(actor, orderId);
}

/** A cancellation this workflow created (an approved out-of-stock refund) — never a return or an admin cancel. */
const workflowCancellation = (o, cancellationId) =>
  (o.workflow?.lines || []).some((l) => l.cancellationId && idOf(l.cancellationId) === String(cancellationId));

/** May this person (re)send this cancellation's refund from the team panel? */
function canSendRefund(u, o, c) {
  return can.accounts(u)
    && ['pending', 'failed'].includes(c.refund?.status)
    && o.paymentStatus === 'paid'
    && workflowCancellation(o, c._id);
}

/**
 * Send (or retry) the refund of a cancellation this workflow recorded. Never throws for
 * a gateway failure — the outcome is written to the history and the chat, and the
 * caller gets the updated order either way.
 */
async function sendRefund(actor, orderId, cancellationId, itemId, req) {
  const result = await cancellationService.refundCancellation(orderId, cancellationId);
  const sent = result.success && !result.alreadyRefunded;
  const amount = result.refund?.amountRupees;
  const note = sent
    ? [amount != null ? `₹${amount}` : '', result.message].filter(Boolean).join(' — ')
    : result.message;
  await orderRepository.pushWorkflowEvent(
    orderId,
    event(actor, result.success ? 'refund_sent' : 'refund_send_failed', { itemId, note }),
  );
  if (sent || !result.success) {
    enqueue(WORKFLOW_CHAT_JOB, {
      event: result.success ? 'refund_sent' : 'refund_send_failed',
      orderId: String(orderId),
      ...(itemId && { itemId: String(itemId) }),
      by: actor.name,
      note: String(note || '').slice(0, 300),
    });
  }
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, {
    change: result.success ? 'team_refund_sent' : 'team_refund_send_failed',
    cancellationId: String(cancellationId),
    ...(amount != null && { amountRupees: amount }),
    ...(!result.success && { reason: result.message }),
  });
  return result;
}

/**
 * Accounts: approve the refund — the item is cancelled and the refund is sent to the
 * customer straight away — or send it back to sales with a note.
 */
export async function reviewRefund(actor, orderId, itemId, { approve, note } = {}, req) {
  if (!can.accounts(actor)) throw fail('Only the accounts team can approve refunds.', 403);
  const { line } = await loadLine(orderId, itemId);
  if (line.stage !== STAGE.ACCOUNTS_APPROVAL || line.accountsApprovedAt) {
    throw fail('This item is not waiting for a refund approval.', 409);
  }

  if (!approve) {
    if (!String(note || '').trim()) throw fail('Add a note for the sales team explaining why.', 400);
    const updated = await orderRepository.updateWorkflowLineIf(
      orderId, itemId,
      { stock: STOCK.OUT_OF_STOCK, refundRequestedAt: line.refundRequestedAt, accountsApprovedAt: null },
      { unset: ['refundRequestedBy', 'refundRequestedAt'] },
      event(actor, 'refund_rejected', { itemId: line.itemId, note }),
    );
    if (!updated) throw fail(RACE, 409);
    await refreshOpen(orderId);
    enqueue(WORKFLOW_CHAT_JOB, {
      event: 'refund_rejected', orderId: String(orderId), itemId: String(itemId), by: actor.name, note: String(note).slice(0, 500),
    });
    auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_refund_rejected', itemId: String(itemId) });
    return getOrder(actor, orderId);
  }

  // Claim the approval first: a second approver (or a double-click) finds it taken.
  const approvedAt = new Date();
  const claimed = await orderRepository.updateWorkflowLineIf(
    orderId, itemId,
    { stock: STOCK.OUT_OF_STOCK, refundRequestedAt: line.refundRequestedAt, accountsApprovedAt: null },
    { set: { accountsApprovedBy: actor._id, accountsApprovedAt: approvedAt } },
    null, // the history entry is written once the outcome is known
  );
  if (!claimed) throw fail(RACE, 409);

  const quantity = unshippedQuantity(claimed, itemId);
  const result = quantity > 0
    ? await cancellationService.cancelLines(orderId, {
      lines: [{ itemId: String(itemId), quantity }],
      reason: 'out_of_stock',
      notes: `Out of stock — refund approved in the team panel by ${actor.name}${note ? `: ${note}` : ''}`,
    }, { userId: actor._id })
    : { success: false, message: 'Nothing left to cancel on this item.' };

  if (!result.success) {
    // Release the claim so it can be retried or sent back; record why.
    await orderRepository.updateWorkflowLineIf(
      orderId, itemId,
      { accountsApprovedAt: approvedAt },
      { unset: ['accountsApprovedBy', 'accountsApprovedAt'] },
      event(actor, 'refund_approval_failed', { itemId: line.itemId, note: result.message }),
    );
    throw fail(result.message || 'Could not record the refund.', 409);
  }

  await orderRepository.updateWorkflowLineIf(
    orderId, itemId,
    { accountsApprovedAt: approvedAt },
    { set: { cancellationId: result.cancellation._id } },
    event(actor, 'refund_approved', {
      itemId: line.itemId,
      note: [`Refund of ₹${result.refund?.amountRupees ?? ''}`, note].filter(Boolean).join(' — '),
    }),
  );
  await refreshOpen(orderId);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, {
    change: 'team_refund_approved', itemId: String(itemId), cancellationId: String(result.cancellation._id),
  });
  // The approval is recorded whatever the gateway says next: a failed send stays
  // `failed` on the cancellation and is retried with retryRefund.
  await sendRefund(actor, orderId, result.cancellation._id, line.itemId, req);
  return getOrder(actor, orderId);
}

/** Accounts: send again a refund whose first attempt failed (or never went out). */
export async function retryRefund(actor, orderId, cancellationId, req) {
  if (!can.accounts(actor)) throw fail('Only the accounts team can send refunds.', 403);
  const order = await orderRepository.findForWorkflow(orderId);
  if (!order) throw fail('Order not found.', 404);
  const record = (order.cancellations || []).find((c) => idOf(c._id) === String(cancellationId));
  if (!record || !workflowCancellation(order, cancellationId)) {
    throw fail('This refund is not one the team panel sends — use Admin → Refunds.', 404);
  }
  if (!canSendRefund(actor, order, record)) {
    throw fail(record.refund?.status === 'completed' || record.refund?.status === 'processing'
      ? 'This refund has already been sent.'
      : 'This refund cannot be sent from here.', 409);
  }
  const line = (order.workflow?.lines || []).find((l) => idOf(l.cancellationId) === String(cancellationId));
  const result = await sendRefund(actor, orderId, cancellationId, line?.itemId, req);
  if (!result.success) throw fail(result.message || 'The refund could not be sent.', result.statusCode || 502);
  return getOrder(actor, orderId);
}

/**
 * Operations: record where a parcel in transit has got to — picked up, in transit,
 * out for delivery, or delivery failed — with an optional short note (a city, the
 * courier's remark). The customer sees it under the parcel. It never changes the
 * order's status: "Delivered" is markDelivered.
 *
 * Compare-and-set on the parcel's step count the person saw, so a double press or
 * two people at once add ONE step; the loser is told to refresh.
 */
export async function addParcelStep(actor, orderId, shipmentId, { status, note, expectedSteps } = {}, req) {
  if (!can.operations(actor)) throw fail('Only the operations team can update a parcel.', 403);
  if (!PARCEL_STEP_VALUES.includes(status)) throw fail('Choose picked up, in transit, out for delivery or delivery failed.', 400);
  const expected = Number(expectedSteps);
  if (!Number.isInteger(expected) || expected < 0) throw fail(RACE, 409);
  const text = String(note || '').trim().slice(0, MAX_STEP_NOTE);

  const o = await orderRepository.findForWorkflow(orderId);
  if (!o?.workflow?.enteredAt) throw fail('Order not found in the team workflow.', 404);
  const parcel = (o.shipments || []).find((s) => idOf(s._id) === String(shipmentId));
  if (!parcel) throw fail('Parcel not found on this order.', 404);
  if (parcel.status !== SHIPMENT_STATUS.SHIPPED) throw fail('Only a parcel in transit can be updated.', 409);

  const at = new Date();
  const label = PARCEL_STEP_LABELS[status];
  const updated = await orderRepository.pushShipmentStepIf(orderId, shipmentId, expected, {
    step: { status, ...(text && { note: text }), at, by: actor._id, byName: actor.name },
    trackingEvent: {
      timestamp: at,
      status: TRACKING_EVENT_STATUS[status],
      ...(text && { location: text }),
      description: (o.shipments || []).length > 1 ? `Parcel ${parcel.sequence}: ${label}` : label,
      scannedBy: 'Autobacs India',
    },
    event: event(actor, 'parcel_step', { note: [`Parcel ${parcel.sequence}: ${label}`, text].filter(Boolean).join(' · ') }),
    maxSteps: MAX_PARCEL_STEPS,
  });
  if (!updated) throw fail('This parcel was just updated by someone else (or delivered). Refresh and try again.', 409);

  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_parcel_step', shipmentId: String(shipmentId), status });
  return getOrder(actor, orderId);
}

/**
 * Procurement / operations: the date a parcel in transit is expected to arrive,
 * after checking with the courier. The morning job reminds whoever set it, in
 * team chat, on that day — and each working morning after while it is still in
 * transit — so changing the date moves the reminder, and "delivered" stops it.
 *
 * `previousDate` is the date the person saw ('' for none): if someone else
 * changed it meanwhile, they are told to refresh rather than overwrite it. The
 * write itself is a compare-and-set on the stored date and on the parcel still
 * being in transit (orderRepository.setShipmentEtaIf).
 */
export async function setParcelEta(actor, orderId, shipmentId, { date, previousDate } = {}, req) {
  if (!can.planDelivery(actor)) throw fail('Only procurement, operations or an admin can set the expected delivery date.', 403);
  const day = parseEtaDay(date);
  const problem = etaDayProblem(day, istDay());
  if (problem) throw fail(problem, 400);

  const o = await orderRepository.findForWorkflow(orderId);
  if (!o?.workflow?.enteredAt) throw fail('Order not found in the team workflow.', 404);
  const parcel = (o.shipments || []).find((s) => idOf(s._id) === String(shipmentId));
  if (!parcel) throw fail('Parcel not found on this order.', 404);
  if (parcel.status !== SHIPMENT_STATUS.SHIPPED) throw fail('The expected delivery date can only be set while the parcel is in transit.', 409);

  const current = parcel.eta?.day || '';
  if (previousDate != null && String(previousDate) !== current) throw fail('Someone else just changed this date. Refresh and try again.', 409);
  if (day === current) return getOrder(actor, orderId);

  const at = new Date();
  const updated = await orderRepository.setShipmentEtaIf(orderId, shipmentId, current, {
    eta: { day, setBy: actor._id, setByName: actor.name, setByTeam: actorTeam(actor), setAt: at },
    change: { ...(current && { from: current }), to: day, by: actor._id, byName: actor.name, at },
    event: event(actor, 'eta_set', {
      note: `Parcel ${parcel.sequence}: ${current ? `${formatEtaDay(current)} → ` : ''}${formatEtaDay(day)}`,
    }),
    maxHistory: MAX_ETA_HISTORY,
  });
  if (!updated) throw fail('This parcel was just updated by someone else (or delivered). Refresh and try again.', 409);

  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_parcel_eta', shipmentId: String(shipmentId), from: current || null, to: day });
  return getOrder(actor, orderId);
}

/** Operations: the parcel (or every parcel in transit) has arrived. */
/**
 * Operations: undo "delivered" on one parcel marked by mistake — it is back in
 * transit and the order back in the deliveries queue. See
 * shipmentService.undoShipmentDelivered for what delivery started and how each
 * part is handled (points kept, review email skipped, affiliate maturity cleared).
 */
export async function undoDelivered(actor, orderId, { shipmentId } = {}, req) {
  if (!can.operations(actor)) throw fail('Only the operations team can undo a delivery.', 403);
  const o = await orderRepository.findForWorkflow(orderId);
  if (!o || !canView(actor, o)) throw fail('Order not found.', 404);
  const parcel = (o.shipments || []).find((s) => idOf(s._id) === String(shipmentId));
  if (!parcel) throw fail('Parcel not found on this order.', 404);

  const r = await shipmentService.undoShipmentDelivered(orderId, idOf(parcel._id), { userId: actor._id });
  if (!r.success) throw fail(r.message, 409);
  if (!r.alreadyUndone) {
    if (o.workflow?.enteredAt) {
      await orderRepository.pushWorkflowEvent(orderId, event(actor, 'delivery_undone', { note: `Parcel ${parcel.sequence}` }));
    }
    auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_delivery_undone', shipmentId: idOf(parcel._id) });
  }
  await refreshOpen(orderId);
  return getOrder(actor, orderId);
}

export async function markDelivered(actor, orderId, { shipmentId } = {}, req) {
  if (!can.operations(actor)) throw fail('Only the operations team can mark deliveries.', 403);
  const o = await orderRepository.findForWorkflow(orderId);
  if (!o || !canView(actor, o)) throw fail('Order not found.', 404);

  const inTransit = (o.shipments || []).filter((s) => s.status === SHIPMENT_STATUS.SHIPPED
    && (!shipmentId || idOf(s._id) === String(shipmentId)));
  if (!inTransit.length) throw fail('No parcel on this order is in transit.', 409);

  let delivered = 0;
  for (const s of inTransit) {
    const r = await shipmentService.markShipmentDelivered(orderId, idOf(s._id), { userId: actor._id });
    if (r.success && !r.alreadyDelivered) delivered += 1;
  }
  if (delivered) {
    await orderRepository.pushWorkflowEvent(orderId, event(actor, 'delivered', {
      note: inTransit.length > 1 ? `${delivered} parcels` : `Parcel ${inTransit[0].sequence}`,
    }));
    enqueue(WORKFLOW_CHAT_JOB, { event: 'delivered', orderId: String(orderId), by: actor.name });
  }
  await refreshOpen(orderId);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_delivered', parcels: delivered });
  return getOrder(actor, orderId);
}
