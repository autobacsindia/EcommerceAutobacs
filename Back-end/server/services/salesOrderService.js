/**
 * Sales-panel orders — a customer who calls or WhatsApps the sales team.
 *
 * The sales member enters the customer, picks products and gives an offer price;
 * the server prices every line from the catalogue (pricingService, the same
 * authority as website checkout), checks each offer is between ₹1 and that
 * price, then creates the order through the shared offline-order path and sends
 * a Razorpay payment link tied to the order. Payment is confirmed only by the
 * verified `payment_link.paid` webhook — nobody in the panel can mark it paid.
 *
 * Who sees what (enforced here, not in the UI):
 *   - sales member  → creates orders; sees, re-links and cancels their OWN
 *   - sales head    → the same, for every sales-panel order
 *   - accounts / procurement (any member) → read-only list of PAID sales orders
 */

import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import razorpayService from './razorpayService.js';
import orderStatusService from './orderStatusService.js';
import pricingService from './pricingService.js';
import orderRepository from '../repositories/orderRepository.js';
import salesRepRepository from '../repositories/salesRepRepository.js';
import { createOfflineOrderRecord, PAYMENT_LINK_TTL_MS } from './offlineOrderService.js';
import SearchService from './searchService.js';
import productRepository from '../repositories/productRepository.js';
import { effectivePrice } from '../utils/productPrice.js';
import { isPurchasable } from '../utils/stockStatus.js';
import { STAFF_TEAMS } from '../config/staff.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const PAGE_SIZE = 25;

const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isSalesHead = (u) => onTeam(u, STAFF_TEAMS.SALES) && u.staff.isHead === true;

/** Paise-safe rupee value with at most two decimals, or NaN. */
const toRupees = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

