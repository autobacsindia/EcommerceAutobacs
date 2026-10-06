/**
 * Sales panel — orders a sales member raises for a customer who called or
 * WhatsApped (services/salesOrderService.js), against a real in-memory Mongo.
 *
 * What must hold:
 *   - the server prices every line; an offer can only go DOWN (₹1 … list price)
 *   - only sales staff create; members see their own, the head sees the team's
 *   - accounts / procurement read paid sales orders and nothing else
 *   - a new link is issued only after the old one is retired, never two payable
 *   - an unpaid order can be cancelled; a paid one cannot
 *   - the abandoned-checkout sweep leaves sales orders alone
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

// Plain functions (not jest.fn): the suite's resetMocks would wipe implementations.
const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

// Razorpay double: records links made / cancelled; behaviour switchable per test.
const rz = { created: [], cancelled: [], failCancel: false, remoteStatus: 'created', seq: 0 };
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async (order, customer, opts = {}) => {
      rz.seq += 1;
      const link = { id: `plink_${rz.seq}`, shortUrl: `https://rzp.io/i/l${rz.seq}` };
      rz.created.push({ order, customer, opts, link });
      return link;
    },
    cancelPaymentLink: async (id) => {
      if (rz.failCancel) throw new Error('Failed to cancel payment link: paid');
      rz.cancelled.push(id);
      return { id, status: 'cancelled' };
    },
    fetchPaymentLinkStatus: async () => ({ status: rz.remoteStatus }),
  },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: SalesRep } = await import('../models/SalesRep.js');
const svc = await import('../services/salesOrderService.js');
const { sweepAbandonedOrders } = await import('../services/leadSweepService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

let n = 0;
async function makeStaff(team, { isHead = false, active = true, name } = {}) {
  n += 1;
  return User.create({
    name: name || `${team} person ${n}`,
    email: `${team}${n}@autobacs.test`,
    phone: '9000000001',
    passwordHash: 'x',
    role: 'staff',
    staff: { team, isHead, active },
  });
}

async function makeProduct(overrides = {}) {
  n += 1;
  return Product.create({
    name: `Seat Cover ${n}`, slug: `seat-cover-${n}`, sku: `SKU-${n}`,
    description: 'x'.repeat(30), price: 5000, stock: 'in', isActive: true,
    ...overrides,
  });
}

const CUSTOMER = { name: 'Call In Customer', email: 'caller@example.com', phone: '9812345678' };
const ADDRESS = { addressLine1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' };

const orderInput = (product, extra = {}) => ({
  customer: CUSTOMER,
  shippingAddress: ADDRESS,
  items: [{ product: String(product._id), quantity: 2, ...extra }],
});

beforeEach(() => {
  enqueued.length = 0;
  rz.created.length = 0;
  rz.cancelled.length = 0;
  rz.failCancel = false;
  rz.remoteStatus = 'created';
  rz.seq = 0;
});

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

describe('creating a sales order', () => {
  it('prices from the catalogue, applies the offer and sends a payment link', async () => {
    const rep = await makeStaff('sales', { name: 'Asha' });
    const product = await makeProduct();

    const result = await svc.createSalesOrder(rep, orderInput(product, { offerPrice: 4500 }), req);

    expect(result.paymentLink).toEqual({ id: 'plink_1', shortUrl: 'https://rzp.io/i/l1' });
    expect(result.order.totalAmount).toBe(9000);
    expect(result.order.items[0]).toMatchObject({ price: 4500, listPrice: 5000, quantity: 2 });
    expect(result.order.salesPerson).toBe('Asha');
    expect(result.order.linkState).toBe('active');
    expect(result.customerIsNew).toBe(true);

    const saved = await Order.findById(result.order.id).lean();
    expect(String(saved.salesUser)).toBe(String(rep._id));
    expect(saved.status).toBe('awaiting_payment');
    expect(saved.paymentLinkExpiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);
    // The rep is credited through a SalesRep linked to their account.
    const salesRep = await SalesRep.findById(saved.salesRep).lean();
    expect(String(salesRep.user)).toBe(String(rep._id));
    // The link carries the customer's details.
    expect(rz.created[0].customer).toMatchObject({ email: CUSTOMER.email, phone: CUSTOMER.phone });
  });

  it('charges the full price when no offer is given', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    expect(order.totalAmount).toBe(10000);
    expect(order.items[0].listPrice).toBeNull();
  });

  it('refuses an offer above the catalogue price', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    await expect(svc.createSalesOrder(rep, orderInput(product, { offerPrice: 5001 }), req))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(await Order.countDocuments()).toBe(0);
    expect(rz.created).toHaveLength(0);
  });

  it('refuses a ₹0 offer', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    await expect(svc.createSalesOrder(rep, orderInput(product, { offerPrice: 0 }), req))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('ignores a product name or price sent by the browser', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct({ name: 'Real Name' });
    const input = orderInput(product, { name: 'Free Gold', price: 1 });
    const { order } = await svc.createSalesOrder(rep, input, req);
    expect(order.items[0]).toMatchObject({ name: 'Real Name', price: 5000 });
  });

  it('refuses an out-of-stock product', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct({ stock: 'out' });
    await expect(svc.createSalesOrder(rep, orderInput(product), req)).rejects.toThrow(/out of stock/);
  });

  it('only lets active sales staff create orders', async () => {
    const product = await makeProduct();
    const accounts = await makeStaff('accounts');
    const procurement = await makeStaff('procurement');
    const inactive = await makeStaff('sales', { active: false });
    const customer = await User.create({ name: 'Cust', email: 'c@x.com', phone: '9812345670', passwordHash: 'x' });
    for (const actor of [accounts, procurement, inactive, customer, null]) {
      await expect(svc.createSalesOrder(actor, orderInput(product), req)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
});

describe('who sees which orders', () => {
  it('a member sees only their own; the head sees the whole team', async () => {
    const a = await makeStaff('sales');
    const b = await makeStaff('sales');
    const head = await makeStaff('sales', { isHead: true });
    const product = await makeProduct();
    await svc.createSalesOrder(a, orderInput(product), req);
    await svc.createSalesOrder(b, orderInput(product), req);
    // A website order is never in the sales panel.
    await Order.create({
      user: new mongoose.Types.ObjectId(), source: 'web',
      items: [{ product: product._id, quantity: 1, price: 5000, name: 'x' }],
      shippingAddress: { fullName: 'W', phone: '9812345671', ...ADDRESS, country: 'India' },
      subtotal: 5000, totalAmount: 5000, status: 'awaiting_payment',
    });

    expect((await svc.listSalesOrders(a)).orders).toHaveLength(1);
    expect((await svc.listSalesOrders(b)).orders).toHaveLength(1);
    const team = await svc.listSalesOrders(head);
    expect(team.orders).toHaveLength(2);
    expect(team.scope).toBe('team');
  });

  it('paid sales orders are visible to accounts, procurement and the sales head only', async () => {
    const rep = await makeStaff('sales');
    const head = await makeStaff('sales', { isHead: true });
    const accounts = await makeStaff('accounts');
    const procurement = await makeStaff('procurement');
    const marketing = await makeStaff('marketing');
    const product = await makeProduct();
    const { order: paid } = await svc.createSalesOrder(rep, orderInput(product), req);
    await svc.createSalesOrder(rep, orderInput(product), req); // stays unpaid
    await Order.updateOne({ _id: paid.id }, { $set: { paymentStatus: 'paid', status: 'processing' } });

    for (const actor of [accounts, procurement, head]) {
      const { orders } = await svc.listPaidSalesOrders(actor);
      expect(orders.map((o) => o.id)).toEqual([paid.id]);
    }
    for (const actor of [rep, marketing]) {
      await expect(svc.listPaidSalesOrders(actor)).rejects.toMatchObject({ statusCode: 403 });
    }
    // Accounts can read but cannot create.
    await expect(svc.listSalesOrders(accounts)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('pages with a cursor', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    const base = (await Order.findById(order.id).lean());
    delete base._id;
    const docs = Array.from({ length: 27 }, (_, i) => ({
      ...base, orderNumber: undefined, createdAt: new Date(Date.now() - (i + 1) * 60000),
    }));
    await Order.collection.insertMany(docs);

    const first = await svc.listSalesOrders(rep);
    expect(first.orders).toHaveLength(25);
    const second = await svc.listSalesOrders(rep, { cursor: first.nextCursor });
    expect(second.orders).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.orders, ...second.orders].map((o) => o.id));
    expect(ids.size).toBe(28);
  });
});

describe('payment links', () => {
  it('a new link cancels the live one first', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);

    const { paymentLink, order: after } = await svc.reissuePaymentLink(rep, order.id, req);

    expect(rz.cancelled).toEqual(['plink_1']);
    expect(paymentLink.id).toBe('plink_2');
    expect(rz.created[1].opts).toEqual({ attempt: 2 });
    expect(after.paymentLinkUrl).toBe('https://rzp.io/i/l2');
  });

  it('an expired link is not cancelled, just replaced', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    await Order.updateOne({ _id: order.id }, { $set: { paymentLinkExpiresAt: new Date(Date.now() - 1000) } });
    expect((await svc.listSalesOrders(rep)).orders[0]).toMatchObject({ linkState: 'expired', paymentLinkUrl: null });

    await svc.reissuePaymentLink(rep, order.id, req);
    expect(rz.cancelled).toEqual([]);
    expect(rz.created).toHaveLength(2);
  });

  it('stops if the live link cannot be cancelled (customer may have paid)', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    rz.failCancel = true;
    rz.remoteStatus = 'paid';
    await expect(svc.reissuePaymentLink(rep, order.id, req)).rejects.toMatchObject({ statusCode: 409 });
    expect(rz.created).toHaveLength(1);
  });

  it('goes ahead when Razorpay says the old link is already cancelled', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    rz.failCancel = true;
    rz.remoteStatus = 'cancelled';
    await svc.reissuePaymentLink(rep, order.id, req);
    expect(rz.created).toHaveLength(2);
  });

  it('refuses a new link for a paid order, or for someone else’s order', async () => {
    const rep = await makeStaff('sales');
    const other = await makeStaff('sales');
    const head = await makeStaff('sales', { isHead: true });
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);

    await expect(svc.reissuePaymentLink(other, order.id, req)).rejects.toMatchObject({ statusCode: 403 });
    await svc.reissuePaymentLink(head, order.id, req); // the head may

    await Order.updateOne({ _id: order.id }, { $set: { paymentStatus: 'paid', status: 'processing' } });
    await expect(svc.reissuePaymentLink(rep, order.id, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('cancelling', () => {
  it('cancels an unpaid order and its live link', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);

    const cancelled = await svc.cancelUnpaidSalesOrder(rep, order.id, req);
    expect(cancelled.status).toBe('cancelled');
    expect(rz.cancelled).toEqual(['plink_1']);
  });

  it('will not cancel a paid order', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    await Order.updateOne({ _id: order.id }, { $set: { paymentStatus: 'paid', status: 'processing' } });
    await expect(svc.cancelUnpaidSalesOrder(rep, order.id, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('abandoned-checkout sweep', () => {
  it('leaves sales orders alone', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    await Order.updateOne({ _id: order.id }, { $set: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });

    await sweepAbandonedOrders();

    const after = await Order.findById(order.id).lean();
    expect(after.paymentStatus).toBe('pending');
  });
});
