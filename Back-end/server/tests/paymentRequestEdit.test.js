/**
 * Editing a payment request before approval (services/paymentRequestService.js update),
 * over HTTP with a real Mongo: who may, when, the reason and history, attachments,
 * on-hold / declined going back to accounts, the edit-vs-approve race, linked totals.
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
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: paymentRequestRepository } = await import('../repositories/paymentRequestRepository.js');
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
    form: (url, fields = {}, files = [], method = 'post') => {
      let r = agent[method](`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
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

describe('Edit a payment until accounts approves it (owner 2026-11-21)', () => {
  beforeAll(async () => { await dbHandler.connect(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, ops, opsHead, opsMate, procurement;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    opsHead = await makeUser('Hari', 'staff', staff('operations', true));
    opsMate = await makeUser('Mini', 'staff', staff('operations'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
  });
  const edit = (s, id, body) => s.put(`/payment-requests/${id}`, { reason: 'Wrong bill amount', ...body });
  const raised = async (over) => {
    const res = await expense(ops.session, over);
    expect(res.status).toBe(201);
    return res.body.request;
  };

  describe('who and when', () => {
    it('the submitter edits while it waits; it stays waiting', async () => {
      const r = await raised();
      expect(r.can.edit).toBe(true);
      const res = await edit(ops.session, r.id, { amount: 1100 });
      expect(res.status).toBe(200);
      expect(res.body.request).toMatchObject({ amount: 1100, status: 'submitted', rev: 1 });
    });

    it('the admin can edit it too; a teammate, the team head and accounts cannot', async () => {
      const r = await raised();
      expect((await edit(admin.session, r.id, { amount: 900 })).status).toBe(200);
      for (const s of [opsMate.session, opsHead.session, accounts.session]) {
        expect((await edit(s, r.id, { amount: 1 })).status).toBe(403);
      }
      const asHead = (await opsHead.session.get(`/payment-requests/${r.id}`)).body.request;
      expect(asHead.can.edit).toBe(false);
      expect((await PaymentRequest.findById(r.id).lean()).amount).toBe(900);
    });

    it('locked once approved — for the submitter and the admin — and once paid or cancelled', async () => {
      const a = await raised();
      expect((await accounts.session.post(`/payment-requests/${a.id}/approve`)).body.request.can.edit).toBe(false);
      const mine = await edit(ops.session, a.id, { amount: 1 });
      expect(mine.status).toBe(403);
      expect(mine.body.message).toMatch(/approved this payment/);
      expect((await edit(admin.session, a.id, { description: 'typo' })).status).toBe(403);
      await admin.session.form(`/payment-requests/${a.id}/pay`, { method: 'upi', reference: 'UTR1' });
      expect((await edit(admin.session, a.id, { amount: 1 })).status).toBe(403);
      const c = await raised();
      await ops.session.post(`/payment-requests/${c.id}/cancel`);
      expect((await edit(ops.session, c.id, { amount: 1 })).status).toBe(403);
      expect((await PaymentRequest.findById(a.id).lean()).amount).toBe(1250.5);
    });

    it('a reason is required', async () => {
      const r = await raised();
      const res = await ops.session.put(`/payment-requests/${r.id}`, { amount: 1100 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/why/);
      expect((await PaymentRequest.findById(r.id).lean()).amount).toBe(1250.5);
    });
  });

  describe('history', () => {
    it('keeps old → new, who, when and why; accounts sees "edited" and the history', async () => {
      const r = await raised();
      await edit(ops.session, r.id, { amount: 1100, category: 'travel', description: 'Taxi to the warehouse', reason: 'Picked the wrong option' });
      const seen = (await accounts.session.get(`/payment-requests/${r.id}`)).body.request;
      expect(seen.editedAt).toBeTruthy();
      expect(seen.edits).toHaveLength(1);
      expect(seen.edits[0]).toMatchObject({ byName: 'Omar', reason: 'Picked the wrong option', fromStatus: 'submitted' });
      expect(seen.edits[0].changes).toEqual(expect.arrayContaining([
        { field: 'Amount', from: '₹1,250.5', to: '₹1,100' },
        { field: 'What for', from: 'Fuel', to: 'Travel' },
        { field: 'Details', from: 'Diesel for delivery van', to: 'Taxi to the warehouse' },
      ]));
      expect(seen.history.at(-1)).toMatchObject({ action: 'edited', note: expect.stringContaining('Picked the wrong option') });
      // Lists carry the tag, not the whole history.
      const row = (await accounts.session.get('/payment-requests')).body.requests.find((x) => x.id === r.id);
      expect(row.editedAt).toBeTruthy();
      expect(row.edits).toBeUndefined();
    });

    it('a changed bank account is recorded masked', async () => {
      const r = await raised({ payee: BANK, category: 'other', description: 'Parts' });
      await edit(ops.session, r.id, { payee: { ...BANK, accountNumber: '999988887777' } });
      const [c] = (await PaymentRequest.findById(r.id).lean()).edits[0].changes.filter((x) => x.field === 'Payment details');
      expect(c.from).toMatch(/9012/);
      expect(c.to).toMatch(/7777/);
      expect(`${c.from} ${c.to}`).not.toMatch(/123456789012|999988887777/);
    });

    it('a double-submitted edit (same form key) is saved once', async () => {
      const r = await raised();
      const one = await edit(ops.session, r.id, { amount: 1100, formKey: 'k-1' });
      const two = await edit(ops.session, r.id, { amount: 1100, formKey: 'k-1' });
      expect([one.status, two.status]).toEqual([200, 200]);
      const doc = await PaymentRequest.findById(r.id).lean();
      expect(doc.edits).toHaveLength(1);
      expect(doc.rev).toBe(1);
    });
  });

  describe('attachments', () => {
    it('a bill can be removed and a new one added; payment screenshots never', async () => {
      const r = await raised();
      const [oldBill] = r.files;
      const res = await ops.session.form(`/payment-requests/${r.id}`,
        { reason: 'Clearer bill', removeFileIds: [oldBill.id] },
        [{ field: 'bill', buffer: PDF, name: 'invoice-77.pdf', type: 'application/pdf' }], 'put');
      expect(res.status).toBe(200);
      expect(res.body.request.files.map((f) => f.name)).toEqual(['invoice-77.pdf']);
      expect(stored.size).toBe(1); // the old bill is gone from storage, the new one kept
      const doc = await PaymentRequest.findById(r.id).lean();
      expect(doc.edits[0].changes.map((c) => c.field)).toEqual(['Attachment removed', 'Attachment added']);
    });

    it('a refused edit keeps nothing it uploaded', async () => {
      const r = await raised();
      await accounts.session.post(`/payment-requests/${r.id}/approve`);
      const before = stored.size;
      const res = await ops.session.form(`/payment-requests/${r.id}`, { reason: 'More' },
        [{ field: 'bill', buffer: PDF, name: 'late.pdf', type: 'application/pdf' }], 'put');
      expect(res.status).toBe(403);
      expect(stored.size).toBe(before);
    });
  });

  describe('on hold and declined go back to accounts', () => {
    it('editing an on-hold payment sends it back as waiting, with accounts told in chat', async () => {
      const r = await raised();
      await accounts.session.post(`/payment-requests/${r.id}/approve`);
      await accounts.session.post(`/payment-requests/${r.id}/hold`, { note: 'Bill is unreadable' });
      const res = await edit(ops.session, r.id, { reason: 'Here is the readable one', amount: 1250.5 });
      expect(res.status).toBe(200);
      expect(res.body.request).toMatchObject({ status: 'submitted', decisionNote: '' });
      expect(res.body.request.history.at(-1)).toMatchObject({ action: 'resubmitted' });
      const doc = await PaymentRequest.findById(r.id).lean();
      expect(doc.approvedBy).toBeNull();
      expect(doc.edits[0].fromStatus).toBe('on_hold');
      expect((await accounts.session.get(`/payment-requests/${r.id}`)).body.request.can.approve).toBe(true);
    });

    it('a declined expense can be corrected and sent again — the same PR', async () => {
      const r = await raised();
      await accounts.session.post(`/payment-requests/${r.id}/decline`, { note: 'Amount does not match the bill' });
      expect((await ops.session.get(`/payment-requests/${r.id}`)).body.request.can.edit).toBe(true);
      const res = await edit(ops.session, r.id, { amount: 1200, reason: 'Fixed to match the bill' });
      expect(res.status).toBe(200);
      expect(res.body.request).toMatchObject({ number: r.number, status: 'submitted', amount: 1200 });
      expect((await accounts.session.post(`/payment-requests/${r.id}/approve`)).status).toBe(200);
    });

    // Regression (rebase onto #588): a declined "Mark paid" expense reopens its cycle;
    // resending it too could pay that cycle twice, and its money follows the item's rules.
    it('a subscription expense ("Mark paid") is never edited here — waiting or declined', async () => {
      const r = await raised();
      await PaymentRequest.updateOne({ _id: r.id }, { $set: { subscription: {
        item: new mongoose.Types.ObjectId(), number: 'SUB-0001', name: 'Zoho', cycle: new mongoose.Types.ObjectId(), cycleDueDate: '2026-11-20',
      } } });
      expect((await ops.session.get(`/payment-requests/${r.id}`)).body.request.can.edit).toBe(false);
      const waiting = await edit(ops.session, r.id, { amount: 1, reason: 'Wrong amount' });
      expect(waiting.status).toBe(409);
      expect(waiting.body.message).toMatch(/mark it paid again/);
      await admin.session.post(`/payment-requests/${r.id}/decline`, { note: 'Wrong invoice attached' });
      expect((await edit(admin.session, r.id, { amount: 1, reason: 'Wrong amount' })).status).toBe(409);
      const doc = await PaymentRequest.findById(r.id).lean();
      expect(doc).toMatchObject({ status: 'declined', amount: r.amount, rev: 0 });
      expect(doc.edits).toEqual([]);
    });

    it('a declined supplier payment sent again marks its item "payment pending" again; not while another payment covers it', async () => {
      const order = await paidOrder();
      const [kit] = order.items.map((i) => String(i._id));
      await wf.setStock(procurement.user, String(order._id), kit, { stock: 'in_stock' }, req);
      const raise = (amount) => procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [kit], amount, payee: BANK });
      const first = (await raise(1000)).body.request;
      await accounts.session.post(`/payment-requests/${first.id}/decline`, { note: 'Wrong supplier price' });
      const stageOf = async () => (await procurement.session.get(`/payment-requests/order/${order._id}`)).body;
      const back = await edit(procurement.session, first.id, { amount: 900, reason: 'Supplier confirmed ₹900' });
      expect(back.status).toBe(200);
      expect(back.body.request.status).toBe('submitted');
      const line = (await Order.findById(order._id).lean()).workflow.lines.find((l) => String(l.itemId) === kit);
      expect(line.supplierPaymentRef).toBe(first.number);
      expect((await stageOf()).requests.find((x) => x.id === first.id).amount).toBe(900);

      // Declined again, and meanwhile a new payment covers the item: it cannot be sent again.
      await accounts.session.post(`/payment-requests/${first.id}/decline`, { note: 'Still wrong' });
      expect((await raise(950)).status).toBe(201);
      const clash = await edit(procurement.session, first.id, { amount: 800 });
      expect(clash.status).toBe(409);
      expect((await PaymentRequest.findById(first.id).lean()).status).toBe('declined');
    });
  });

  describe('an edit racing an approval: exactly one wins', () => {
    it('approve with the version accounts saw fails if an edit landed first', async () => {
      const r = await raised();
      const seen = (await accounts.session.get(`/payment-requests/${r.id}`)).body.request;
      await edit(ops.session, r.id, { amount: 99999 });
      const stale = await accounts.session.post(`/payment-requests/${r.id}/approve`, { rev: seen.rev });
      expect(stale.status).toBe(409);
      expect(stale.body.message).toMatch(/edited since you opened/);
      expect((await PaymentRequest.findById(r.id).lean()).status).toBe('submitted');
      const fresh = (await accounts.session.get(`/payment-requests/${r.id}`)).body.request;
      expect((await accounts.session.post(`/payment-requests/${r.id}/approve`, { rev: fresh.rev })).status).toBe(200);
    });

    it('both at the same moment, many times: never an approved request with unseen figures', async () => {
      for (let i = 0; i < 10; i += 1) {
        const r = await raised();
        const seen = (await accounts.session.get(`/payment-requests/${r.id}`)).body.request;
        const [e, a] = await Promise.all([
          edit(ops.session, r.id, { amount: 2000 + i }),
          accounts.session.post(`/payment-requests/${r.id}/approve`, { rev: seen.rev }),
        ]);
        // Exactly one wins. A losing edit reads 409 (lost the write) or 403 (read it already approved).
        expect([e.status, a.status].filter((x) => x === 200)).toHaveLength(1);
        expect([e.status, a.status].every((x) => [200, 403, 409].includes(x))).toBe(true);
        const doc = await PaymentRequest.findById(r.id).lean();
        if (a.status === 200) expect(doc).toMatchObject({ status: 'approved', amount: 1250.5, rev: 0 });
        else expect(doc).toMatchObject({ status: 'submitted', amount: 2000 + i, rev: 1 });
      }
    });

    it('two edits at once from an old form: one lands', async () => {
      const r = await raised();
      const both = await Promise.all([edit(ops.session, r.id, { amount: 1500, rev: 0 }), edit(admin.session, r.id, { amount: 1600, rev: 0 })]);
      expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
      expect((await PaymentRequest.findById(r.id).lean()).edits).toHaveLength(1);
    });
  });

  describe('linked totals follow the edit', () => {
    it("the order's and the project's money read the new amount", async () => {
      const order = await paidOrder();
      const r = await raised({ orderId: String(order._id) });
      const project = new mongoose.Types.ObjectId();
      await PaymentRequest.updateOne({ _id: r.id }, { $set: { project, projectCode: 'PRJ-0001' } });
      await edit(ops.session, r.id, { amount: 700 });
      const onOrder = (await ops.session.get(`/payment-requests/order/${order._id}`)).body.requests.find((x) => x.id === r.id);
      expect(onOrder.amount).toBe(700);
      const totals = await paymentRequestRepository.totalsForProject(project);
      expect(totals.find((t) => t._id === 'submitted').amount).toBe(700);
    });
  });
});
