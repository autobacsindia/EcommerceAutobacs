/** The Admin's whole-order answer: money sums, the plain timeline, permissions, and that it stays read-only. */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: OrderExtraCharge } = await import('../models/OrderExtraCharge.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const csrfFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='))?.split(';')[0].split('=')[1] || '';
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}
let n = 0;
const make = async (role, staff) => {
  n += 1;
  const email = `u${n}@autobacs.test`;
  const user = await User.create({ name: `U${n}`, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const key = () => new mongoose.Types.ObjectId().toString();


const { moneySummary } = await import('../services/orderOverviewService.js');
const { buildOrderTimeline, MAX_TIMELINE, timelineUserIds } = await import('../utils/orderTimeline.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');

const ORDER = (over = {}) => ({ totalAmount: 29000, paymentStatus: 'paid', status: 'processing', paidAt: new Date(), ...over });
const paidExtra = (over = {}) => ({ amount: 5000, status: 'paid', gatewayPaymentId: 'pay_x', ...over });

describe('moneySummary', () => {
  it('the worked example: order, extra, supplier', () => {
    const m = moneySummary({ order: ORDER(), extras: [paidExtra()], requests: [{ kind: 'supplier', status: 'paid', amount: 22000 }] });
    expect(m).toMatchObject({ orderTotal: 29000, extrasPaid: 5000, totalWithExtras: 34000, received: 34000, refunded: 0, toCollect: 0, supplierPaid: 22000, leftAfterSupplier: 12000 });
  });
  it('an unpaid order: nothing received, all to collect; a waiting extra is added', () => {
    const m = moneySummary({ order: ORDER({ paymentStatus: 'pending', status: 'awaiting_payment', paidAt: undefined }), extras: [{ amount: 500, status: 'approved' }] });
    expect(m).toMatchObject({ received: 0, toCollect: 29500, extrasWaiting: 500 });
  });
  it('part-paid: counts only the paid parts', () => {
    const m = moneySummary({ order: ORDER({ paymentStatus: 'pending', paidAt: undefined, paymentParts: [{ amount: 10000, status: 'paid' }, { amount: 19000, status: 'pending' }] }) });
    expect(m).toMatchObject({ received: 10000, toCollect: 19000 });
  });
  it('a cancelled unpaid order has nothing to collect', () => {
    expect(moneySummary({ order: ORDER({ paymentStatus: 'cancelled', status: 'cancelled', paidAt: undefined }) }).toCollect).toBe(0);
  });
  it('received is what the gateway holds, after a Razorpay offer', () => {
    expect(moneySummary({ order: ORDER({ gatewayOffer: { discount: 1000 } }) }).received).toBe(28000);
  });
  it('does not count a return twice through its copy on the order', () => {
    const order = ORDER({ refundDetails: { status: 'completed', amount: 3000, notes: 'Return abc' } });
    expect(moneySummary({ order, returns: [{ refund: { status: 'completed', finalAmount: 3000 } }] }).refunded).toBe(3000);
  });
  it('adds cancellations (paise), whole-order refunds and refunded extras', () => {
    const order = ORDER({ cancellations: [{ refund: { status: 'completed', amountPaise: 150000 } }], refundDetails: { status: 'completed', amount: 500 } });
    const m = moneySummary({ order, extras: [paidExtra({ refund: { status: 'completed' } })] });
    expect(m.refunded).toBe(7000);
  });
  it('money still on its way back is not called refunded', () => {
    const m = moneySummary({ order: ORDER({ cancellations: [{ refund: { status: 'processing', amountPaise: 100000 } }] }) });
    expect(m).toMatchObject({ refunded: 0, refundInProgress: 1000 });
  });
  it("an extra's own gateway refund is not counted again as an order refund", () => {
    const m = moneySummary({ order: ORDER(), extras: [paidExtra({ refund: { status: 'completed' } })], payments: [{ gatewayPaymentId: 'pay_x', refundAmount: 5000 }] });
    expect(m.refunded).toBe(5000);
  });
  it('supplier: credit counts toward the cost; waiting, declined and foreign rows are apart', () => {
    const m = moneySummary({ order: ORDER(), requests: [
      { kind: 'supplier', status: 'paid', amount: 1000, credit: { amount: 200 } },
      { kind: 'supplier', status: 'approved', amount: 300 },
      { kind: 'supplier', status: 'declined', amount: 999 },
      { kind: 'supplier', status: 'paid', amount: 0, currency: 'THB', foreignAmount: 5000 },
      { kind: 'expense', status: 'paid', amount: 50 },
    ] });
    expect(m).toMatchObject({ supplierPaid: 1200, supplierWaiting: 300, supplierNotPriced: 1, expenses: 50 });
  });
  it('sums paise exactly', () => {
    expect(moneySummary({ order: ORDER({ totalAmount: 0.1 }), extras: [paidExtra({ amount: 0.2 })] }).received).toBe(0.3);
  });
});

describe('buildOrderTimeline', () => {
  const at = (d) => new Date(`2026-11-0${d}T10:00:00.000Z`);
  it('tells the story oldest first, with the person', () => {
    const t = buildOrderTimeline({
      order: { createdAt: at(1), salesUser: 'u1', statusHistory: [{ status: 'shipped', timestamp: at(3), updatedBy: 'u2' }], paidAt: at(2), totalAmount: 100 },
      extras: [{ amount: 50, history: [{ at: at(4), byName: 'Asha', action: 'requested' }] }],
      nameOf: (u) => ({ u1: 'Sam', u2: 'Ravi' }[u]),
    });
    expect(t.map((e) => e.what)).toEqual(['Order placed', 'Payment received: ₹100', 'Order status: Shipped', 'Extra charge asked for (₹50)']);
    expect(t[0].who).toBe('Sam');
    expect(t[2].who).toBe('Ravi');
  });
  it('never shows a raw code: unknown actions read as words', () => {
    const t = buildOrderTimeline({ order: { workflow: { history: [{ at: at(1), action: 'some_new_step' }] } } });
    expect(t[0].what).toBe('Some new step');
  });
  it('a web order is placed by the customer', () => {
    expect(buildOrderTimeline({ order: { createdAt: at(1) } })[0].who).toBe('Customer');
  });
  it('skips records with no date instead of crashing', () => {
    expect(buildOrderTimeline({ order: { statusHistory: [{ status: 'shipped' }], cancellations: [{ sequence: 1, refund: { status: 'completed' } }] } })).toEqual([]);
  });
  it('does not repeat parcels when the team log already covers them', () => {
    const shipments = [{ sequence: 1, shippedAt: at(2) }];
    expect(buildOrderTimeline({ order: { shipments } }).map((e) => e.what)).toEqual(['Parcel 1 shipped']);
    expect(buildOrderTimeline({ order: { shipments, workflow: { history: [{ at: at(2), action: 'shipped' }] } }, workflowLabels: { shipped: 'Shipped by team' } }).map((e) => e.what)).toEqual(['Shipped by team']);
  });
  it('a return copied onto the order is not a second refund line', () => {
    expect(buildOrderTimeline({ order: { refundDetails: { status: 'completed', amount: 5, notes: 'Return x', processedAt: at(1) } } })).toEqual([]);
  });
  it('is bounded, keeping the newest', () => {
    const statusHistory = Array.from({ length: MAX_TIMELINE + 20 }, (_, i) => ({ status: 'processing', timestamp: new Date(1e12 + i * 1000) }));
    const t = buildOrderTimeline({ order: { statusHistory } });
    expect(t).toHaveLength(MAX_TIMELINE);
    expect(t.at(-1).at).toBe(new Date(1e12 + (MAX_TIMELINE + 19) * 1000).toISOString());
  });
  it('asks for each person once', () => {
    expect(timelineUserIds({ salesUser: 'a', statusHistory: [{ updatedBy: 'a' }, { updatedBy: 'b' }, {}] })).toEqual(['a', 'b']);
  });
});

describe('GET /orders/:id/overview', () => {
  beforeAll(async () => { await dbHandler.connect(); await OrderExtraCharge.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(() => dbHandler.clearDatabase());

  const SHIP = { fullName: 'Asha Buyer', phone: '9', addressLine1: '1', city: 'K', state: 'KL', postalCode: '682001' };
  const newOrder = (user, over = {}) => Order.create({
    user, source: 'offline', items: [{ custom: true, name: 'Kit', price: 29000, quantity: 1 }], subtotal: 29000, totalAmount: 29000,
    shippingAddress: SHIP, status: 'processing', paymentStatus: 'paid', paidAt: new Date(), ...over,
  });

  it('401 without login; 403 for a customer and for staff; 404 for no such order', async () => {
    const admin = await make('admin');
    const customer = await make('customer');
    const staff = await make('staff', { team: 'accounts', isHead: false, active: true });
    const order = await newOrder(customer.user._id);
    expect((await request(app).get(`${BASE}/orders/${order._id}/overview`)).status).toBe(401);
    expect((await customer.session.get(`/orders/${order._id}/overview`)).status).toBe(403);
    expect((await staff.session.get(`/orders/${order._id}/overview`)).status).toBe(403);
    expect((await admin.session.get(`/orders/${key()}/overview`)).status).toBe(404);
  });

  it('brings the extra, the supplier payment and the timeline together', async () => {
    const admin = await make('admin');
    const customer = await make('customer');
    const order = await newOrder(customer.user._id);
    await OrderExtraCharge.create({
      order: order._id, orderNumber: order.orderNumber, user: customer.user._id, sequence: 1, clientKey: key(), amount: 5000, reason: 'Larger screen',
      customerConfirmed: true, status: 'paid', gatewayPaymentId: 'pay_1', paidAt: new Date(), requestedBy: admin.user._id, requestedByName: 'Asha',
      history: [{ at: new Date(), by: admin.user._id, byName: 'Asha', action: 'paid' }],
    });
    await PaymentRequest.create({
      number: 'PR-0001', kind: 'supplier', status: 'paid', team: 'procurement', requestedBy: admin.user._id, requestedByName: 'Ravi', amount: 22000, category: 'supplier',
      payee: { name: 'Acme', method: 'upi', upiId: 'a@b' }, order: order._id, payment: { method: 'upi', paidAt: new Date(), paidByName: 'Owner' },
    });
    const before = await Order.findById(order._id).lean();
    const res = await admin.session.get(`/orders/${order._id}/overview`);
    expect(res.status).toBe(200);
    const o = res.body.overview;
    expect(o.money).toMatchObject({ totalWithExtras: 34000, received: 34000, supplierPaid: 22000, leftAfterSupplier: 12000, toCollect: 0 });
    expect(o.extras[0]).toMatchObject({ reason: 'Larger screen', statusLabel: 'Paid' });
    expect(o.supplierPayments[0]).toMatchObject({ number: 'PR-0001', payee: 'Acme', statusLabel: expect.any(String) });
    expect(JSON.stringify(o.supplierPayments)).not.toContain('a@b'); // payee bank details stay out
    expect(o.timeline.map((e) => e.what)).toEqual(expect.arrayContaining(['Order placed', 'Extra charge paid (₹5,000)', 'Supplier payment PR-0001 paid to Acme']));
    expect(await Order.findById(order._id).lean()).toEqual(before); // read-only
  });

  it('reads the same number of times however many records the order has', async () => {
    const admin = await make('admin');
    const customer = await make('customer');
    const reads = async (orderId) => {
      let n = 0;
      mongoose.set('debug', () => { n += 1; });
      const res = await admin.session.get(`/orders/${orderId}/overview`);
      mongoose.set('debug', false);
      expect(res.status).toBe(200);
      return n;
    };
    const small = await newOrder(customer.user._id);
    const big = await newOrder(customer.user._id, {
      statusHistory: Array.from({ length: 30 }, () => ({ status: 'processing', updatedBy: admin.user._id })),
    });
    await OrderExtraCharge.insertMany(Array.from({ length: 30 }, (_, i) => ({
      order: big._id, orderNumber: big.orderNumber, user: customer.user._id, sequence: i + 1, clientKey: `k${i}`, amount: 100, reason: 'Larger screen',
      customerConfirmed: true, status: 'paid', paidAt: new Date(), requestedBy: admin.user._id, requestedByName: 'A',
    })));
    expect(await reads(big._id)).toBe(await reads(small._id));
  });

  it('does not break when the customer account no longer exists', async () => {
    const admin = await make('admin');
    const order = await newOrder(new mongoose.Types.ObjectId());
    const res = await admin.session.get(`/orders/${order._id}/overview`);
    expect(res.status).toBe(200);
    expect(res.body.overview.customer).toEqual({ name: 'Asha Buyer', accountDeleted: true });
  });
});
