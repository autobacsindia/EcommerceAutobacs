/**
 * A supplier payment NOT for one order's item — stock, or goods for several orders
 * on one bill (POST /payment-requests/supplier with no orderId). Owner, 2026-11-24:
 * PR-0144/0145/0146 for RK New Popular had to be raised as "Product purchase"
 * expenses with the supplier typed as text, so they never showed under the
 * supplier and could not be paid in one transfer.
 *
 * What must hold:
 *   - anyone who raises expenses raises one (owner, 2026-11-25: "ok do this for all"),
 *     and it sits with their team; paying an order's items or a bill we owe stays
 *     procurement's. The supplier must be a SAVED one
 *     (picked, or saved now) — a typed-only payee is refused, and saves nothing
 *   - the saved supplier's details are copied; the client's payee is ignored
 *   - "what was bought" is required; no deal / part / supplier credit without an order
 *   - a double submit (same clientId), in turn or at once, raises ONE request
 *   - once approved it sits under its supplier beside order payments, and the admin
 *     pays them all in one transfer
 *   - an edit cannot unlink it from its saved supplier; decline → edit → resubmit works
 *   - paying it singly works (no order to move)
 *   - everyone can pick a saved supplier (name start only, no contact details), and
 *     "save as a new supplier" is refused when the name or phone is already saved
 */

