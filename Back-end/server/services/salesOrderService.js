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
 *   - GTM lead      → creates orders; sees, re-links and cancels their OWN
 *   - GTM head      → the same, for every sales-panel order
 *   - GTM executive / customer support → none of this (config/staff.js canSell)
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
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { workflowView } from '../utils/teamWorkflow.js';
import { phoneOnlyEmailFor, publicEmail } from '../utils/customerContact.js';
import { paymentSummary, retireAllParts } from './salesPaymentService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const BANK_TRANSFER_WAITING = 'A bank transfer is waiting for accounts to check on this order. Wait until they confirm or reject it.';

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
  // $and, not a spread: the base query may carry its own $or, which a spread would
  // silently replace with the cursor's — page 2 would then ignore the filter.
  const query = c
    ? { $and: [baseQuery, { $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c.id } }] }] }
    : baseQuery;
  const populate = [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name' },
  ];
  if (includePayment) populate.push({ path: 'payment', select: 'gatewayPaymentId method status amount createdAt' });
  const rows = await orderRepository.find(query, {
    limit: PAGE_SIZE + 1,
    sort: { createdAt: -1, _id: -1 },
    select: 'orderNumber createdAt status paymentStatus totalAmount items shippingAddress user salesUser guestEmail '
      + 'paymentLinkId paymentLinkUrl paymentLinkExpiresAt paymentParts payment workflow shipments cancellations '
      + 'bankTransferPendingAt offlinePayment',
    populate,
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

const linkState = (o, now = Date.now()) => {
  if (o.paymentStatus === 'paid' || o.status !== 'awaiting_payment') return null;
  // Quotation-first orders are paid in parts (paymentParts), never by this link.
  if (!o.paymentLinkId && !o.paymentLinkUrl) return null;
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
      custom: !!i.custom,
    })),
    customer: {
      name: o.user?.name || o.shippingAddress?.fullName || '',
      email: publicEmail(o.user?.email || o.guestEmail || ''),
      phone: o.shippingAddress?.phone || o.user?.phone || '',
    },
    shippingAddress: o.shippingAddress || null,
    salesPerson: o.salesUser?.name || '',
    source: o.salesUser ? 'sales' : 'website',
    // Where the team workflow has got to (null for orders paid before it existed).
    workflowSummary: workflowView(o)?.summary || null,
    linkState: linkState(o),
    paymentLinkUrl: linkState(o) === 'active' ? o.paymentLinkUrl : null,
    paymentLinkExpiresAt: o.paymentLinkExpiresAt || null,
    razorpayPaymentId: payment?.gatewayPaymentId || null,
    paymentMethod: payment?.method || null,
    // Quotation-first orders: the payment parts and how much is in / still to ask.
    paymentFlow: o.paymentLinkId || o.paymentLinkUrl ? 'link' : 'parts',
    payment: paymentSummary(o),
    // Recorded and waiting for accounts (services/bankTransferService.js).
    bankTransferPending: !!o.bankTransferPendingAt,
    // Paid by bank transfer: what accounts confirmed.
    offlinePayment: o.offlinePayment ? { method: o.offlinePayment.method, reference: o.offlinePayment.reference, confirmedBy: o.offlinePayment.confirmedByName || '' } : null,
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
  if (!canSell(actor)) throw fail('Not authorized.', 403);
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
 * Price the lines of a sales quotation / order — the ONE place they are priced.
 *   catalogue line { product, variantId?, quantity, offerPrice? } → priced from the
 *     catalogue (inactive / out-of-stock refused); the offer must be ₹1 … list price
 *   custom line { custom: true, name, quantity, price } → not in the catalogue,
 *     named and priced by the seller, bounded here
 * Returns order-shaped lines in the order they were entered.
 */
