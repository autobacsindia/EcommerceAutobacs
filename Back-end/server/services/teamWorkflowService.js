/**
 * Team workflow — what each team does with a paid order, from the /team panel.
 *
 *   procurement : stock check per item (in stock / ordered from supplier / out of stock),
 *                 then uploads the supplier's photo + courier + tracking → shipped
 *   sales       : out of stock → asks the customer: wait for stock, or refund
 *   accounts    : approves (or sends back) a refund the customer asked for
 *   operations  : follows the parcel and marks it delivered
 *   admin       : pays the approved refund from the admin Refunds page (unchanged)
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
 * ── NO MONEY MOVES HERE ─────────────────────────────────────────────────────────
 * The team panel never calls the payment gateway. An approved refund becomes a
 * `pending` cancellation refund that only an admin can pay.
 */

import crypto from 'crypto';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import shipmentService from './shipmentService.js';
import cancellationService from './cancellationService.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { detectKind, KIND } from './storage/contentSniff.js';
import { getNotificationsQueue } from '../queue/queues.js';
import { STAFF_TEAMS, STAFF_TEAM_LABELS } from '../config/staff.js';
import { workflowView, STAGE, STOCK, STAGE_LABELS, unshippedQuantity } from '../utils/teamWorkflow.js';
import { SHIPMENT_STATUS } from '../utils/orderFulfilment.js';
import { owesGoodie, variantDisplayName } from '../utils/orderLines.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const PAGE_SIZE = 25;
const SCAN_BATCH = 50;
const MAX_SCAN = 500;
export const MAX_PROOF_BYTES = 8 * 1024 * 1024;
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
  decisions: { team: 'sales', allowed: (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.SALES) },
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
    needs: view?.needs || [],
    lines: (o.items || []).map((it) => {
      const wl = view?.lines.find((l) => l.itemId === idOf(it._id));
      return {
        itemId: idOf(it._id),
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
      case STAGE.STOCK_CHECK: out.push('in_stock', 'ordered', 'out_of_stock'); break;
      case STAGE.TO_SHIP:
        out.push('ordered', 'out_of_stock', 'ship', line.paymentInitiatedAt ? 'payment_undo' : 'payment_initiated');
        break;
      case STAGE.WITH_SUPPLIER: out.push('in_stock', 'ordered', 'out_of_stock', 'ship'); break;
      case STAGE.CUSTOMER_DECISION: out.push('in_stock', 'ordered'); break;
      case STAGE.ACCOUNTS_APPROVAL: if (!line.accountsApprovedAt) out.push('in_stock', 'ordered'); break;
      default: break;
    }
  }
  if (line.stage === STAGE.CUSTOMER_DECISION && can.decide(u, order)) out.push('wait', 'refund');
  if (line.stage === STAGE.ACCOUNTS_APPROVAL && !line.accountsApprovedAt && can.accounts(u)) out.push('approve', 'reject');
  return out;
}

const HISTORY_LABELS = {
  entered: 'Paid — waiting for a stock check',
  stock_in_stock: 'Marked in stock',
  stock_ordered: 'Ordered from supplier',
  stock_out_of_stock: 'Marked out of stock',
  payment_initiated: 'Supplier payment initiated',
  payment_undone: 'Supplier payment mark removed',
  customer_waits: 'Customer will wait for stock',
  refund_requested: 'Customer wants a refund',
  refund_rejected: 'Refund sent back by accounts',
  refund_approved: 'Refund approved — waiting for admin to pay',
  refund_approval_failed: 'Refund approval could not be recorded',
  shipped: 'Supplier proof uploaded — shipped',
  delivered: 'Marked delivered',
};

const photoPath = (orderId, shipmentId) => `/api/v1/staff/work/orders/${orderId}/parcels/${shipmentId}/photo`;