import { withoutMinimumMargin } from './helpers/marginRule.js';
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
const { default: Supplier } = await import('../models/Supplier.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const wf = await import('../services/teamWorkflowService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    formPut: (url, fields = {}, files = []) => {
      let r = agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      for (const f of files) r = r.attach(f.field, f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
    form: (url, fields = {}, files = []) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      for (const f of files) r = r.attach(f.field, f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const staff = (team, isHead = false) => ({ team, isHead, active: true });

const UPI = { name: 'Fuel Station', method: 'upi', upiId: 'fuelstation@okaxis' };
const BANK = { name: 'ARB Supplies', method: 'bank', accountName: 'ARB Supplies Pvt Ltd', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' };
const expense = (s, over = {}, files = [{ field: 'bill', buffer: JPEG, name: 'bill.jpg', type: 'image/jpeg' }]) =>
  s.form('/payment-requests/expenses', { category: 'fuel', amount: 1250.5, description: 'Diesel for delivery van', payee: UPI, ...over }, files);

async function paidOrder(salesUser = null) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(), salesUser,
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Lift kit', price: 50000, quantity: 1 },
      { product: new mongoose.Types.ObjectId(), name: 'Floor mat', price: 2000, quantity: 1 },
    ],
    shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 52000, totalAmount: 52000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

const ARB = {
  name: 'ARB Supplies', contactPerson: 'Joseph', phone: '9800000001', gstin: '32ABCDE1234F1Z5', address: 'Kochi',
  payment: { method: 'bank', accountName: 'ARB Supplies Pvt Ltd', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' },
};
const OTHER_BANK = { name: 'Tyre World', method: 'bank', accountName: 'Tyre World', accountNumber: '998877665544', ifsc: 'ICIC0004321', bankName: 'ICICI' };
// A Thai supplier: a foreign bank, found by its SWIFT code — no IFSC.
const THAI = {
  name: 'Open N', phone: '6681000000',
  payment: { method: 'bank', accountName: 'Nikom Amranan', accountNumber: '8582102601', swift: 'kasithbk', bankName: 'KASIKORNBANK' },
};


describe('Supplier payment not for one order (stock)', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, procurement, ops, sales, hr;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    sales = await makeUser('Sana', 'staff', staff('sales'));
    hr = await makeUser('Hari', 'staff', staff('hr'));
  });

  const RK = { ...ARB, name: 'RK New Popular', gstin: '' };
  const addSupplier = async (over = {}) => {
    const res = await procurement.session.post('/suppliers', { ...RK, ...over });
    expect(res.status).toBe(201);
    return res.body.supplier;
  };
  const BILL = [{ field: 'bill', buffer: PDF, name: 'bill.pdf', type: 'application/pdf' }];
  const stock = (s, fields = {}, files = BILL) => s.form('/payment-requests/supplier', { amount: 12000, description: '20 floor mats, bill 4471', ...fields }, files);
  const payBatch = (s, ids, expectedTotal) => s.form('/payment-requests/pay-batch',
    { ids, expectedTotal, method: 'bank', reference: 'UTR4471' },
    [{ field: 'proof', buffer: JPEG, name: 'transfer.jpg', type: 'image/jpeg' }]);

  it('procurement raises one from a saved supplier: kind supplier, no order, the supplier\'s details copied', async () => {
    const s = await addSupplier();
    const res = await stock(procurement.session, { supplierId: s.id, payee: OTHER_BANK, reference: 'INV-4471' });
    expect(res.status).toBe(201);
    const r = res.body.request;
    expect(r).toMatchObject({ kind: 'supplier', status: 'submitted', amount: 12000, order: null, itemNames: [], reference: 'INV-4471', supplier: { id: s.id } });
    const raw = await PaymentRequest.findById(r.id).lean();
    // The client's payee is ignored: the saved supplier's account is what is paid.
    expect(raw.payee).toMatchObject({ name: 'RK New Popular', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
    expect(raw.category).toBe('supplier');
    expect(raw.team).toBe('procurement');
    expect(raw.history[0].note).toMatch(/not for one order/);
    expect(raw.files.map((f) => f.kind)).toEqual(['bill']);
    // Team chat hears about it, with what was bought.
    const accountsSpace = await ChatChannel.findOne({ key: 'team:accounts' }).lean();
    const [msg] = await ChatMessage.find({ channel: accountsSpace._id }).lean();
    expect(msg.text).toMatch(/New supplier payment PR-\d+ .*RK New Popular — 20 floor mats, bill 4471. .*Accounts: please approve/);
  });

  it('a payee typed by hand (not saved) is refused and nothing is saved', async () => {
    const res = await stock(procurement.session, { payee: { ...RK.payment, name: 'RK New Popular' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Pick the supplier from the list/);
    expect(await PaymentRequest.countDocuments()).toBe(0);
    expect(stored.size).toBe(0);
  });

  it('"save as a new supplier" saves it and links the payment to it', async () => {
    const res = await stock(procurement.session, { payee: { ...RK.payment, name: 'RK New Popular' }, saveSupplier: 'true' });
    expect(res.status).toBe(201);
    const saved = await Supplier.findOne({ name: 'RK New Popular' }).lean();
    expect(saved).toBeTruthy();
    expect(res.body.request.supplier).toEqual({ id: String(saved._id) });
  });

  it('a new supplier with no way to pay them is refused before the supplier is saved', async () => {
    const res = await stock(procurement.session, { payee: { name: 'RK New Popular', method: 'upi', upiId: '' }, saveSupplier: 'true' });
    expect(res.status).toBe(400);
    expect(await Supplier.countDocuments()).toBe(0);
    expect(await PaymentRequest.countDocuments()).toBe(0);
  });

  it('needs what was bought, a real amount, and no deal / part / credit', async () => {
    const s = await addSupplier();
    expect((await stock(procurement.session, { supplierId: s.id, description: '' })).status).toBe(400);
    expect((await stock(procurement.session, { supplierId: s.id, description: '<p>12</p>' })).status).toBe(400);
    for (const amount of [0, -5, 'abc', 100000001]) {
      expect([amount, (await stock(procurement.session, { supplierId: s.id, amount })).status]).toEqual([amount, 400]);
    }
    const fake = String(new mongoose.Types.ObjectId());
    expect((await stock(procurement.session, { supplierId: s.id, dealId: fake })).status).toBe(400);
    expect((await stock(procurement.session, { supplierId: s.id, partId: fake })).status).toBe(400);
    // Supplier credit IS allowed here since 2026-11-25 — but only what the supplier owes (none here).
    expect((await stock(procurement.session, { supplierId: s.id, creditToUse: 500 })).status).toBe(409);
    expect(await PaymentRequest.countDocuments()).toBe(0);
  });

  it('every team that raises expenses raises one; it sits with their team', async () => {
    const s = await addSupplier();
    for (const [who, team] of [[sales, 'sales'], [hr, 'hr'], [ops, 'operations'], [accounts, 'accounts'], [procurement, 'procurement'], [admin, 'procurement']]) {
      const res = await stock(who.session, { supplierId: s.id, payee: OTHER_BANK });
      expect([team, res.status]).toEqual([team, 201]);
      const raw = await PaymentRequest.findById(res.body.request.id).lean();
      expect([team, raw.team, raw.kind, String(raw.supplier)]).toEqual([team, team, 'supplier', s.id]);
      // The saved supplier's account, whoever raised it and whatever they sent.
      expect(raw.payee).toMatchObject({ name: 'RK New Popular', accountNumber: '123456789012' });
    }
  });

  it('a sales one: they see it, accounts approves, the admin pays it with the supplier\'s other bills', async () => {
    const s = await addSupplier();
    const mine = (await stock(sales.session, { supplierId: s.id, amount: 3000, clientId: 'sales-form-0001' })).body.request;
    // A double submit is still one request.
    expect((await stock(sales.session, { supplierId: s.id, amount: 3000, clientId: 'sales-form-0001' })).body.request.id).toBe(mine.id);
    const theirs = (await stock(procurement.session, { supplierId: s.id, amount: 7000 })).body.request;
    expect((await sales.session.get(`/payment-requests/${mine.id}`)).status).toBe(200);
    // Another team's stays theirs, as with expenses.
    expect((await sales.session.get(`/payment-requests/${theirs.id}`)).status).toBe(404);
    // The raiser corrects it before approval, like any request.
    expect((await sales.session.formPut(`/payment-requests/${mine.id}`, { reason: 'bill corrected', amount: 3200 })).status).toBe(200);
    for (const id of [mine.id, theirs.id]) expect((await accounts.session.post(`/payment-requests/${id}/approve`)).status).toBe(200);
    const groups = (await admin.session.get('/payment-requests/to-pay/suppliers')).body.groups;
    expect(groups.map((g) => [g.count, g.total])).toEqual([[2, 10200]]);
    expect((await payBatch(admin.session, [mine.id, theirs.id], 10200)).status).toBe(200);
    expect((await PaymentRequest.find({ status: 'paid' }).lean()).length).toBe(2);
  });

  it('outside procurement: no paying an order\'s items or a bill we owe; inactive staff and customers refused', async () => {
    const s = await addSupplier();
    const order = await paidOrder();
    const item = String(order.items[0]._id);
    await wf.setStock(procurement.user, String(order._id), item, { stock: 'in_stock' }, req);
    const forOrder = await sales.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [item], amount: 1500, supplierId: s.id });
    expect(forOrder.status).toBe(403);
    const bill = await stock(sales.session, { supplierBillId: String(new mongoose.Types.ObjectId()), supplierId: s.id });
    expect(bill.status).toBe(403);
    const gone = await makeUser('Gita', 'staff', { team: 'sales', isHead: false, active: false });
    expect((await stock(gone.session, { supplierId: s.id })).status).toBeGreaterThanOrEqual(401);
    const shopper = await makeUser('Cust', 'customer');
    expect((await stock(shopper.session, { supplierId: s.id })).status).toBeGreaterThanOrEqual(401);
    expect(await PaymentRequest.countDocuments()).toBe(0);
  });

  it('everyone picks from saved suppliers by name start — without contact details or the account number', async () => {
    await addSupplier();
    const found = await sales.session.get('/suppliers?prefix=rk%20new&status=active');
    expect(found.status).toBe(200);
    expect(found.body.suppliers).toHaveLength(1);
    const [r] = found.body.suppliers;
    expect(r).toMatchObject({ name: 'RK New Popular', phone: '9800000001', contactPerson: '', address: '', gstin: '', can: { edit: false, revealAccount: false } });
    expect(r.payment).toMatchObject({ method: 'bank', accountNumber: '', ifsc: 'HDFC0001234' });
    expect(r.payment.accountMasked).toMatch(/9012$/);
    // No prefix: nothing (the directory is procurement's and accounts').
    expect((await sales.session.get('/suppliers?q=HDFC')).body.suppliers).toEqual([]);
    expect((await sales.session.get('/suppliers?status=active')).body.suppliers).toEqual([]);
    // …nor its other doors.
    const id = (await Supplier.findOne().lean())._id;
    expect((await sales.session.get(`/suppliers/${id}`)).status).toBe(403);
    expect((await sales.session.post(`/suppliers/${id}/account-number`)).status).toBe(403);
    expect((await sales.session.post('/suppliers', { ...RK, name: 'Another One' })).status).toBe(403);
    expect((await sales.session.put(`/suppliers/${id}`, { ...RK, name: 'Renamed' })).status).toBe(403);
    // Procurement and accounts still get the full directory.
    expect((await procurement.session.get('/suppliers?status=active')).body.suppliers[0].gstin).toBe('');
    expect((await accounts.session.get('/suppliers?q=HDFC')).body.suppliers).toHaveLength(1);
  });

  it('sales saves a new supplier from the payment; the same name or phone again is refused and points at the saved one', async () => {
    const pay = { method: 'upi', upiId: 'shahfab@okaxis', phone: '+91 98111 22233' };
    const res = await stock(sales.session, { payee: { ...pay, name: 'Shah Fabrications' }, saveSupplier: 'true' });
    expect(res.status).toBe(201);
    const saved = await Supplier.findOne({ name: 'Shah Fabrications' }).lean();
    expect(res.body.request.supplier).toEqual({ id: String(saved._id) });
    expect(saved.createdByName).toBe('Sana');

    const sameName = await stock(sales.session, { payee: { ...pay, name: '  shah   FABRICATIONS ', phone: '' }, saveSupplier: 'true' });
    expect(sameName.status).toBe(409);
    expect(sameName.body.message).toMatch(/“Shah Fabrications” is already saved with this name .*pick it from the list/);
    const samePhone = await stock(hr.session, { payee: { ...pay, name: 'Shah Fab Works', phone: '9811122233' }, saveSupplier: 'true' });
    expect(samePhone.status).toBe(409);
    expect(samePhone.body.message).toMatch(/“Shah Fabrications” is already saved with this phone number/);
    expect(await Supplier.countDocuments()).toBe(1);
    expect(await PaymentRequest.countDocuments()).toBe(1);
    expect(stored.size).toBe(1);

    // An inactive one says so (procurement reactivates it).
    await procurement.session.post(`/suppliers/${saved._id}/active`, { active: false });
    const off = await stock(sales.session, { payee: { ...pay, name: 'Shah Fabrications' }, saveSupplier: 'true' });
    expect(off.status).toBe(409);
    expect(off.body.message).toMatch(/inactive — ask procurement/);
    // A different supplier with no phone is fine.
    expect((await stock(sales.session, { payee: { method: 'upi', upiId: 'kumar@okaxis', name: 'Kumar Tyres' }, saveSupplier: 'true' })).status).toBe(201);
  });

  it('an unknown or inactive supplier is refused', async () => {
    expect((await stock(procurement.session, { supplierId: String(new mongoose.Types.ObjectId()) })).status).toBe(404);
    const s = await addSupplier();
    await procurement.session.post(`/suppliers/${s.id}/active`, { active: false });
    expect((await stock(procurement.session, { supplierId: s.id })).status).toBeGreaterThanOrEqual(400);
    expect(await PaymentRequest.countDocuments()).toBe(0);
  });

  it('a double submit raises one request — one after the other, and at the same moment', async () => {
    const s = await addSupplier();
    const first = await stock(procurement.session, { supplierId: s.id, clientId: 'stock-form-0001' });
    const again = await stock(procurement.session, { supplierId: s.id, clientId: 'stock-form-0001' });
    expect(again.body.request.id).toBe(first.body.request.id);
    const both = await Promise.all([1, 2].map(() => stock(procurement.session, { supplierId: s.id, clientId: 'stock-form-0002' })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 201]);
    expect(both[0].body.request.id).toBe(both[1].body.request.id);
    expect(await PaymentRequest.countDocuments()).toBe(2);
    // The loser's bill copy is not left behind: one bill per request.
    expect(stored.size).toBe(2);
  });

  it('three stock bills and an order payment to one supplier are paid in one transfer', async () => {
    const s = await addSupplier();
    const ids = [];
    for (const amount of [12000, 8000.5, 4500]) {
      const r = (await stock(procurement.session, { supplierId: s.id, amount })).body.request;
      expect((await accounts.session.post(`/payment-requests/${r.id}/approve`)).status).toBe(200);
      ids.push(r.id);
    }
    const order = await paidOrder();
    const item = String(order.items[0]._id);
    await wf.setStock(procurement.user, String(order._id), item, { stock: 'in_stock' }, req);
    const forOrder = (await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [item], amount: 1500, supplierId: s.id })).body.request;
    await accounts.session.post(`/payment-requests/${forOrder.id}/approve`);
    ids.push(forOrder.id);

    const groups = (await admin.session.get('/payment-requests/to-pay/suppliers')).body.groups;
    expect(groups.map((g) => [g.count, g.total])).toEqual([[4, 26000.5]]);
    const paid = await payBatch(admin.session, ids, 26000.5);
    expect(paid.status).toBe(200);
    const rows = await PaymentRequest.find({ _id: { $in: ids } }).lean();
    expect(rows.every((r) => r.status === 'paid')).toBe(true);
    expect(new Set(rows.map((r) => r.payment.batch)).size).toBe(1);
    // The order's item moved on as usual; the stock ones had no order to move.
    const o = await Order.findById(order._id).lean();
    expect(JSON.stringify(o.workflow || {})).toMatch(/RK New Popular|ordered/i);
  });

  it('paid on its own: approved → paid, nothing else to move', async () => {
    const s = await addSupplier();
    const r = (await stock(procurement.session, { supplierId: s.id })).body.request;
    await accounts.session.post(`/payment-requests/${r.id}/approve`);
    const paid = await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'upi', reference: 'UPI4471' }, [{ field: 'proof', buffer: JPEG, name: 'p.jpg', type: 'image/jpeg' }]);
    expect(paid.status).toBe(200);
    expect((await PaymentRequest.findById(r.id).lean()).status).toBe('paid');
  });

  it('an edit cannot unlink it from its saved supplier; changing the amount is fine', async () => {
    const s = await addSupplier();
    const other = await addSupplier({ name: 'Tyre World', payment: { method: 'bank', accountName: 'Tyre World', accountNumber: '998877665544', ifsc: 'ICIC0004321', bankName: 'ICICI' } });
    const r = (await stock(procurement.session, { supplierId: s.id })).body.request;
    const typed = await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'wrong account', payee: OTHER_BANK });
    expect(typed.status).toBe(400);
    expect((await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'other supplier', supplierId: other.id })).status).toBe(200);
    const amt = await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'bill corrected', amount: 11500 });
    expect(amt.status).toBe(200);
    const raw = await PaymentRequest.findById(r.id).lean();
    expect(raw.amount).toBe(11500);
    expect(String(raw.supplier)).toBe(other.id);
  });

  it('declined, then corrected and sent back to accounts', async () => {
    const s = await addSupplier();
    const r = (await stock(procurement.session, { supplierId: s.id })).body.request;
    expect((await accounts.session.post(`/payment-requests/${r.id}/decline`, { note: 'bill total is 11,800' })).status).toBe(200);
    const back = await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'fixed the amount', amount: 11800 });
    expect(back.status).toBe(200);
    expect(back.body.request.status).toBe('submitted');
  });

  it('a payment for an order still needs its items (unchanged)', async () => {
    const s = await addSupplier();
    const order = await paidOrder();
    const res = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), amount: 500, supplierId: s.id });
    expect(res.status).toBe(400);
  });
});

// Older payment cases are not about the 30% minimum (tests/supplierMargin.test.js is).
withoutMinimumMargin();
