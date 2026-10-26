/**
 * The supplier directory and paying a supplier in one transfer
 * (routes/suppliers.js, /payment-requests/to-pay/suppliers, /payment-requests/pay-batch).
 *
 * What must hold:
 *   - procurement and the admin add / edit suppliers; accounts only views; others nothing
 *   - the account number is encrypted at rest and masked for accounts in the directory
 *   - a payment raised from a saved supplier COPIES its details (the client's payee is
 *     ignored); editing the supplier later never rewrites that payment
 *   - changing where the money goes stamps the supplier, and payments raised soon after
 *     carry a warning; an inactive supplier cannot be paid
 *   - approved supplier payments group by destination (same account), with the total
 *   - the admin pays the ticked ones in one transfer; the rest stay to pay
 *   - a batch is all-or-nothing: a changed total, a payment that moved, two admins at
 *     once, or a double click never pays anything twice or half a batch
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
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

const ARB = {
  name: 'ARB Supplies', contactPerson: 'Joseph', phone: '9800000001', gstin: '32ABCDE1234F1Z5', address: 'Kochi',
  payment: { method: 'bank', accountName: 'ARB Supplies Pvt Ltd', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' },
};
const OTHER_BANK = { name: 'Tyre World', method: 'bank', accountName: 'Tyre World', accountNumber: '998877665544', ifsc: 'ICIC0004321', bankName: 'ICICI' };

describe('Supplier directory and one-transfer payments', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, procurement, ops;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
  });

  const addSupplier = async (over = {}) => {
    const res = await procurement.session.post('/suppliers', { ...ARB, ...over });
    expect(res.status).toBe(201);
    return res.body.supplier;
  };

  /** A paid order with one in-stock item, and a supplier payment for it, approved by accounts. */
  async function approvedPayment(fields) {
    const order = await paidOrder();
    const item = String(order.items[0]._id);
    await wf.setStock(procurement.user, String(order._id), item, { stock: 'in_stock' }, req);
    const res = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [item], ...fields });
    expect(res.status).toBe(201);
    expect((await accounts.session.post(`/payment-requests/${res.body.request.id}/approve`)).status).toBe(200);
    return res.body.request;
  }

  const payBatch = (s, ids, expectedTotal, over = {}) => s.form('/payment-requests/pay-batch',
    { ids, expectedTotal, method: 'bank', reference: 'UTR998877', ...over },
    [{ field: 'proof', buffer: JPEG, name: 'transfer.jpg', type: 'image/jpeg' }]);

  describe('the directory', () => {
    it('procurement adds a supplier; the account number is encrypted at rest', async () => {
      const s = await addSupplier();
      expect(s).toMatchObject({ name: 'ARB Supplies', gstin: '32ABCDE1234F1Z5', active: true, payment: { method: 'bank', accountNumber: '123456789012', ifsc: 'HDFC0001234' } });
      const raw = await Supplier.findById(s.id).select('+payment.accountNumber').lean();
      expect(raw.payment.accountNumber).not.toContain('123456789012');
      expect(raw.payment.accountLast4).toBe('9012');
    });

    it('accounts views with the number masked and cannot edit; other teams see nothing', async () => {
      const s = await addSupplier();
      const seen = (await accounts.session.get('/suppliers')).body.suppliers[0];
      expect(seen.payment.accountNumber).toBe('');
      expect(seen.payment.accountMasked).toMatch(/9012$/);
      expect(seen.can.edit).toBe(false);
      expect((await accounts.session.post('/suppliers', { ...ARB, name: 'X Co' })).status).toBe(403);
      expect((await accounts.session.post(`/suppliers/${s.id}/active`, { active: false })).status).toBe(403);
      expect((await ops.session.get('/suppliers')).status).toBe(403);
      expect((await admin.session.post('/suppliers', { ...ARB, name: 'Admin Co' })).status).toBe(201);
    });

    it('rejects a duplicate name and bad bank details', async () => {
      await addSupplier();
      expect((await procurement.session.post('/suppliers', { ...ARB, name: '  arb   supplies ' })).status).toBe(409);
      expect((await procurement.session.post('/suppliers', { ...ARB, name: 'New Co', payment: { ...ARB.payment, ifsc: 'BAD' } })).status).toBe(400);
      expect((await procurement.session.post('/suppliers', { ...ARB, name: 'New Co', gstin: '123' })).status).toBe(400);
    });

    it('searches by name prefix; an inactive supplier leaves the picker', async () => {
      const s = await addSupplier();
      await addSupplier({ name: 'Bosch Parts' });
      expect((await procurement.session.get('/suppliers?q=bo')).body.suppliers.map((x) => x.name)).toEqual(['Bosch Parts']);
      expect((await procurement.session.post(`/suppliers/${s.id}/active`, { active: false })).status).toBe(200);
      expect((await procurement.session.get('/suppliers')).body.suppliers.map((x) => x.name)).toEqual(['Bosch Parts']);
      expect((await procurement.session.get('/suppliers?status=inactive')).body.suppliers.map((x) => x.name)).toEqual(['ARB Supplies']);
    });

    it('changing where the money goes is stamped; other edits are not', async () => {
      const s = await addSupplier();
      const phone = await procurement.session.put(`/suppliers/${s.id}`, { ...ARB, phone: '9800000002' });
      expect(phone.body.supplier.bankChangedAt).toBeNull();
      const bank = await procurement.session.put(`/suppliers/${s.id}`, { ...ARB, payment: { ...ARB.payment, accountNumber: '555566667777' } });
      expect(bank.body.supplier.bankChangedAt).toBeTruthy();
      expect(bank.body.supplier.bankChangedBy).toBe('Priya');
    });
  });

  describe('raising a payment from a saved supplier', () => {
    it('copies the saved details, ignoring what the client sent; a later edit does not rewrite it', async () => {
      const s = await addSupplier();
      const r = await approvedPayment({ amount: 1000, supplierId: s.id, payee: { name: 'Hacker', method: 'upi', upiId: 'evil@okaxis' } });
      expect(r.payee).toMatchObject({ name: 'ARB Supplies', method: 'bank', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
      expect(r.supplier).toEqual({ id: s.id });
      expect(r.bankNotice).toBeNull();
      await procurement.session.put(`/suppliers/${s.id}`, { ...ARB, payment: { ...ARB.payment, accountNumber: '555566667777' } });
      expect((await PaymentRequest.findById(r.id).lean()).payee.accountNumber).toBe('123456789012');
    });

    it('a payment raised after a bank change carries the warning; an inactive supplier cannot be paid', async () => {
      const s = await addSupplier();
      await procurement.session.put(`/suppliers/${s.id}`, { ...ARB, payment: { ...ARB.payment, accountNumber: '555566667777' } });
      const r = await approvedPayment({ amount: 1000, supplierId: s.id });
      expect(r.bankNotice).toMatchObject({ byName: 'Priya' });
      await procurement.session.post(`/suppliers/${s.id}/active`, { active: false });
      const order = await paidOrder();
      const item = String(order.items[0]._id);
      await wf.setStock(procurement.user, String(order._id), item, { stock: 'in_stock' }, req);
      expect((await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [item], amount: 5, supplierId: s.id })).status).toBe(409);
    });

    it('details typed by hand can be saved as a new supplier in the same step', async () => {
      const r = await approvedPayment({ amount: 700, payee: OTHER_BANK, saveSupplier: 'true' });
      const saved = (await procurement.session.get('/suppliers')).body.suppliers;
      expect(saved.map((x) => x.name)).toEqual(['Tyre World']);
      expect(r.supplier).toEqual({ id: saved[0].id });
    });
  });

  describe('the admin pays by supplier', () => {
    async function threeForArbOneElsewhere() {
      const s = await addSupplier();
      const a = await approvedPayment({ amount: 1000, supplierId: s.id });
      const b = await approvedPayment({ amount: 2500.5, supplierId: s.id });
      // Typed by hand to the SAME account: still the same supplier to pay.
      const c = await approvedPayment({ amount: 300, payee: { ...ARB.payment, name: 'ARB Supplies (Kochi)' } });
      const other = await approvedPayment({ amount: 999, payee: OTHER_BANK });
      return { a, b, c, other };
    }
    const groupsOf = async (s) => (await s.get('/payment-requests/to-pay/suppliers')).body.groups;

    it('one row per account with the count and total; a waiting (unapproved) payment is not in it', async () => {
      await threeForArbOneElsewhere();
      const order = await paidOrder();
      const item = String(order.items[0]._id);
      await wf.setStock(procurement.user, String(order._id), item, { stock: 'in_stock' }, req);
      await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [item], amount: 50, payee: { ...ARB.payment, name: 'ARB' } });

      const groups = await groupsOf(admin.session);
      expect(groups.map((g) => [g.count, g.total])).toEqual([[3, 3800.5], [1, 999]]);
      expect(groups[0].destination).toMatch(/HDFC XXXXXXXX9012 · HDFC0001234/);
      expect(JSON.stringify(groups)).not.toContain('123456789012');
      expect((await accounts.session.get('/payment-requests/to-pay/suppliers')).status).toBe(200);
      expect((await procurement.session.get('/payment-requests/to-pay/suppliers')).status).toBe(403);

      const detail = (await admin.session.get(`/payment-requests/to-pay/suppliers/${groups[0].id}`)).body.group;
      expect(detail.requests).toHaveLength(3);
      expect(detail.total).toBe(3800.5);
    });

    it('pays the ticked ones in one transfer; the rest stay to pay with the new total', async () => {
      const { a, b, c } = await threeForArbOneElsewhere();
      const res = await payBatch(admin.session, [a.id, b.id], 3500.5);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ count: 2, total: 3500.5 });
      const [pa, pb, pc] = await Promise.all([a, b, c].map((r) => PaymentRequest.findById(r.id).lean()));
      expect([pa.status, pb.status, pc.status]).toEqual(['paid', 'paid', 'approved']);
      expect(pa.payment.batch).toBeTruthy();
      expect(pa.payment.batch).toBe(pb.payment.batch);
      expect(pa.payment.reference).toBe('UTR998877');
      expect(pa.files.filter((f) => f.kind === 'proof')).toHaveLength(1);
      expect(pa.history.at(-1).note).toMatch(/one transfer for 2 payments/);
      const arb = (await groupsOf(admin.session)).find((g) => g.count === 1 && g.total === 300);
      expect(arb).toBeTruthy();
    });

    it('a changed total changes nothing', async () => {
      const { a, b } = await threeForArbOneElsewhere();
      expect((await payBatch(admin.session, [a.id, b.id], 3500)).status).toBe(409);
      expect((await PaymentRequest.find({ status: 'paid' }).lean())).toHaveLength(0);
      expect(stored.size).toBe(0); // the screenshot is not kept for a payment that was not recorded
    });

    it('a ticked payment that was paid or held meanwhile stops the whole batch', async () => {
      const { a, b } = await threeForArbOneElsewhere();
      await accounts.session.post(`/payment-requests/${b.id}/hold`, { note: 'Bill queried' });
      // On hold is still "to pay", so it can be paid — but one paid singly cannot be paid again.
      await admin.session.form(`/payment-requests/${b.id}/pay`, { method: 'upi', reference: 'UPI12345' });
      const res = await payBatch(admin.session, [a.id, b.id], 3500.5);
      expect(res.status).toBe(409);
      expect((await PaymentRequest.findById(a.id).lean()).status).toBe('approved');
    });

    it('two admins at once (or a double click) pay it once, never half', async () => {
      const { a, b } = await threeForArbOneElsewhere();
      const admin2 = await makeUser('Owner2', 'admin');
      const results = await Promise.all([payBatch(admin.session, [a.id, b.id], 3500.5), payBatch(admin2.session, [a.id, b.id], 3500.5)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      for (const id of [a.id, b.id]) {
        const doc = await PaymentRequest.findById(id).lean();
        expect(doc.history.filter((h) => h.action === 'paid')).toHaveLength(1);
      }
      expect((await payBatch(admin.session, [a.id, b.id], 3500.5)).status).toBe(409);
    });

    it('refuses different accounts, accounts paying, and an empty tick list', async () => {
      const { a, other } = await threeForArbOneElsewhere();
      expect((await payBatch(admin.session, [a.id, other.id], 1999)).status).toBe(400);
      expect((await payBatch(accounts.session, [a.id], 1000)).status).toBe(403);
      expect((await payBatch(admin.session, [], 0)).status).toBe(400);
    });
  });

  describe('editing, optional UPI ID and reference', () => {
    const QR = { field: 'qr', buffer: JPEG, name: 'qr.jpg', type: 'image/jpeg' };
    async function raised(fields, files = []) {
      const order = await paidOrder();
      const item = String(order.items[0]._id);
      await wf.setStock(procurement.user, String(order._id), item, { stock: 'in_stock' }, req);
      const res = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [item], ...fields }, files);
      return res;
    }

    it('the requester corrects it while it waits for accounts; a teammate cannot; history says what changed', async () => {
      const r = (await raised({ amount: 1000, payee: OTHER_BANK })).body.request;
      expect(r.can.edit).toBe(true);
      expect(r.editableUntil).toBeTruthy();
      const res = await procurement.session.put(`/payment-requests/${r.id}`, { amount: 1200, description: 'Invoice 77' });
      expect(res.status).toBe(200);
      expect(res.body.request).toMatchObject({ amount: 1200, description: 'Invoice 77', status: 'submitted' });
      expect(res.body.request.history.at(-1)).toMatchObject({ action: 'edited', note: expect.stringContaining('₹1,000 → ₹1,200') });
      const mate = await makeUser('Pavan', 'staff', staff('procurement'));
      expect((await mate.session.put(`/payment-requests/${r.id}`, { amount: 5 })).status).toBe(403);
    });

    it('the time limit: not after accounts approves, nor after 24 hours', async () => {
      const r = (await raised({ amount: 1000, payee: OTHER_BANK })).body.request;
      await PaymentRequest.collection.updateOne({ _id: new mongoose.Types.ObjectId(r.id) }, { $set: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
      expect((await procurement.session.put(`/payment-requests/${r.id}`, { amount: 1100 })).status).toBe(403);
      const r2 = (await raised({ amount: 500, payee: OTHER_BANK })).body.request;
      await accounts.session.post(`/payment-requests/${r2.id}/approve`);
      expect((await procurement.session.put(`/payment-requests/${r2.id}`, { amount: 600 })).status).toBe(403);
    });

    it('the admin edits any unpaid one; changing the money sends it back to accounts; paid is never edited', async () => {
      const r = (await raised({ amount: 1000, payee: OTHER_BANK })).body.request;
      await accounts.session.post(`/payment-requests/${r.id}/approve`);
      const words = await admin.session.put(`/payment-requests/${r.id}`, { description: 'typo fixed' });
      expect(words.body.request.status).toBe('approved');
      const money = await admin.session.put(`/payment-requests/${r.id}`, { amount: 900 });
      expect(money.body.request).toMatchObject({ status: 'submitted', amount: 900 });
      await accounts.session.post(`/payment-requests/${r.id}/approve`);
      await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'bank' });
      expect((await admin.session.put(`/payment-requests/${r.id}`, { amount: 1 })).status).toBe(403);
    });

    it('switching to a saved supplier copies its details; two edits at once land once', async () => {
      const s = await addSupplier();
      const r = (await raised({ amount: 1000, payee: OTHER_BANK })).body.request;
      const res = await procurement.session.put(`/payment-requests/${r.id}`, { supplierId: s.id });
      expect(res.body.request.payee).toMatchObject({ name: 'ARB Supplies', accountNumber: '123456789012' });
      const both = await Promise.all([
        procurement.session.put(`/payment-requests/${r.id}`, { amount: 1500 }),
        procurement.session.put(`/payment-requests/${r.id}`, { amount: 1600 }),
      ]);
      expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
    });

    it('UPI ID is optional when their QR is attached; without either it is refused', async () => {
      expect((await raised({ amount: 300, payee: { name: 'Kumar Tyres', method: 'upi' } })).status).toBe(400);
      const ok = await raised({ amount: 300, payee: { name: 'Kumar Tyres', method: 'upi' } }, [QR]);
      expect(ok.status).toBe(201);
      expect(ok.body.request.payee.upiId).toBe('');
    });

    it('two QR-only payees are never grouped as one account, and pay without a reference', async () => {
      const a = (await raised({ amount: 300, payee: { name: 'Kumar Tyres', method: 'upi' } }, [QR])).body.request;
      const b = (await raised({ amount: 400, payee: { name: 'Kumar Tyres', method: 'upi' } }, [QR])).body.request;
      await accounts.session.post(`/payment-requests/${a.id}/approve`);
      await accounts.session.post(`/payment-requests/${b.id}/approve`);
      const groups = (await admin.session.get('/payment-requests/to-pay/suppliers')).body.groups;
      expect(groups.map((g) => g.count)).toEqual([1, 1]);
      expect((await payBatch(admin.session, [a.id, b.id], 700)).status).toBe(400);
      const paid = await payBatch(admin.session, [a.id], 300, { reference: '' });
      expect(paid.status).toBe(200);
      expect((await PaymentRequest.findById(a.id).lean()).payment.reference).toBe('');
    });
  });

  describe('the admin corrects a paid payment record', () => {
    const SHOT = { field: 'proof', buffer: JPEG, name: 'right.jpg', type: 'image/jpeg' };
    async function paidOne() {
      const r = await approvedPayment({ amount: 1000, payee: OTHER_BANK });
      const paid = await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'upi', reference: 'WRONG123' }, [{ field: 'proof', buffer: JPEG, name: 'wrong.jpg', type: 'image/jpeg' }]);
      expect(paid.status).toBe(200);
      return paid.body.request;
    }

    it('changes how it was paid, the reference and the screenshots — never the amount or payee', async () => {
      const r = await paidOne();
      expect(r.can.editPayment).toBe(true);
      const wrong = r.files.find((f) => f.kind === 'proof');
      const res = await admin.session.formPut(`/payment-requests/${r.id}/payment`,
        { method: 'bank', reference: 'UTR777888', removeFileIds: [wrong.id], amount: 1, note: 'Typed the wrong UTR' }, [SHOT]);
      expect(res.status).toBe(200);
      const doc = await PaymentRequest.findById(r.id).lean();
      expect(doc.payment).toMatchObject({ method: 'bank', reference: 'UTR777888' });
      expect(doc.amount).toBe(1000);
      expect(doc.payee.accountNumber).toBe(OTHER_BANK.accountNumber);
      expect(doc.files.filter((f) => f.kind === 'proof').map((f) => f.name)).toEqual(['right.jpg']);
      expect(doc.history.at(-1)).toMatchObject({ action: 'payment_edited', note: expect.stringContaining('WRONG123 → UTR777888') });
      expect([...stored.keys()].some((k) => k.includes('wrong'))).toBe(false); // old screenshot deleted
    });

    it('only the admin, only once paid', async () => {
      const r = await paidOne();
      expect((await accounts.session.formPut(`/payment-requests/${r.id}/payment`, { reference: 'X1234' })).status).toBe(403);
      const notPaid = await approvedPayment({ amount: 500, payee: OTHER_BANK });
      expect((await admin.session.formPut(`/payment-requests/${notPaid.id}/payment`, { reference: 'X1234' })).status).toBe(409);
    });

    it('a payment made in one transfer with others is corrected together', async () => {
      const s = await addSupplier();
      const a = await approvedPayment({ amount: 1000, supplierId: s.id });
      const b = await approvedPayment({ amount: 2000, supplierId: s.id });
      expect((await payBatch(admin.session, [a.id, b.id], 3000)).status).toBe(200);
      const res = await admin.session.formPut(`/payment-requests/${a.id}/payment`, { reference: 'UTR-FIXED-1' });
      expect(res.status).toBe(200);
      const [da, db] = await Promise.all([PaymentRequest.findById(a.id).lean(), PaymentRequest.findById(b.id).lean()]);
      expect([da.payment.reference, db.payment.reference]).toEqual(['UTR-FIXED-1', 'UTR-FIXED-1']);
      expect(db.history.at(-1).note).toMatch(/whole transfer/);
    });
  });
});