/** The full order for the detail view, with the actions this person may take. */
function detail(u, o) {
  const view = workflowView(o);
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
      photoUrl: s.proofPhoto?.publicId ? photoPath(idOf(o._id), idOf(s._id)) : null,
      canMarkDelivered: s.status === SHIPMENT_STATUS.SHIPPED && can.operations(u),
    })),
    cancellations: (o.cancellations || []).map((c) => ({
      id: idOf(c._id),
      items: (c.lines || []).map((l) => ({ name: names.get(idOf(l.itemId)) || 'Item', quantity: l.quantity })),
      reason: c.reason || '',
      cancelledAt: c.cancelledAt || null,
      refundStatus: c.refund?.status || null,
      refundAmount: c.refund?.productValuePaise != null ? c.refund.productValuePaise / 100 : null,
    })),
    history: (o.workflow?.history || []).slice().reverse().map((h) => ({
      at: h.at,
      by: h.byName || (h.by ? 'Staff' : 'System'),
      team: h.team ? (STAFF_TEAM_LABELS[h.team] || (h.team === 'admin' ? 'Admin' : h.team)) : '',
      action: HISTORY_LABELS[h.action] || h.action,
      item: h.itemId ? names.get(idOf(h.itemId)) || '' : '',
      note: h.note || '',
    })),
    canShip: can.procurement(u) && (view?.lines || []).some((l) => l.stage === STAGE.TO_SHIP || l.stage === STAGE.WITH_SUPPLIER),
    // Talking to the customer is the sales side's job: the seller, a sales head, or admin.
    canContactCustomer: can.decide(u, o),
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
 * One team's work queue, oldest first. Reads only OPEN orders (indexed), works out
 * each one's current stages, and keeps the ones waiting on this team. An order that
 * turns out to have nothing left (an admin finished it from the admin panel) is
 * closed on the way past, so the queue heals itself.
 */
