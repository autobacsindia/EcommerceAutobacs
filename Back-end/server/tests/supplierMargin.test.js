/**
 * Minimum margin on supplier buys (owner, 2026-11-26).
 *
 * "When a customer orders for 1 lakh, procurement should pay 70% or less — 70,000 is
 * fine, then we get 30,000. That is our margin." Below the minimum: procurement
 * must give a reason, accounts must approve it, the admin sees every such case,
 * and an admin Margins panel shows what we make per line and per product.
 *
 * What must hold:
 *   - margin = (customer's price incl. GST, after coupon − supplier bill incl. GST) ÷ customer's price
 *   - exactly the minimum passes; one rupee more on the bill does not
 *   - worked out on the SERVER from the order and every live supplier payment on the
 *     item (both parts of a split item; a deal's agreed total) — client figures ignored
 *   - below the minimum with no reason → 422 MARGIN_BELOW, nothing saved
 *   - accounts approves a below-margin payment only with an explicit acceptance,
 *     recorded with who/when; it cannot be paid before that
 *   - an edit re-checks; a new low margin needs a reason and a fresh approval
 *   - declined/cancelled payments stop counting; the Margins rows follow
 *   - only the admin sees margins and changes the minimum
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: OrderLineMargin } = await import('../models/OrderLineMargin.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const margin = await import('../utils/supplierMargin.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  const multipart = (method, url, fields) => {
    let r = agent[method](`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    return r;
  };
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    form: (url, fields = {}) => multipart('post', url, fields),
    putForm: (url, fields = {}) => multipart('put', url, fields),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `margin${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const staff = (team) => ({ team, isHead: false, active: true });
const bank = (name) => ({ name, method: 'bank', accountName: `${name} Pvt Ltd`, accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' });

/** A paid order. Default: one line, ₹1,00,000 (the owner's example). */
async function paidOrder({ items = [{ name: 'Roof Tent', price: 100000, quantity: 1 }], discount = 0 } = {}) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: items.map((i) => ({ product: new mongoose.Types.ObjectId(), ...i })),
    shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal, discount, totalAmount: subtotal - discount, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

// ── The maths ─────────────────────────────────────────────────────────────────

describe('margin maths (utils/supplierMargin.js)', () => {
  it('₹1,00,000 sale: ₹70,000 is exactly 30% and passes; ₹70,001 is below', () => {
    expect(margin.marginBp(10_000_000, 7_000_000)).toBe(3000);
    expect(margin.isBelow(3000, 3000)).toBe(false);
    expect(margin.marginBp(10_000_000, 7_000_100)).toBe(2999); // floored: never rounded up over the line
    expect(margin.isBelow(2999, 3000)).toBe(true);
    expect(margin.maxCostPaise(10_000_000, 3000)).toBe(7_000_000);
  });

  it('no sale → no margin (never "below"); a loss is negative', () => {
    expect(margin.marginBp(0, 500)).toBeNull();
    expect(margin.isBelow(null, 3000)).toBe(false);
    expect(margin.marginBp(10000, 12000)).toBe(-2000);
  });

  it("the customer's price is after their coupon share (prorated by line value)", () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const order = { items: [{ _id: a, price: 60000, quantity: 1 }, { _id: b, price: 20000, quantity: 2 }], subtotal: 100000, discount: 5000 };
    const sales = margin.lineSales(order);
    expect(sales.get(String(a))).toBe(5_700_000); // ₹60,000 − 60% of ₹5,000
    expect(sales.get(String(b))).toBe(3_800_000); // ₹40,000 − 40% of ₹5,000
  });

  it('cost: credit counts in the bill; declined/cancelled do not; a deal counts its agreed total once; a multi-item bill is split by sale', () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const dealId = new mongoose.Types.ObjectId();
    const order = { items: [{ _id: a, price: 75000, quantity: 1 }, { _id: b, price: 25000, quantity: 1 }], subtotal: 100000 };
    const reqs = [
      { kind: 'supplier', status: 'paid', itemIds: [a, b], amount: 30000, credit: { amount: 10000 }, number: 'PR-1' },
      { kind: 'supplier', status: 'declined', itemIds: [a], amount: 99999, number: 'PR-2' },
      { kind: 'supplier', status: 'cancelled', itemIds: [b], amount: 99999, number: 'PR-3' },
      { kind: 'supplier', status: 'approved', itemIds: [b], deal: dealId, amount: 2000, number: 'PR-4' },
      { kind: 'supplier', status: 'submitted', itemIds: [b], deal: dealId, amount: 3000, number: 'PR-5' },
    ];
    const deals = new Map([[String(dealId), { agreedPaise: 1_000_000, currency: 'INR', itemIds: [b] }]]);
    const lines = margin.lineCosts(order, reqs, deals);
    // PR-1's ₹40,000 bill split 75:25 → ₹30,000 / ₹10,000; the deal adds ₹10,000 to b once.
    expect(lines.get(String(a)).costPaise).toBe(3_000_000);
    expect(lines.get(String(b)).costPaise).toBe(1_000_000 + 1_000_000);
    expect(lines.get(String(b)).refs).toEqual(['PR-1', 'PR-4', 'PR-5']);
    const g = margin.groupMargin(lines, [a, b], 3000);
    expect(g).toMatchObject({ salePaise: 10_000_000, costPaise: 5_000_000, bp: 5000, below: false });
  });

  it('a foreign bill not yet paid has no rupee cost: unknown, never "below"', () => {
    const a = new mongoose.Types.ObjectId();
    const order = { items: [{ _id: a, price: 1000, quantity: 1 }], subtotal: 1000 };
    const lines = margin.lineCosts(order, [{ kind: 'supplier', status: 'submitted', itemIds: [a], currency: 'THB', amount: 0, foreignAmount: 5000 }]);
    expect(lines.get(String(a)).unknown).toBe(true);
    expect(margin.groupMargin(lines, [a], 3000)).toMatchObject({ bp: null, below: false, unknown: true });
  });
});

