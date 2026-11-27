/**
 * Payment race guards (services/paymentRequestService.js), over HTTP with a real Mongo:
 *   - one open supplier payment per item, even when several are raised at the same moment
 *   - Pay is recorded only with the amount and payee the admin saw (payVersion + a pinned compare-and-set)
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
  s.form('/payment-requests/expenses', { category: 'other', amount: 1250.5, description: 'Diesel for delivery van', payee: UPI, ...over }, files);

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

describe('Payment race guards', () => {
  beforeAll(async () => { await dbHandler.connect(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, ops, procurement;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
  });

  describe('one open supplier payment per item, even when raised at the same moment', () => {
    // Regression: 3 sent at once were all saved (the "already raised?" check was read-then-write).
    it('three at once for the same item: one is saved, the others are refused; their bills are not kept', async () => {
      const order = await paidOrder();
      const [kit] = order.items.map((i) => String(i._id));
      await wf.setStock(procurement.user, String(order._id), kit, { stock: 'in_stock' }, req);
      const bill = [{ field: 'bill', buffer: JPEG, name: 'bill.jpg', type: 'image/jpeg' }];
      const out = await Promise.all([1, 2, 3].map((n) => procurement.session.form('/payment-requests/supplier',
        { orderId: String(order._id), itemIds: [kit], amount: 100 * n, payee: BANK }, bill)));
      expect(out.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(out.filter((r) => r.status === 409).every((r) => /already/.test(r.body.message))).toBe(true);
      expect(await PaymentRequest.countDocuments({ kind: 'supplier' })).toBe(1);
      expect(stored.size).toBe(1);
    });

    it('different items of one order raised at once are all saved', async () => {
      const order = await paidOrder();
      const [kit, mat] = order.items.map((i) => String(i._id));
      for (const id of [kit, mat]) await wf.setStock(procurement.user, String(order._id), id, { stock: 'in_stock' }, req);
      const out = await Promise.all([kit, mat].map((id) => procurement.session.form('/payment-requests/supplier',
        { orderId: String(order._id), itemIds: [id], amount: 100, payee: BANK })));
      expect(out.map((r) => r.status)).toEqual([201, 201]);
    });
  });

  describe('Pay records only the figures the admin saw', () => {
    const proof = [{ field: 'proof', buffer: JPEG, name: 'p.jpg', type: 'image/jpeg' }];

    // Regression: an edit after the admin opened the request was recorded as paid with the new figures.
    it('the amount changed after opening: Pay is refused, nothing is paid; with the new version it pays', async () => {
      // Still waiting for accounts (the admin may pay a waiting one; an approved one is locked to edits).
      const r = (await expense(ops.session)).body.request;
      const seen = (await admin.session.get(`/payment-requests/${r.id}`)).body.request;
      expect(seen.payVersion).toMatch(/^[a-f0-9]{20}$/);
      // The requester raises the amount meanwhile.
      const edited = await ops.session.put(`/payment-requests/${r.id}`, { reason: "Correction", amount: 9999 });
      expect(edited.status).toBe(200);

      const stale = await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'upi', reference: 'UTR1', payVersion: seen.payVersion }, proof);
      expect(stale.status).toBe(409);
      expect(stale.body.message).toMatch(/changed since you opened/);
      expect((await PaymentRequest.findById(r.id).lean()).status).not.toBe('paid');
      expect(stored.size).toBe(1); // only the expense's bill — the refused screenshot was never stored

      const fresh = (await admin.session.get(`/payment-requests/${r.id}`)).body.request;
      expect(fresh.amount).toBe(9999);
      const paid = await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'upi', reference: 'UTR1', payVersion: fresh.payVersion }, proof);
      expect(paid.status).toBe(200);
      expect(paid.body.request).toMatchObject({ status: 'paid', amount: 9999 });
    });

    it('a new bank account counts as a change too; a project link does not', async () => {
      const r = (await expense(ops.session, { payee: BANK, category: 'other', description: 'Parts' })).body.request;
      const seen = (await admin.session.get(`/payment-requests/${r.id}`)).body.request;
      await ops.session.post(`/payment-requests/${r.id}/links`, { reference: 'INV-1' });
      expect((await admin.session.get(`/payment-requests/${r.id}`)).body.request.payVersion).toBe(seen.payVersion);
      await ops.session.put(`/payment-requests/${r.id}`, { reason: "Correction", payee: { ...BANK, accountNumber: '999988887777' } });
      const stale = await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'bank', reference: 'UTR2', payVersion: seen.payVersion }, proof);
      expect(stale.status).toBe(409);
    });

    it('only the payer is given the version; paying without one (an old tab) still works', async () => {
      const r = (await expense(ops.session)).body.request;
      expect((await ops.session.get(`/payment-requests/${r.id}`)).body.request.payVersion).toBeUndefined();
      expect((await accounts.session.get(`/payment-requests/${r.id}`)).body.request.payVersion).toBeUndefined();
      const paid = await admin.session.form(`/payment-requests/${r.id}/pay`, { method: 'upi', reference: 'UTR3' }, proof);
      expect(paid.body.request.status).toBe('paid');
    });
  });
});

// Older payment cases are not about the 30% minimum (tests/supplierMargin.test.js is).
withoutMinimumMargin();