export async function listQueue(actor, queue, { cursor } = {}) {
  const q = QUEUES[queue];
  if (!q) throw fail('Unknown work list.', 400);
  if (!q.allowed(actor)) throw fail('Not authorized.', 403);

  const decoded = decodeCursor(cursor);
  let after = decoded ? { enteredAt: decoded.at, id: decoded.id } : null;
  const orders = [];
  let scanned = 0;
  let nextCursor = null;

  for (;;) {
    const batch = await orderRepository.findOpenWorkflowPage({ after, limit: SCAN_BATCH });
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
      orders.push(row(o, view));
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

/** The supplier's photo for one parcel — streamed through us, never a public link. */
export async function getProofPhoto(actor, orderId, shipmentId) {
  const o = await orderRepository.findForWorkflow(orderId);
  if (!o || !canView(actor, o)) throw fail('Not found.', 404);
  const parcel = (o.shipments || []).find((s) => idOf(s._id) === String(shipmentId));
  const ref = parcel?.proofPhoto;
  if (!ref?.publicId) throw fail('This parcel has no photo.', 404);
  const buffer = await readPrivateAsset(ref, fetchBuffer);
  return { buffer, contentType: ref.contentType || 'image/jpeg' };
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
 * Procurement: record the stock check for one item.
 * @param {'in_stock'|'ordered'|'out_of_stock'} stock
 */
export async function setStock(actor, orderId, itemId, { stock, supplierName } = {}, req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can update stock.', 403);
  if (![STOCK.IN_STOCK, STOCK.ORDERED, STOCK.OUT_OF_STOCK].includes(stock)) throw fail('Unknown stock status.', 400);
  const supplier = String(supplierName || '').trim();
  if (stock === STOCK.ORDERED && !supplier) throw fail('Enter the supplier you ordered from.', 400);

  const { order, line } = await loadLine(orderId, itemId);
  const allowed = lineActions(actor, order, line);
  if (!allowed.includes(stock)) {
    throw fail(`This item is "${STAGE_LABELS[line.stage]}" — it can't be changed to that now.`, 409);
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
export async function setPaymentInitiated(actor, orderId, itemId, { initiated } = {}, req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can update supplier payment.', 403);
  const on = initiated === true || initiated === 'true';

  const { order, line } = await loadLine(orderId, itemId);
  if (!lineActions(actor, order, line).includes(on ? 'payment_initiated' : 'payment_undo')) {
    throw fail(on
      ? `Payment can only be marked on an in-stock item that has not shipped (this one is "${STAGE_LABELS[line.stage]}").`
      : 'There is no payment mark to remove on this item.', 409);
  }

  const updated = await orderRepository.updateWorkflowLineIf(
    orderId, itemId,
    { stock: STOCK.IN_STOCK, paymentInitiatedAt: on ? null : line.paymentInitiatedAt },
    on
      ? { set: { paymentInitiatedBy: actor._id, paymentInitiatedAt: new Date() } }
      : { unset: ['paymentInitiatedBy', 'paymentInitiatedAt'] },
    event(actor, on ? 'payment_initiated' : 'payment_undone', { itemId: line.itemId }),
  );
  if (!updated) throw fail(RACE, 409);

  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_supplier_payment', itemId: String(itemId), initiated: on });
  return getOrder(actor, orderId);
}

/**
 * Procurement: the supplier has dispatched — upload their photo (+ courier and
 * tracking when known). Creates a parcel for the chosen items through
 * shipmentService, which emails the customer exactly as an admin shipment does.
 */
export async function shipWithProof(actor, orderId, { itemIds = [], courierName, trackingNumber } = {}, file, req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can upload shipping proof.', 403);
  if (!file?.buffer?.length) throw fail('Add the supplier\'s photo or screenshot.', 400);
  if (file.buffer.length > MAX_PROOF_BYTES) throw fail('The photo is too large (8 MB maximum).', 400);
  if (detectKind(file.buffer) !== KIND.IMAGE) throw fail('The proof must be a photo or screenshot (JPG, PNG or WebP).', 400);

  const o = await orderRepository.findForWorkflow(orderId);
  if (!o?.workflow?.enteredAt) throw fail('Order not found in the team workflow.', 404);
  const view = workflowView(o);
  const shippable = view.lines.filter((l) => l.stage === STAGE.TO_SHIP || l.stage === STAGE.WITH_SUPPLIER);
  const wanted = itemIds.length ? shippable.filter((l) => itemIds.map(String).includes(l.itemId)) : shippable;
  if (itemIds.length && wanted.length !== new Set(itemIds.map(String)).size) {
    throw fail('Only items marked in stock or ordered from the supplier can be shipped.', 409);
  }
  const lines = wanted
    .map((l) => ({ itemId: l.itemId, quantity: unshippedQuantity(o, l.itemId) }))
    .filter((l) => l.quantity > 0);
  if (!lines.length) throw fail('Nothing on this order is ready to ship. Mark the items in stock first.', 409);

  const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[String(file.mimetype || '').split('/')[1]] || 'jpg';
  const stored = await putPrivateAsset({
    buffer: file.buffer,
    folder: PROOF_FOLDER,
    basename: `proof-${orderId}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
    contentType: file.mimetype || 'image/jpeg',
    cloudinaryPrivate: true,
  });
  const proofPhoto = {
    publicId: stored.publicId,
    provider: stored.provider,
    url: stored.url || undefined,
    contentType: file.mimetype || 'image/jpeg',
    bytes: stored.bytes,
    uploadedAt: new Date(),
    uploadedBy: actor._id,
  };

  const courier = String(courierName || '').trim().slice(0, 80);
  const tracking = String(trackingNumber || '').trim().slice(0, 80);
  const result = await shipmentService.createShipment(orderId, {
    lines,
    trackingNumber: tracking || undefined,
    carrier: courier ? { name: courier } : undefined,
    proofPhoto,
    // Drop-shipped by a supplier: any free gift owed on the order is NOT in this box.
    // The admin sends it separately, so it is never marked as shipped by mistake.
    includesReward: false,
    notes: `Supplier proof uploaded in the team panel by ${actor.name}`,
  }, { userId: actor._id });

  if (!result.success) {
    await deletePrivateAsset({ publicId: stored.publicId, resourceType: 'image', provider: stored.provider });
    throw fail(result.message || 'Could not record the shipment.', 409);
  }

  await orderRepository.pushWorkflowEvent(orderId, event(actor, 'shipped', {
    note: [courier, tracking].filter(Boolean).join(' · ') || 'Photo only',
  }));
  await refreshOpen(orderId);
  enqueue('send-team-shipped-alert', { orderId: String(orderId), shipmentId: String(result.shipment._id) });
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, {
    change: 'team_shipped', shipmentId: String(result.shipment._id), lines: lines.length,
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
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_customer_decision', itemId: String(itemId), decision });
  return getOrder(actor, orderId);
}

/**
 * Accounts: approve the refund (the item is cancelled and its refund waits for an
 * admin to pay it), or send it back to sales with a note.
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
  enqueue('send-admin-team-refund-ready-alert', { orderId: String(orderId), itemId: String(itemId) });
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, {
    change: 'team_refund_approved', itemId: String(itemId), cancellationId: String(result.cancellation._id),
  });
  return getOrder(actor, orderId);
}

/** Operations: the parcel (or every parcel in transit) has arrived. */
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
  }
  await refreshOpen(orderId);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'team_delivered', parcels: delivered });
  return getOrder(actor, orderId);
}