// ── Over HTTP ─────────────────────────────────────────────────────────────────

describe('Minimum margin on supplier payments', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, procurement, order, id, item;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    procurement = await makeUser('Aromal', 'staff', staff('procurement'));
    order = await paidOrder();
    id = String(order._id);
    item = String(order.items[0]._id);
  });

  const raise = (fields = {}) => procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [item], payee: bank('Trek N Trade'), ...fields });
  const approve = (prId, body = {}) => accounts.session.post(`/payment-requests/${prId}/approve`, body);
  const pay = (prId) => admin.session.form(`/payment-requests/${prId}/pay`, { method: 'bank', reference: 'UTR12345' });

  it('₹70,000 on a ₹1,00,000 sale is exactly 30%: raised normally, nothing extra asked', async () => {
    const res = await raise({ amount: 70000 });
    expect(res.status).toBe(201);
    expect(res.body.request.margin).toMatchObject({ sale: 100000, cost: 70000, pct: 30, minPct: 30, below: false, reason: '' });
    expect((await approve(res.body.request.id)).status).toBe(200); // no acceptance needed
  });

  it('₹70,001 without a reason is refused with the numbers procurement needs; nothing is saved', async () => {
    const res = await raise({ amount: 70001 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MARGIN_BELOW');
    expect(res.body.message).toMatch(/29\.99%/);
    expect(res.body.message).toMatch(/₹70,000 or less/);
    expect(await PaymentRequest.countDocuments({})).toBe(0);
    // A reason too short to say anything is the same as none.
    expect((await raise({ amount: 70001, marginReason: 'ok' })).status).toBe(422);
  });

  it('client-sent margin figures are ignored: the server works it out', async () => {
    const res = await raise({ amount: 80000, margin: { below: false, bp: 5000, salePaise: 99999999 }, salePaise: 99999999 });
    expect(res.status).toBe(422);
  });

  it('below the minimum with a reason: saved as below-margin, accounts must accept it explicitly, and it cannot be paid before', async () => {
    const res = await raise({ amount: 75000, marginReason: 'Only supplier with stock; customer needs it this week' });
    expect(res.status).toBe(201);
    const pr = res.body.request;
    expect(pr.margin).toMatchObject({ pct: 25, below: true, reason: 'Only supplier with stock; customer needs it this week' });

    // The admin cannot pay it in the same step as approving.
    expect((await pay(pr.id)).status).toBe(409);
    // Procurement cannot approve it.
    expect((await procurement.session.post(`/payment-requests/${pr.id}/approve`, { acceptBelowMargin: true })).status).toBe(403);
    // Accounts: a plain approve is refused; with the acceptance it goes through, recorded.
    const plain = await approve(pr.id);
    expect(plain.status).toBe(400);
    expect(plain.body.message).toMatch(/I accept the lower margin/);
    const ok = await approve(pr.id, { acceptBelowMargin: true });
    expect(ok.status).toBe(200);
    expect(ok.body.request.margin).toMatchObject({ below: true, acceptedByName: 'Anu' });
    expect(ok.body.request.margin.acceptedAt).toBeTruthy();
    // A second click is not a second approval.
    expect((await approve(pr.id, { acceptBelowMargin: true })).status).toBe(409);
    expect((await pay(pr.id)).status).toBe(200);

    // The admin sees it in the exceptions list: who, which order, how far below, the reason, who accepted.
    const ex = await admin.session.get('/admin/margins/exceptions');
    expect(ex.status).toBe(200);
    expect(ex.body.rows).toHaveLength(1);
    expect(ex.body.rows[0]).toMatchObject({
      number: pr.number, status: 'paid', requestedByName: 'Aromal', marginPct: 25, minPct: 30, shortBy: 5000,
      reason: 'Only supplier with stock; customer needs it this week', acceptedByName: 'Anu', sale: 100000, cost: 75000,
    });
  });

  it('an item bought from two suppliers is checked on both payments together', async () => {
    const addPart = (supplierName, what) => procurement.session.post(`/staff/work/orders/${id}/lines/${item}/parts`, { supplierName, what });
    expect((await addPart('Trek N Trade', 'Tent')).status).toBe(200);
    const [tent, rack] = (await addPart('Mount Co', 'Roof rack')).body.order.lines[0].supplierParts;
    expect((await raise({ partId: tent.id, amount: 40000 })).status).toBe(201);
    // ₹40,000 + ₹35,000 = ₹75,000 on the ₹1,00,000 item → 25%.
    const second = await raise({ partId: rack.id, amount: 35000, payee: bank('Mount Co') });
    expect(second.status).toBe(422);
    expect(second.body.message).toMatch(/supplier cost is ₹75,000/);
    const ok = await raise({ partId: rack.id, amount: 30000, payee: bank('Mount Co') });
    expect(ok.status).toBe(201);
    expect(ok.body.request.margin).toMatchObject({ cost: 70000, pct: 30, below: false });
  });

  it('an edit re-checks: a new low margin needs a reason, and an earlier acceptance does not carry over', async () => {
    const res = await raise({ amount: 70000 });
    const pr = res.body.request;
    const tooHigh = await procurement.session.putForm(`/payment-requests/${pr.id}`, { amount: 80000, reason: 'Supplier raised price' });
    expect(tooHigh.status).toBe(422);
    expect(tooHigh.body.code).toBe('MARGIN_BELOW');
    expect((await PaymentRequest.findById(pr.id).lean()).amount).toBe(70000);
    const withWhy = await procurement.session.putForm(`/payment-requests/${pr.id}`, { amount: 80000, reason: 'Supplier raised price', marginReason: 'Price went up; customer already paid' });
    expect(withWhy.status).toBe(200);
    expect(withWhy.body.request.margin).toMatchObject({ pct: 20, below: true, acceptedByName: '' });
    // Back down to 30%: no longer below, the reason is dropped.
    const back = await procurement.session.putForm(`/payment-requests/${pr.id}`, { amount: 70000, reason: 'Negotiated' });
    expect(back.status).toBe(200);
    expect(back.body.request.margin).toMatchObject({ pct: 30, below: false, reason: '' });
  });

  it('the Margins rows follow the payments: raised → a row; declined → gone', async () => {
    const res = await raise({ amount: 60000 });
    let rows = await OrderLineMargin.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ salePaise: 10_000_000, costPaise: 6_000_000, bp: 4000, below: false, refs: [res.body.request.number] });
    expect((await accounts.session.post(`/payment-requests/${res.body.request.id}/decline`, { note: 'Wrong supplier' })).status).toBe(200);
    rows = await OrderLineMargin.find({}).lean();
    expect(rows).toHaveLength(0);
  });

  it('the coupon comes off the sale: ₹1,00,000 item with ₹5,000 off → supplier ₹66,500 is the most', async () => {
    order = await paidOrder({ discount: 5000 });
    id = String(order._id);
    item = String(order.items[0]._id);
    expect((await raise({ amount: 66501 })).status).toBe(422);
    const ok = await raise({ amount: 66500 });
    expect(ok.status).toBe(201);
    expect(ok.body.request.margin).toMatchObject({ sale: 95000, pct: 30 });
  });

  it('the admin changes the minimum; new payments use it; only the admin may', async () => {
    expect((await procurement.session.put('/admin/margins/settings', { minPct: 10 })).status).toBe(403);
    expect((await accounts.session.get('/admin/margins/settings')).status).toBe(403);
    expect((await admin.session.put('/admin/margins/settings', { minPct: 'abc' })).status).toBe(400);
    expect((await admin.session.put('/admin/margins/settings', { minPct: 95 })).status).toBe(400);
    const set = await admin.session.put('/admin/margins/settings', { minPct: 25 });
    expect(set.status).toBe(200);
    expect(set.body.settings).toMatchObject({ minPct: 25, updatedByName: 'Owner' });
    const res = await raise({ amount: 75000 });
    expect(res.status).toBe(201);
    expect(res.body.request.margin).toMatchObject({ pct: 25, minPct: 25, below: false });
  });

  it('the admin Margins panel: lines (newest / lowest, paged), products, totals — admin only', async () => {
    const two = await paidOrder({ items: [{ name: 'Snorkel', price: 10000, quantity: 2 }, { name: 'Light bar', price: 5000, quantity: 1 }] });
    const [s, l] = two.items.map((i) => String(i._id));
    await raise({ amount: 60000 });
    const send = (itemIds, amount, extra = {}) => procurement.session.form('/payment-requests/supplier', { orderId: String(two._id), itemIds, payee: bank('Light House'), amount, ...extra });
    expect((await send([s], 12000)).status).toBe(201); // ₹20,000 sale → 40%
    expect((await send([l], 4000, { marginReason: 'Clearance stock from a new supplier' })).status).toBe(201); // ₹5,000 → 20%

    expect((await procurement.session.get('/admin/margins/lines')).status).toBe(403);
    expect((await request(app).get(`${BASE}/admin/margins/lines`)).status).toBe(401);

    const lowest = await admin.session.get('/admin/margins/lines?sort=lowest&limit=2');
    expect(lowest.status).toBe(200);
    expect(lowest.body.rows.map((r) => r.marginPct)).toEqual([20, 40]);
    expect(lowest.body.rows[0]).toMatchObject({ name: 'Light bar', sale: 5000, cost: 4000, margin: 1000, below: true });
    const next = await admin.session.get(`/admin/margins/lines?sort=lowest&limit=2&cursor=${lowest.body.nextCursor}`);
    expect(next.body.rows.map((r) => r.marginPct)).toEqual([40]);
    expect(next.body.nextCursor).toBeNull();
    const belowOnly = await admin.session.get('/admin/margins/lines?below=1');
    expect(belowOnly.body.rows).toHaveLength(1);

    const totals = await admin.session.get('/admin/margins/totals');
    expect(totals.body.totals).toMatchObject({ sale: 125000, cost: 76000, margin: 49000, lines: 3, belowLines: 1, minPct: 30 });
    expect(totals.body.totals.marginPct).toBe(39.2);

    const products = await admin.session.get('/admin/margins/products');
    expect(products.body.rows.map((r) => r.marginPct)).toEqual([20, 40, 40]);
    expect(products.body.rows[0]).toMatchObject({ name: 'Light bar', units: 1, belowLines: 1 });

    // Date filter: an empty range in the past has nothing.
    const none = await admin.session.get('/admin/margins/lines?from=2020-01-01&to=2020-01-31');
    expect(none.body.rows).toHaveLength(0);
    expect((await admin.session.get('/admin/margins/lines?from=nope')).status).toBe(400);
    expect((await admin.session.get('/admin/margins/lines?cursor=%%%')).status).toBe(400);
  });
});