// ── Cursor pagination (keyset on createdAt desc, _id desc) ───────────────────
const encodeCursor = (o) => Buffer.from(`${new Date(o.createdAt).toISOString()}|${o._id}`).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !/^[a-f0-9]{24}$/i.test(id || '')) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function page(baseQuery, cursor, { includePayment = false } = {}) {
  const c = decodeCursor(cursor);
  const query = c
    ? { ...baseQuery, $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c.id } }] }
    : baseQuery;
  const populate = [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name' },
  ];
  if (includePayment) populate.push({ path: 'payment', select: 'gatewayPaymentId method status amount createdAt' });
  const rows = await orderRepository.find(query, {
    limit: PAGE_SIZE + 1,
    sort: { createdAt: -1, _id: -1 },
    select: 'orderNumber createdAt status paymentStatus totalAmount items shippingAddress user salesUser paymentLinkUrl paymentLinkExpiresAt payment',
    populate,
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

const linkState = (o, now = Date.now()) => {
  if (o.paymentStatus === 'paid' || o.status !== 'awaiting_payment') return null;
  const exp = o.paymentLinkExpiresAt ? new Date(o.paymentLinkExpiresAt).getTime() : null;
  return exp && exp > now ? 'active' : 'expired';
};

/** The fields a panel row shows. Customer contact is only for people who need it. */
function shape(o) {
  const payment = o.payment && typeof o.payment === 'object' ? o.payment : null;
  return {
    id: String(o._id),
    orderNumber: o.orderNumber || String(o._id).slice(-8).toUpperCase(),
    createdAt: o.createdAt,
    status: o.status,
    paymentStatus: o.paymentStatus,
    totalAmount: o.totalAmount,
    items: (o.items || []).map((i) => ({
      name: i.name,
      variantLabel: i.variantLabel || null,
      quantity: i.quantity,
      price: i.price,
      listPrice: i.listPrice ?? null,
    })),
    customer: {
      name: o.user?.name || o.shippingAddress?.fullName || '',
      email: o.user?.email || '',
      phone: o.shippingAddress?.phone || o.user?.phone || '',
    },
    shippingAddress: o.shippingAddress || null,
    salesPerson: o.salesUser?.name || '',
    linkState: linkState(o),
    paymentLinkUrl: linkState(o) === 'active' ? o.paymentLinkUrl : null,
    paymentLinkExpiresAt: o.paymentLinkExpiresAt || null,
    razorpayPaymentId: payment?.gatewayPaymentId || null,
    paymentMethod: payment?.method || null,
  };
}

/**
 * Product picker for the sales form: the storefront search, then each hit's CURRENT
 * charge price for the product and every variant — computed with the same
 * effectivePrice() checkout uses, so the price a rep sees is exactly the ceiling
 * createSalesOrder enforces. Out-of-stock items are returned but flagged, so the
 * rep can tell the customer instead of guessing.
 */
export async function searchSalesProducts(actor, q) {
  if (!onTeam(actor, STAFF_TEAMS.SALES)) throw fail('Not authorized.', 403);
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const { products = [] } = await SearchService.searchProducts({ search: term, limit: 8, page: 1 });
  const ids = products.map((p) => p._id).filter(Boolean);
  if (ids.length === 0) return [];
  const docs = await productRepository.find({ _id: { $in: ids }, isActive: true }, { limit: 8 });
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const now = new Date();
  return ids
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((d) => ({
      id: String(d._id),
      name: d.name,
      sku: d.sku || '',
      image: d.images?.[0]?.url || '',
      price: toRupees(effectivePrice(d, now)),
      available: (d.variants || []).length ? true : isPurchasable(d.stock),
      variants: (d.variants || []).map((v) => ({
        id: String(v._id),
        label: v.label,
        price: toRupees(effectivePrice(v, now)),
        available: isPurchasable(v.stock),
      })),
    }));
}

/**
 * Create a sales order and its payment link.
 * @param {Object} actor  req.user (active sales staff)
 * @param {Object} input  { customer:{name,email,phone}, shippingAddress:{…}, items:[{product, variantId?, quantity, offerPrice}], notes? }
 */
export async function createSalesOrder(actor, input, req) {
  if (!onTeam(actor, STAFF_TEAMS.SALES)) throw fail('Only the sales team can create orders here.', 403);

  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) throw fail('Add at least one product.', 400);

  // Price every line from the catalogue — the ONLY source of the list price.
  // priceItems also refuses inactive products, missing variants and out-of-stock items.
  const { orderItems } = await pricingService.priceItems(
    items.map((i) => ({ product: i.product, variantId: i.variantId || null, quantity: Number(i.quantity) })),
  );

  const lineItems = orderItems.map((line, idx) => {
    const listPrice = toRupees(line.price);
    const offer = items[idx].offerPrice === undefined || items[idx].offerPrice === null || items[idx].offerPrice === ''
      ? listPrice
      : toRupees(items[idx].offerPrice);
    if (!Number.isFinite(offer) || offer < 1) {
      throw fail(`Enter a valid offer price for ${line.name} (at least ₹1).`, 400);
    }
    if (offer > listPrice) {
      throw fail(`The offer price for ${line.name} can't be higher than its price (₹${listPrice}).`, 400);
    }
    return {
      product: line.product,
      variantId: line.variantId || null,
      variantLabel: line.variantLabel || null,
      quantity: line.quantity,
      price: offer,
      // Snapshot the catalogue price only for a genuine markdown (same convention
      // as the admin offline path): null means "sold at the full price".
      listPrice: listPrice > offer ? listPrice : null,
      name: line.name,
      image: line.image || '',
    };
  });

  const rep = await salesRepRepository.findOrCreateForUser(actor);
  const customer = input.customer || {};

  const { order, customer: buyer, paymentLink } = await createOfflineOrderRecord({
    body: {}, // retail buyer: no GSTIN block from the panel
    email: String(customer.email).trim(),
    phone: String(customer.phone).trim(),
    name: String(customer.name || '').trim(),
    lineItems,
    shippingAddress: input.shippingAddress,
    paymentMode: 'link',
    salesRepId: rep._id,
    salesUserId: actor._id,
    actorId: actor._id,
    notes: input.notes ? String(input.notes).slice(0, 1000) : undefined,
    defaultNote: `Sales order created in the team panel by ${actor.name}`,
  });

  auditLogger.logAction(req, 'CREATE', 'Order', order._id, {
    via: 'sales_panel', totalAmount: order.totalAmount, lines: lineItems.length,
    discounted: lineItems.some((l) => l.listPrice),
    // Sold under half the catalogue price. Allowed — the call agreed the number
    // and the panel already asked the seller to confirm — but it is the shape a
    // dropped zero takes, so it must be findable without diffing every order.
    deepDiscount: lineItems.some((l) => l.listPrice && l.price < l.listPrice * 0.5),
  });

  const populated = await orderRepository.findById(order._id, [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name' },
  ]);
  return { order: shape(populated), paymentLink, customerIsNew: buyer.isNewUser };
}

/** Sales: own orders (member) or every sales-panel order (head). */
export async function listSalesOrders(actor, { cursor } = {}) {
  if (!onTeam(actor, STAFF_TEAMS.SALES)) throw fail('Not authorized.', 403);
  const base = isSalesHead(actor)
    ? { salesUser: { $type: 'objectId' } }
    : { salesUser: actor._id };
  const { items, nextCursor } = await page(base, cursor);
  return { orders: items.map(shape), nextCursor, scope: isSalesHead(actor) ? 'team' : 'mine' };
}

/** Accounts / Procurement (and the sales head): every PAID sales-panel order. */
export async function listPaidSalesOrders(actor, { cursor } = {}) {
  const allowed = onTeam(actor, STAFF_TEAMS.ACCOUNTS)
    || onTeam(actor, STAFF_TEAMS.PROCUREMENT)
    || isSalesHead(actor);
  if (!allowed) throw fail('Not authorized.', 403);
  const { items, nextCursor } = await page(
    { salesUser: { $type: 'objectId' }, paymentStatus: 'paid' },
    cursor,
    { includePayment: true },
  );
  return { orders: items.map(shape), nextCursor };
}

/** Load an unpaid sales order the actor may act on. */
async function loadOwnUnpaid(actor, orderId) {
  if (!onTeam(actor, STAFF_TEAMS.SALES)) throw fail('Not authorized.', 403);
  const order = await orderRepository.findById(orderId);
  if (!order || !order.salesUser) throw fail('Order not found.', 404);
  if (!isSalesHead(actor) && String(order.salesUser) !== String(actor._id)) {
    throw fail('You can only manage your own orders.', 403);
  }
  if (order.paymentStatus === 'paid' || order.status !== 'awaiting_payment') {
    throw fail('This order is already paid or closed.', 409);
  }
  return order;
}

/**
 * Make sure the order's current link can no longer be paid. An expired link is
 * already dead; a live one is cancelled at Razorpay. If Razorpay refuses (most
 * likely because the customer has just paid), stop — never issue a second link
 * or cancel an order whose money may already be taken.
 */
async function retireCurrentLink(order) {
  if (!order.paymentLinkId) return;
  const live = order.paymentLinkExpiresAt && new Date(order.paymentLinkExpiresAt).getTime() > Date.now();
  if (!live) return;
  try {
    await razorpayService.cancelPaymentLink(order.paymentLinkId);
  } catch {
    let status = 'unknown';
    try { ({ status } = await razorpayService.fetchPaymentLinkStatus(order.paymentLinkId)); } catch { /* keep unknown */ }
    if (status === 'cancelled' || status === 'expired') return;
    throw fail('The current payment link could not be cancelled — the customer may have just paid. Refresh in a minute before trying again.', 409);
  }
}

/** Issue a fresh payment link (old one expired or is cancelled first). */
export async function reissuePaymentLink(actor, orderId, req) {
  const order = await loadOwnUnpaid(actor, orderId);
  await retireCurrentLink(order);

  const populated = await orderRepository.findById(order._id, [{ path: 'user', select: 'name email phone' }]);
  const attempt = (order.paymentLinkAttempts || 1) + 1;
  const link = await razorpayService.createPaymentLink(order, {
    name: order.shippingAddress?.fullName || populated.user?.name,
    email: populated.user?.email || order.guestEmail,
    phone: order.shippingAddress?.phone,
  }, { attempt });

  // Conditional on still being unpaid, so a payment that lands meanwhile wins.
  const updated = await orderRepository.setPaymentLinkIfUnpaid(order._id, {
    linkId: link.id,
    url: link.shortUrl,
    expiresAt: new Date(Date.now() + PAYMENT_LINK_TTL_MS),
    attempt,
  });
  if (!updated) {
    // Paid while we were issuing: retire the link we just made so it can't be paid too.
    await razorpayService.cancelPaymentLink(link.id).catch(() => {});
    throw fail('This order was paid while the new link was being created — no new link is needed.', 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, { change: 'payment_link_reissued', attempt });
  const fresh = await orderRepository.findById(updated._id, [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name' },
  ]);
  return { order: shape(fresh), paymentLink: link };
}

/** Cancel an unpaid sales order (customer changed their mind). */
export async function cancelUnpaidSalesOrder(actor, orderId, req) {
  const order = await loadOwnUnpaid(actor, orderId);
  await retireCurrentLink(order);
  const result = await orderStatusService.updateOrderStatus(order._id.toString(), 'cancelled', {
    userId: actor._id,
    isAdmin: false,
    cancelledBy: 'admin',
    reason: 'customer_request',
    notes: `Cancelled before payment in the team panel by ${actor.name}`,
  });
  if (!result?.success) throw fail(result?.message || 'Could not cancel this order.', 409);
  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, { change: 'sales_order_cancelled_unpaid' });
  const fresh = await orderRepository.findById(order._id, [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name' },
  ]);
  return shape(fresh);
}