export async function priceSalesLines(inputItems) {
  const items = Array.isArray(inputItems) ? inputItems : [];
  if (items.length === 0) throw fail('Add at least one product.', 400);

  const isCustom = (i) => i?.custom === true || i?.custom === 'true';
  const catalogueItems = items.filter((i) => !isCustom(i));

  // Price every CATALOGUE line from the catalogue — the ONLY source of its list price.
  // priceItems also refuses inactive products, missing variants and out-of-stock items.
  const { orderItems } = catalogueItems.length
    ? await pricingService.priceItems(
      catalogueItems.map((i) => ({ product: i.product, variantId: i.variantId || null, quantity: Number(i.quantity) })),
    )
    : { orderItems: [] };

  const catalogueLines = orderItems.map((line, idx) => {
    const listPrice = toRupees(line.price);
    const requested = catalogueItems[idx].offerPrice;
    const offer = requested === undefined || requested === null || requested === ''
      ? listPrice
      : toRupees(requested);
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

  // Custom lines: there is no catalogue price to check against — the agreed price
  // IS the price. Still bounded and validated here, never trusted blindly.
  const customLine = (i) => {
    const name = String(i.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 150);
    const quantity = Number(i.quantity);
    const price = toRupees(i.price);
    if (name.length < 2) throw fail('Name each custom item.', 400);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw fail(`Quantity for "${name}" must be 1–100.`, 400);
    if (!Number.isFinite(price) || price < 1 || price > 10000000) throw fail(`Enter a valid price for "${name}" (at least ₹1).`, 400);
    return { custom: true, quantity, price, listPrice: null, name, image: '' };
  };

  // Keep the order the seller entered the lines in.
  let next = 0;
  const lineItems = items.map((i) => (isCustom(i) ? customLine(i) : catalogueLines[next++]));

  return lineItems;
}

/**
 * Create a sales order and its payment link.
 * @param {Object} actor  req.user (active sales staff)
 * @param {Object} input  { customer:{name,email,phone}, shippingAddress:{…}, items:[…], notes? }
 *   items: a catalogue line { product, variantId?, quantity, offerPrice? }
 *          or a CUSTOM line { custom: true, name, quantity, price } — an item that
 *          is not in the catalogue, named and priced by the seller.
 */
export async function createSalesOrder(actor, input, req) {
  if (!canSell(actor)) throw fail('Only the GTM head and GTM leads can create orders here.', 403);

  const lineItems = await priceSalesLines(input.items);

  const rep = await salesRepRepository.findOrCreateForUser(actor);
  const customer = input.customer || {};

  const { order, customer: buyer, paymentLink } = await createOfflineOrderRecord({
    body: {}, // retail buyer: no GSTIN block from the panel
    // No email → an internal one from the mobile number, so a repeat order finds
    // the same customer and no mail is ever attempted (utils/customerContact.js).
    email: String(customer.email ?? '').trim() || phoneOnlyEmailFor(String(customer.phone ?? '').trim()),
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
    customLines: lineItems.filter((l) => l.custom).length,
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
  if (!canSell(actor)) throw fail('Not authorized.', 403);
  const base = isSalesHead(actor)
    ? { salesUser: { $type: 'objectId' } }
    : { salesUser: actor._id };
  const { items, nextCursor } = await page(base, cursor);
  return { orders: items.map(shape), nextCursor, scope: isSalesHead(actor) ? 'team' : 'mine' };
}

/**
 * Every paid order the teams handle: sales-panel orders, plus every order (website
 * included) paid since the team workflow started. Accounts, Procurement, Operations,
 * the sales head — and admin, who can see everything anyway.
 */
/**
 * Fulfilment stages the paid-order list can be split by.
 *
 * Listed with `$in` rather than `{ $ne: 'delivered' }` on purpose: an inequality
 * cannot use `{ status: 1, createdAt: -1 }` as anything better than a scan,
 * and this list is short and closed (it is the Order `status` enum minus the
 * one stage it names). A status added to the model without being added here
 * would silently vanish from BOTH lists, which is why the two are asserted
 * against each other in tests.
 */
export const PAID_ORDER_STAGES = Object.freeze({
  // Everything still being worked: paid but not yet handed over.
  processing: ['awaiting_payment', 'processing', 'shipped', 'returned', 'cancelled'],
  delivered: ['delivered'],
});

export async function listPaidSalesOrders(actor, { cursor, stage } = {}) {
  const allowed = actor?.role === 'admin'
    || onTeam(actor, STAFF_TEAMS.ACCOUNTS)
    || onTeam(actor, STAFF_TEAMS.PROCUREMENT)
    || onTeam(actor, STAFF_TEAMS.OPERATIONS)
    || isSalesHead(actor);
  if (!allowed) throw fail('Not authorized.', 403);
  // No stage (or an unknown one) keeps the old behaviour: every paid order.
  const stageStatuses = PAID_ORDER_STAGES[stage];
  const { items, nextCursor } = await page(
    {
      // `refunded` stays listed so Accounts can still see an order after its refund.
      paymentStatus: { $in: ['paid', 'refunded'] },
      ...(stageStatuses ? { status: { $in: stageStatuses } } : {}),
      $or: [
        { salesUser: { $type: 'objectId' } },              // staff_sales_by_payment
        { 'workflow.enteredAt': { $type: 'date' } },       // team_workflow_paid
      ],
    },
    cursor,
    { includePayment: true },
  );
  return { orders: items.map(shape), nextCursor };
}

/**
 * One sales order, for "New order for this customer": the seller sees their own,
 * a sales head any sales-panel order. Same scope as listSalesOrders.
 */
export async function getSalesOrder(actor, orderId) {
  if (!canSell(actor)) throw fail('Not authorized.', 403);
  const order = await orderRepository.findById(orderId, [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name' },
  ]);
  if (!order || !order.salesUser) throw fail('Order not found.', 404);
  if (!isSalesHead(actor) && String(order.salesUser._id ?? order.salesUser) !== String(actor._id)) {
    throw fail('Order not found.', 404);
  }
  return shape(order);
}

/** Load an unpaid sales order the actor may act on. */
async function loadOwnUnpaid(actor, orderId) {
  if (!canSell(actor)) throw fail('Not authorized.', 403);
  const order = await orderRepository.findById(orderId);
  if (!order || !order.salesUser) throw fail('Order not found.', 404);
  if (!isSalesHead(actor) && String(order.salesUser) !== String(actor._id)) {
    throw fail('You can only manage your own orders.', 403);
  }
  if (order.paymentStatus === 'paid' || order.status !== 'awaiting_payment') {
    throw fail('This order is already paid or closed.', 409);
  }
  // The customer may already have paid by bank transfer: no second link, no cancel.
  if (order.bankTransferPendingAt) throw fail(BANK_TRANSFER_WAITING, 409);
  return order;
}

/**
 * Make sure the order's current link can no longer be paid. An expired link is
 * already dead; a live one is cancelled at Razorpay. If Razorpay refuses (most
 * likely because the customer has just paid), stop — never issue a second link
 * or cancel an order whose money may already be taken.
 */
export async function retireCurrentLink(order) {
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
    // Never an internal (phone-only) address — that link goes by SMS only.
    email: publicEmail(populated.user?.email || order.guestEmail) || undefined,
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
  // A part-paid order is refused there (money taken); waiting parts are cancelled.
  if ((order.paymentParts || []).length) await retireAllParts(order);
  else await retireCurrentLink(order);
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
