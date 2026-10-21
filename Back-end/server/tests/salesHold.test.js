/**
 * "On hold — customer thinking" (utils/salesHold.js) on GTM quotations and unpaid
 * sales orders. Header and doubles copied from salesQuotations.test.js.
 *
 * What must hold:
 *   - a hold changes nothing about price, status or payment links
 *   - a held record leaves the active list and appears under "on hold" until its
 *     follow-up date, then returns to the active list marked due
 *   - resume brings it back at once; only the seller (or GTM head) can hold/resume
 *   - a paid order cannot be put on hold, and a payment while on hold still counts
 *
 * Original header:
 * GTM quotation-first selling (services/salesQuotationService.js +
 * services/salesPaymentService.js), against a real in-memory Mongo. Razorpay is a
 * double that records links; the webhook side is covered in salesPaymentParts.
 *
 * What must hold:
 *   - a quotation is NOT an order: nothing in Orders, no link, until accepted
 *   - edits re-price and bump the version, keeping the old lines
 *   - accept re-checks the catalogue and creates exactly ONE order, no link
 *   - payment parts must add up exactly to the order total; a refused part
 *     rolls back every link made in that batch
 *   - sellers act on their own; the GTM head on all; others not at all
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

const rz = { created: [], cancelled: [], failOnAmountOver: null, failCancel: false, seq: 0 };
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async (order, customer, opts = {}) => {
      const amount = opts.part ? opts.part.amount : order.totalAmount;
      if (rz.failOnAmountOver != null && amount > rz.failOnAmountOver) {
        throw new Error('Failed to create payment link: amount exceeds maximum amount allowed.');
      }
      rz.seq += 1;
      const link = { id: `plink_${rz.seq}`, shortUrl: `https://rzp.io/i/l${rz.seq}` };
      rz.created.push({ order, customer, opts, link, amount });
      return link;
    },
    cancelPaymentLink: async (id) => {
      if (rz.failCancel) throw new Error('Failed to cancel payment link: paid');
      rz.cancelled.push(id);
      return { id, status: 'cancelled' };
    },
    fetchPaymentLinkStatus: async () => ({ status: 'created' }),
  },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const quotes = await import('../services/salesQuotationService.js');
const payments = await import('../services/salesPaymentService.js');
const sales = await import('../services/salesOrderService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const makeStaff = (team, { isHead = false, name } = {}) => {
  n += 1;
  return User.create({
    name: name || `${team} ${n}`, email: `${team}${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team, isHead, active: true },
  });
};
const makeProduct = (over = {}) => {
  n += 1;
  return Product.create({ name: `Seat Cover ${n}`, slug: `seat-cover-q${n}`, sku: `SKUQ-${n}`, description: 'x'.repeat(30), price: 5000, stock: 'in', isActive: true, ...over });
};
const CUSTOMER = { name: 'Big Build', email: 'bigbuild@example.com', phone: '9820917286' };
const ADDRESS = { addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' };
const quoteInput = (items, extra = {}) => ({ customer: CUSTOMER, shippingAddress: ADDRESS, items, ...extra });

beforeEach(() => {
  enqueued.length = 0;
  rz.created.length = 0;
  rz.cancelled.length = 0;
  rz.failOnAmountOver = null;
  rz.failCancel = false;
});


const { cleanFollowUp } = await import('../utils/salesHold.js');
const DAY = 86400000;
const ymd = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
const custom = (price = 500) => [{ custom: true, name: 'Labour', quantity: 1, price }];

describe('the follow-up date', () => {
  it('defaults to 3 days ahead, allows today, refuses the past and > 60 days', () => {
    const now = Date.UTC(2026, 9, 21, 6, 0); // 11:30 IST
    expect(cleanFollowUp('', now).toISOString()).toBe('2026-10-23T18:30:00.000Z'); // 24 Oct 00:00 IST
    expect(cleanFollowUp('2026-10-21', now).toISOString()).toBe('2026-10-20T18:30:00.000Z');
    expect(() => cleanFollowUp('2026-10-20', now)).toThrow(/past/);
    expect(() => cleanFollowUp('2026-12-25', now)).toThrow(/within 60 days/);
    expect(() => cleanFollowUp('2026-02-30', now)).toThrow(/follow-up date/);
  });
});

describe('quotation on hold', () => {
  it('leaves the open list, shows under on hold, and nothing else changes', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, quoteInput(custom(1200)), req);
    const held = await quotes.holdQuotation(rep, q.id, { until: ymd(Date.now() + 5 * DAY), note: 'Asking his brother' }, req);

    expect(held).toMatchObject({ status: 'open', totalAmount: 1200, version: 1 });
    expect(held.hold).toMatchObject({ note: 'Asking his brother', due: false });
    expect((await quotes.listQuotations(rep, { status: 'open' })).quotations).toHaveLength(0);
    expect((await quotes.listQuotations(rep, { status: 'on_hold' })).quotations.map((x) => x.id)).toEqual([q.id]);
    expect((await quotes.listQuotations(rep)).quotations.map((x) => x.id)).toEqual([q.id]); // "all" still shows it
  });

  it('comes back to the open list, marked due, once the follow-up date arrives', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, quoteInput(custom()), req);
    await quotes.holdQuotation(rep, q.id, {}, req);
    await SalesQuotation.updateOne({ _id: q.id }, { $set: { 'hold.until': new Date(Date.now() - 1000) } });
    const open = (await quotes.listQuotations(rep, { status: 'open' })).quotations;
    expect(open.map((x) => x.id)).toEqual([q.id]);
    expect(open[0].hold).toMatchObject({ due: true });
    expect((await quotes.listQuotations(rep, { status: 'on_hold' })).quotations).toHaveLength(0);
  });

  it('resume brings it straight back; accepting while on hold still works', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, quoteInput(custom()), req);
    await quotes.holdQuotation(rep, q.id, {}, req);
    const resumed = await quotes.resumeQuotation(rep, q.id, req);
    expect(resumed.hold).toBeNull();
    expect((await quotes.listQuotations(rep, { status: 'open' })).quotations.map((x) => x.id)).toEqual([q.id]);

    await quotes.holdQuotation(rep, q.id, {}, req);
    const { quotation, orderId } = await quotes.acceptQuotation(rep, q.id, req);
    expect(quotation.status).toBe('accepted');
    expect(quotation.hold).toBeNull();
    expect(orderId).toBeTruthy();
  });

  it('only the seller or the GTM head can hold; not a cancelled quotation', async () => {
    const a = await makeStaff('sales');
    const b = await makeStaff('sales');
    const head = await makeStaff('sales', { isHead: true });
    const q = await quotes.createQuotation(a, quoteInput(custom()), req);
    await expect(quotes.holdQuotation(b, q.id, {}, req)).rejects.toMatchObject({ statusCode: 404 });
    expect((await quotes.holdQuotation(head, q.id, {}, req)).hold).not.toBeNull();
    await quotes.cancelQuotation(a, q.id, req);
    await expect(quotes.holdQuotation(a, q.id, {}, req)).rejects.toThrow(/already cancelled/);
  });
});

describe('unpaid sales order on hold', () => {
  const orderFor = async (rep) => {
    const q = await quotes.createQuotation(rep, quoteInput(custom(2500)), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    return orderId;
  };

  it('leaves the active list without touching price, status or links', async () => {
    const rep = await makeStaff('sales');
    const orderId = await orderFor(rep);
    await payments.requestPayment(rep, orderId, [2500], req);
    const before = await Order.findById(orderId).lean();

    const held = await sales.holdSalesOrder(rep, orderId, { note: 'Thinking till Monday' }, req);
    expect(held.hold).toMatchObject({ note: 'Thinking till Monday', due: false });

    const after = await Order.findById(orderId).lean();
    expect(after.status).toBe('awaiting_payment');
    expect(after.paymentStatus).toBe('pending');
    expect(after.totalAmount).toBe(before.totalAmount);
    expect(after.paymentParts.map((p) => p.status)).toEqual(before.paymentParts.map((p) => p.status));
    expect(rz.cancelled).toHaveLength(0);

    expect((await sales.listSalesOrders(rep)).orders).toHaveLength(0);
    expect((await sales.listSalesOrders(rep, { view: 'on_hold' })).orders.map((o) => o.id)).toEqual([orderId]);
  });

  it('resume returns it; a due hold is back in the active list', async () => {
    const rep = await makeStaff('sales');
    const orderId = await orderFor(rep);
    await sales.holdSalesOrder(rep, orderId, {}, req);
    expect((await sales.resumeSalesOrder(rep, orderId, req)).hold).toBeNull();
    expect((await sales.listSalesOrders(rep)).orders.map((o) => o.id)).toEqual([orderId]);

    await sales.holdSalesOrder(rep, orderId, {}, req);
    await Order.updateOne({ _id: orderId }, { $set: { 'salesHold.until': new Date(Date.now() - 1000) } });
    const active = (await sales.listSalesOrders(rep)).orders;
    expect(active.map((o) => o.id)).toEqual([orderId]);
    expect(active[0].hold).toMatchObject({ due: true });
  });

  it('a paid order cannot be held, and one paid while on hold shows as active', async () => {
    const rep = await makeStaff('sales');
    const orderId = await orderFor(rep);
    await sales.holdSalesOrder(rep, orderId, {}, req);
    await Order.updateOne({ _id: orderId }, { $set: { paymentStatus: 'paid', status: 'processing' } });

    const active = (await sales.listSalesOrders(rep)).orders;
    expect(active.map((o) => o.id)).toEqual([orderId]);
    expect(active[0].hold).toBeNull();
    expect((await sales.listSalesOrders(rep, { view: 'on_hold' })).orders).toHaveLength(0);
    await expect(sales.holdSalesOrder(rep, orderId, {}, req)).rejects.toThrow(/already paid or closed/);
  });

  it('cannot be held while a bank transfer waits for accounts', async () => {
    const rep = await makeStaff('sales');
    const orderId = await orderFor(rep);
    await Order.updateOne({ _id: orderId }, { $set: { bankTransferPendingAt: new Date() } });
    await expect(sales.holdSalesOrder(rep, orderId, {}, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('another seller cannot hold it; other teams cannot either', async () => {
    const a = await makeStaff('sales');
    const b = await makeStaff('sales');
    const ops = await makeStaff('operations');
    const orderId = await orderFor(a);
    await expect(sales.holdSalesOrder(b, orderId, {}, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(sales.holdSalesOrder(ops, orderId, {}, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(sales.resumeSalesOrder(b, orderId, req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
