/**
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

describe('creating a quotation', () => {
  it('prices the lines like an order, but creates no order and no link', async () => {
    const rep = await makeStaff('sales', { name: 'Asha' });
    const product = await makeProduct();
    const q = await quotes.createQuotation(rep, quoteInput([
      { product: String(product._id), quantity: 2, offerPrice: 4500 },
      { custom: true, name: 'Lift kit', quantity: 1, price: 750000 },
    ]), req);

    expect(q).toMatchObject({ status: 'open', version: 1, totalAmount: 9000 + 750000 });
    expect(q.number).toMatch(/^QT-[0-9A-F]{8}$/);
    expect(q.items.map((i) => [i.name, i.price, i.custom])).toEqual([[product.name, 4500, false], ['Lift kit', 750000, true]]);
    expect(new Date(q.validUntil).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(await Order.countDocuments({})).toBe(0);
    expect(rz.created).toHaveLength(0);
  });

  it('refuses an offer above the catalogue price, as an order would', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    await expect(quotes.createQuotation(rep, quoteInput([{ product: String(product._id), quantity: 1, offerPrice: 9999 }]), req))
      .rejects.toThrow(/can't be higher/);
  });

  it('GTM executives / other teams cannot create one', async () => {
    const ops = await makeStaff('operations');
    await expect(quotes.createQuotation(ops, quoteInput([{ custom: true, name: 'X item', quantity: 1, price: 10 }]), req))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('editing, cancelling, reading', () => {
  it('an edit re-prices, bumps the version and keeps the previous lines', async () => {
    const rep = await makeStaff('sales');
    const q1 = await quotes.createQuotation(rep, quoteInput([{ custom: true, name: 'Labour', quantity: 1, price: 1000 }]), req);
    const q2 = await quotes.updateQuotation(rep, q1.id, quoteInput([{ custom: true, name: 'Labour', quantity: 2, price: 900 }]), req);
    expect(q2).toMatchObject({ version: 2, totalAmount: 1800, number: `${q1.number}-v2` });
    expect(q2.revisions).toEqual([expect.objectContaining({ version: 1, totalAmount: 1000 })]);
  });

  it('a seller cannot see or edit another seller\'s quotation; the GTM head can', async () => {
    const a = await makeStaff('sales');
    const b = await makeStaff('sales');
    const head = await makeStaff('sales', { isHead: true });
    const q = await quotes.createQuotation(a, quoteInput([{ custom: true, name: 'Labour', quantity: 1, price: 500 }]), req);
    await expect(quotes.getQuotation(b, q.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await quotes.getQuotation(head, q.id)).id).toBe(q.id);
    expect((await quotes.listQuotations(b)).quotations).toHaveLength(0);
    expect((await quotes.listQuotations(head)).quotations.map((x) => x.id)).toContain(q.id);
  });

  it('a cancelled quotation cannot be edited or accepted', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, quoteInput([{ custom: true, name: 'Labour', quantity: 1, price: 500 }]), req);
    await quotes.cancelQuotation(rep, q.id, req);
    await expect(quotes.acceptQuotation(rep, q.id, req)).rejects.toThrow(/already cancelled/);
    await expect(quotes.updateQuotation(rep, q.id, quoteInput([{ custom: true, name: 'Labour', quantity: 1, price: 1 }]), req)).rejects.toThrow(/already cancelled/);
  });

  it('renders the quotation PDF', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, quoteInput([{ custom: true, name: 'Labour', quantity: 1, price: 500 }]), req);
    const { buffer, filename } = await quotes.getQuotationDocument(rep, q.id);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(filename).toBe(`Quotation-${q.number}.pdf`);
  });
});

describe('accepting', () => {
  it('creates exactly one order from the quoted lines, with no payment link', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const q = await quotes.createQuotation(rep, quoteInput([
      { product: String(product._id), quantity: 1, offerPrice: 4000 },
      { custom: true, name: 'Installation', quantity: 1, price: 2500 },
    ]), req);
    const { orderId, quotation } = await quotes.acceptQuotation(rep, q.id, req);
    expect(quotation.status).toBe('accepted');

    const order = await Order.findById(orderId).lean();
    expect(order).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending', totalAmount: 6500 });
    expect(order.paymentLinkId).toBeFalsy();
    expect(order.items.map((i) => [i.name, i.price])).toEqual([[product.name, 4000], ['Installation', 2500]]);
    expect(String(order.salesUser)).toBe(String(rep._id));
    expect(rz.created).toHaveLength(0);
    // Not a paid order yet: no invoice, no team alert.
    expect(enqueued.filter((j) => ['send-order-invoice', 'send-staff-sales-paid-alert'].includes(j.name))).toEqual([]);
    expect((await SalesQuotation.findById(q.id).lean()).order.toString()).toBe(orderId);
  });

  it('two accepts at once create one order', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, quoteInput([{ custom: true, name: 'Labour', quantity: 1, price: 500 }]), req);
    const results = await Promise.allSettled([quotes.acceptQuotation(rep, q.id, req), quotes.acceptQuotation(rep, q.id, req)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Order.countDocuments({ 'items.name': 'Labour' })).toBe(1);
  });

  it('refuses when the catalogue changed (product now out of stock) — edit first', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const q = await quotes.createQuotation(rep, quoteInput([{ product: String(product._id), quantity: 1 }]), req);
    await Product.updateOne({ _id: product._id }, { $set: { stock: 'out' } });
    await expect(quotes.acceptQuotation(rep, q.id, req)).rejects.toThrow(/catalogue changed/);
    expect((await SalesQuotation.findById(q.id).lean()).status).toBe('open');
    expect(await Order.countDocuments({})).toBe(0);
  });

  it('refuses an expired quotation', async () => {
    const rep = await makeStaff('sales');
    const q = await quotes.createQuotation(rep, quoteInput([{ custom: true, name: 'Labour', quantity: 1, price: 500 }]), req);
    await SalesQuotation.updateOne({ _id: q.id }, { $set: { validUntil: new Date(Date.now() - 1000) } });
    expect((await quotes.getQuotation(rep, q.id)).status).toBe('expired');
    await expect(quotes.acceptQuotation(rep, q.id, req)).rejects.toThrow(/expired/);
  });
});

describe('requesting payment in parts', () => {
  const acceptedOrder = async (rep, total = 3159448) => {
    const q = await quotes.createQuotation(rep, quoteInput([{ custom: true, name: 'Hilux build', quantity: 1, price: total }]), req);
    return (await quotes.acceptQuotation(rep, q.id, req)).orderId;
  };

  it('splits the total into links that add up exactly', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep);
    const summary = await payments.requestPayment(rep, orderId, [1000000, 1000000, 1000000, 159448], req);
    expect(summary.parts.map((p) => [p.amount, p.status])).toEqual([
      [1000000, 'pending'], [1000000, 'pending'], [1000000, 'pending'], [159448, 'pending'],
    ]);
    expect(summary).toMatchObject({ amountPaid: 0, amountRequested: 3159448, amountToRequest: 0 });
    expect(rz.created.map((c) => [c.amount, c.opts.part.index, c.opts.part.of])).toEqual([
      [1000000, 1, 4], [1000000, 2, 4], [1000000, 3, 4], [159448, 4, 4],
    ]);
    // Each link has its own reference.
    expect(new Set(rz.created.map((c) => c.opts.part.ref)).size).toBe(4);
  });

  it('refuses parts that do not add up to the total', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep, 10000);
    await expect(payments.requestPayment(rep, orderId, [5000, 4000], req)).rejects.toThrow(/must add up.*₹10,000/);
    await expect(payments.requestPayment(rep, orderId, [5000, 6000], req)).rejects.toThrow(/must add up/);
    expect(rz.created).toHaveLength(0);
  });

  it('a part Razorpay refuses rolls back the whole batch', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep, 1500000);
    rz.failOnAmountOver = 500000;
    await expect(payments.requestPayment(rep, orderId, [400000, 600000, 500000], req))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/more than it allows in one payment.*No links were sent/) });
    expect(rz.cancelled).toEqual(['plink_' + rz.seq]); // the one link made before the refusal
    expect((await Order.findById(orderId).lean()).paymentParts ?? []).toHaveLength(0);
  });

  it('a waiting part can be cancelled and its amount requested again', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep, 10000);
    const s1 = await payments.requestPayment(rep, orderId, [6000, 4000], req);
    const s2 = await payments.cancelPart(rep, orderId, s1.parts[1].id, req);
    expect(s2).toMatchObject({ amountRequested: 6000, amountToRequest: 4000 });
    const s3 = await payments.requestPayment(rep, orderId, [2000, 2000], req);
    expect(s3.parts.map((p) => [p.amount, p.status])).toEqual([[6000, 'pending'], [4000, 'cancelled'], [2000, 'pending'], [2000, 'pending']]);
    expect(s3.amountToRequest).toBe(0);
  });

  it('cancelling the unpaid order cancels every waiting link', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep, 10000);
    await payments.requestPayment(rep, orderId, [6000, 4000], req);
    await sales.cancelUnpaidSalesOrder(rep, orderId, req);
    expect(rz.cancelled.sort()).toEqual(['plink_' + (rz.seq - 1), 'plink_' + rz.seq].sort());
    expect((await Order.findById(orderId).lean()).status).toBe('cancelled');
  });

  it('a part-paid order cannot be cancelled from the panel', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep, 10000);
    await payments.requestPayment(rep, orderId, [6000, 4000], req);
    await Order.updateOne({ _id: orderId }, { $set: { 'paymentParts.0.status': 'paid' } });
    await expect(sales.cancelUnpaidSalesOrder(rep, orderId, req)).rejects.toThrow(/already paid/);
  });

  it('the order list shows the payment picture', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep, 10000);
    await payments.requestPayment(rep, orderId, [10000], req);
    const order = await sales.getSalesOrder(rep, orderId);
    expect(order.paymentFlow).toBe('parts');
    expect(order.linkState).toBeNull();
    expect(order.payment).toMatchObject({ amountRequested: 10000, amountToRequest: 0, parts: [expect.objectContaining({ amount: 10000, status: 'pending', url: expect.stringMatching(/^https:/) })] });
  });

  it('renders the payment request PDF', async () => {
    const rep = await makeStaff('sales');
    const orderId = await acceptedOrder(rep, 10000);
    await payments.requestPayment(rep, orderId, [6000, 4000], req);
    const { buffer, filename } = await payments.getPaymentRequestPdf(rep, orderId);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(filename).toMatch(/^Payment-request-/);
  });

  it('another seller cannot request payment on someone else\'s order', async () => {
    const a = await makeStaff('sales');
    const b = await makeStaff('sales');
    const orderId = await acceptedOrder(a, 10000);
    await expect(payments.requestPayment(b, orderId, [10000], req)).rejects.toMatchObject({ statusCode: 403 });
  });
});

it('ids are real ObjectIds (sanity)', () => {
  expect(mongoose.isValidObjectId(String(new mongoose.Types.ObjectId()))).toBe(true);
});
