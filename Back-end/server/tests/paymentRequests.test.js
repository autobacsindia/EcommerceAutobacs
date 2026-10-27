/**
 * Payment requests over HTTP (routes/paymentRequests.js), through the real
 * workflow for supplier payments. Private storage and the job queue are
 * doubles; Mongo, auth, CSRF and chat are real.
 *
 * What must hold:
 *   - only procurement raises supplier payments; only operations / marketing raise expenses
 *   - ONE path for every team: accounts approves or declines, the admin pays.
 *     Accounts cannot pay; an admin paying a waiting request approves it in the
 *     same step. Either of them may put an approved request on hold.
 *   - the bell counts only what is the viewer's own job
 *   - every step happens once (double click → 409), and is in the history
 *   - a team sees only its own requests; admin and accounts see all; bank numbers
 *     are masked for anyone outside the approval chain and the requester
 *   - a supplier payment in flight holds its items back from shipping; once paid, they ship
 *   - files are checked by their bytes; slips and receipts download as PDFs
 *   - each step is posted in chat, threaded by request
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

describe('Payment requests', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, ops, ops2, marketing, procurement, gtmLead;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    ops2 = await makeUser('Ola', 'staff', staff('operations'));
    marketing = await makeUser('Mira', 'staff', staff('marketing'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    gtmLead = await makeUser('Sam', 'staff', staff('sales'));
  });

  describe('raising an expense', () => {
    it('a team raises one; it starts with accounts, numbered, with the bill stored privately', async () => {
      const res = await expense(ops.session);
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({
        number: 'PR-0001', kind: 'expense', status: 'submitted', team: 'operations', amount: 1250.5, category: 'fuel',
        requestedBy: 'Omar', payee: { name: 'Fuel Station', method: 'upi', upiId: 'fuelstation@okaxis' },
      });
      expect(res.body.request.files).toEqual([expect.objectContaining({ kind: 'bill', contentType: 'image/jpeg' })]);
      expect([...stored.keys()][0]).toMatch(/^payment-requests\//);
      expect((await expense(marketing.session, { category: 'purchase', description: 'Banner printing' })).status).toBe(201);
    });

    /*
      EVERY team may claim. It used to be Operations and Marketing only, which
      meant GTM paid for its own fuel and Procurement could not claim a courier
      charge — the rule did not match how the company spends. Who may APPROVE is
      untouched (accounts) and is covered below: widening who can ask must not
      widen who can decide.
    */
    it('every team can raise an expense, including one added later', async () => {
      for (const who of [procurement, accounts, gtmLead]) {
        expect((await expense(who.session)).status).toBe(201);
      }
      const developer = await makeUser('Dev', 'staff', staff('developer'));
      const raised = await expense(developer.session);
      expect(raised.status).toBe(201);
      expect(raised.body.request.team).toBe('developer');
    });

    it('a team that is not a real team is refused', async () => {
      const outsider = await makeUser('Nobody', 'staff', staff('operations'));
      // Inactive staff are not staff, whatever team they name.
      await User.updateOne({ _id: outsider.user._id }, { $set: { 'staff.active': false } });
      expect((await expense(outsider.session)).status).toBe(403);
    });

    it('checks the amount, payee and files', async () => {
      expect((await expense(ops.session, { amount: 0 })).status).toBe(400);
      expect((await expense(ops.session, { amount: 20000000 })).status).toBe(400);
      expect((await expense(ops.session, { payee: { ...UPI, upiId: 'not-a-upi' } })).status).toBe(400);
      expect((await expense(ops.session, { payee: { ...BANK, ifsc: 'HDFC1234' } })).status).toBe(400);
      expect((await expense(ops.session, { category: 'party' })).status).toBe(400);
      // A file whose bytes are not a photo or a PDF, whatever its name says.
      expect((await expense(ops.session, {}, [{ field: 'bill', buffer: Buffer.from('hello world, not an image'), name: 'bill.jpg', type: 'image/jpeg' }])).status).toBe(400);
      expect(stored.size).toBe(0);
      // A PDF bill is fine.
      expect((await expense(ops.session, {}, [{ field: 'bill', buffer: PDF, name: 'bill.pdf', type: 'application/pdf' }])).status).toBe(201);
    });

    const bills = (count) => Array.from({ length: count }, (_, i) => ({ field: 'bill', buffer: i % 2 ? PDF : JPEG, name: `bill-${i}.${i % 2 ? 'pdf' : 'jpg'}`, type: i % 2 ? 'application/pdf' : 'image/jpeg' }));

    it('takes up to five bills plus the payee QR, in the order they were attached', async () => {
      const res = await expense(ops.session, {}, [...bills(5), { field: 'qr', buffer: JPEG, name: 'qr.jpg', type: 'image/jpeg' }]);
      expect(res.status).toBe(201);
      expect(res.body.request.files.map((f) => [f.kind, f.name])).toEqual([
        ['bill', 'bill-0.jpg'], ['bill', 'bill-1.pdf'], ['bill', 'bill-2.jpg'], ['bill', 'bill-3.pdf'], ['bill', 'bill-4.jpg'], ['qr', 'qr.jpg'],
      ]);
    });

    it('refuses a sixth bill — and stores none of them', async () => {
      const before = stored.size;
      const res = await expense(ops.session, {}, bills(6));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/up to 5 bills/);
      expect(stored.size).toBe(before);
    });

    it('one bad file among several stores nothing (no half-saved request)', async () => {
      const before = stored.size;
      const count = await PaymentRequest.countDocuments();
      const res = await expense(ops.session, {}, [...bills(2), { field: 'bill', buffer: Buffer.from('not a file at all'), name: 'x.jpg', type: 'image/jpeg' }]);
      expect(res.status).toBe(400);
      expect(stored.size).toBe(before);
      expect(await PaymentRequest.countDocuments()).toBe(count);
    });
  });

  describe('approval and payment', () => {
    const raise = async () => (await expense(ops.session, { payee: BANK })).body.request.id;

    it('accounts approves, then the ADMIN pays with a reference and screenshot — each once', async () => {
      const id = await raise();
      expect((await ops.session.get(`/payment-requests/${id}`)).body.request).toMatchObject({ approver: 'accounts', statusLabel: 'Waiting for accounts approval' });
      // The team that raised it has no say in either half of the decision.
      expect((await ops.session.post(`/payment-requests/${id}/approve`)).status).toBe(403);
      expect((await ops.session.post(`/payment-requests/${id}/decline`, { note: 'Not needed' })).status).toBe(403);
      expect((await ops.session.form(`/payment-requests/${id}/pay`, { method: 'razorpay', reference: 'pout_ABC123' })).status).toBe(403);

      const approved = await accounts.session.post(`/payment-requests/${id}/approve`, { note: 'OK' });
      expect(approved.status).toBe(200);
      expect(approved.body.request.status).toBe('approved');
      expect((await accounts.session.post(`/payment-requests/${id}/approve`)).status).toBe(409);

      // Approving is NOT paying: the money leaves on the admin's action alone.
      expect((await accounts.session.form(`/payment-requests/${id}/pay`, { method: 'razorpay', reference: 'pout_ABC123' })).status).toBe(403);
      expect((await admin.session.form(`/payment-requests/${id}/pay`, { method: 'nope', reference: '' })).status).toBe(400);
      const paid = await admin.session.form(`/payment-requests/${id}/pay`, { method: 'razorpay', reference: 'pout_ABC123' },
        [{ field: 'proof', buffer: JPEG, name: 'paid.jpg', type: 'image/jpeg' }]);
      expect(paid.status).toBe(200);
      expect(paid.body.request).toMatchObject({ status: 'paid', payment: { method: 'razorpay', reference: 'pout_ABC123', paidByName: 'Owner' } });
      expect(paid.body.request.files.map((f) => f.kind)).toEqual(['bill', 'proof']);
      expect((await admin.session.form(`/payment-requests/${id}/pay`, { method: 'razorpay', reference: 'pout_DUP' })).status).toBe(409);

      const saved = await PaymentRequest.findById(id).lean();
      expect(saved.history.map((h) => [h.action, h.byName])).toEqual([['submitted', 'Omar'], ['approved', 'Anu'], ['paid', 'Owner']]);
      expect((await ops.session.get(`/payment-requests/${id}`)).body.request.status).toBe('paid');
    });

    it('the admin can attach up to three payment screenshots; a fourth is refused', async () => {
      const id = await raise();
      const shot = (i) => ({ field: 'proof', buffer: i === 1 ? PDF : JPEG, name: `paid-${i}.${i === 1 ? 'pdf' : 'jpg'}`, type: i === 1 ? 'application/pdf' : 'image/jpeg' });
      const before = stored.size;
      const tooMany = await admin.session.form(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR99887766' }, [0, 1, 2, 3].map(shot));
      expect(tooMany.status).toBe(400);
      expect(stored.size).toBe(before);
      expect((await PaymentRequest.findById(id).lean()).status).toBe('submitted');

      const paid = await admin.session.form(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR99887766' }, [0, 1, 2].map(shot));
      expect(paid.status).toBe(200);
      expect(paid.body.request.files.map((f) => [f.kind, f.name])).toEqual([
        ['bill', 'bill.jpg'], ['proof', 'paid-0.jpg'], ['proof', 'paid-1.pdf'], ['proof', 'paid-2.jpg'],
      ]);
      expect(stored.size).toBe(before + 3);
    });

    it('screenshots sent with a payment that lost the race are removed again', async () => {
      const id = await raise();
      expect((await admin.session.form(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR11112222' })).status).toBe(200);
      const before = stored.size;
      const late = await admin.session.form(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR33334444' },
        [{ field: 'proof', buffer: JPEG, name: 'a.jpg', type: 'image/jpeg' }, { field: 'proof', buffer: PDF, name: 'b.pdf', type: 'application/pdf' }]);
      expect(late.status).toBe(409);
      expect(stored.size).toBe(before);
    });

    it('an admin may pay a waiting request straight away — that approves it too', async () => {
      const id = await raise();
      const paid = await admin.session.form(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR12345678' });
      expect(paid.status).toBe(200);
      expect(paid.body.request.status).toBe('paid');
      const saved = await PaymentRequest.findById(id).lean();
      expect(String(saved.approvedBy)).toBe(String(admin.user._id));
    });

    it('a marketing expense takes the same path as every other team: accounts approves, admin pays', async () => {
      const a = (await expense(marketing.session, { category: 'purchase', description: 'Banner printing' })).body.request.id;
      const view = (await accounts.session.get(`/payment-requests/${a}`)).body.request;
      expect(view).toMatchObject({
        approver: 'accounts',
        statusLabel: 'Waiting for accounts approval',
        // Accounts decides but does not pay — that is the whole point of the split.
        can: expect.objectContaining({ approve: true, decline: true, pay: false }),
      });
      expect((await marketing.session.post(`/payment-requests/${a}/approve`)).status).toBe(403);
      expect((await accounts.session.post(`/payment-requests/${a}/approve`, { note: 'OK' })).body.request.status).toBe('approved');
      expect((await accounts.session.form(`/payment-requests/${a}/pay`, { method: 'upi', reference: 'UPI99887766' })).status).toBe(403);
      expect((await admin.session.form(`/payment-requests/${a}/pay`, { method: 'upi', reference: 'UPI99887766' })).body.request.status).toBe('paid');
      expect((await PaymentRequest.findById(a).lean()).history.map((h) => [h.action, h.byName])).toEqual([['submitted', 'Mira'], ['approved', 'Anu'], ['paid', 'Owner']]);

      // Paid straight from "waiting" by the admin: one step, recorded as approved by them.
      const b = (await expense(marketing.session, { category: 'purchase', description: 'Flyers' })).body.request.id;
      const paid = await admin.session.form(`/payment-requests/${b}/pay`, { method: 'bank', reference: 'UTR11223344' });
      expect(paid.body.request.status).toBe('paid');
      expect(String((await PaymentRequest.findById(b).lean()).approvedBy)).toBe(String(admin.user._id));
      // …once: a second press finds it already paid.
      expect((await admin.session.form(`/payment-requests/${b}/pay`, { method: 'bank', reference: 'UTR11223355' })).status).toBe(409);

      const c = (await expense(marketing.session, { category: 'purchase', description: 'Stickers' })).body.request.id;
      expect((await accounts.session.post(`/payment-requests/${c}/decline`, { note: 'Duplicate bill' })).body.request.status).toBe('declined');
    });

    it('there are two queues: what accounts must approve, and what the admin must pay', async () => {
      const waiting = await raise();
      const approved = await raise();
      await accounts.session.post(`/payment-requests/${approved}/approve`);
      const mktWaiting = (await expense(marketing.session, { category: 'purchase', description: 'Banner printing' })).body.request.id;

      // Accounts' queue: everything still waiting for a decision, any team.
      const toApprove = (await accounts.session.get('/payment-requests?status=to_approve')).body.requests.map((r) => r.id);
      expect(toApprove).toEqual(expect.arrayContaining([waiting, mktWaiting]));
      expect(toApprove).not.toContain(approved);

      // The admin's queue: only what has already been approved (or put on hold).
      const toPay = (await admin.session.get('/payment-requests?status=to_pay')).body.requests.map((r) => r.id);
      expect(toPay).toContain(approved);
      expect(toPay).not.toContain(waiting);
      expect(toPay).not.toContain(mktWaiting);
    });

    it('either accounts or the admin can hold an approved request; only the admin pays it', async () => {
      // Hold is a brake, not a payment, so both halves of the decision have it:
      // accounts parks a bill it is querying, the admin parks one they are not
      // ready to send. The requester never has it.
      const a = await raise();
      await accounts.session.post(`/payment-requests/${a}/approve`);
      expect((await ops.session.post(`/payment-requests/${a}/hold`, { note: 'Not yet please' })).status).toBe(403);
      expect((await accounts.session.post(`/payment-requests/${a}/hold`, {})).status).toBe(400);
      expect((await accounts.session.post(`/payment-requests/${a}/hold`, { note: 'Funds arrive Friday' })).body.request.status).toBe('on_hold');
      // Held or not, accounts still cannot be the one to pay it.
      expect((await accounts.session.form(`/payment-requests/${a}/pay`, { method: 'bank', reference: 'UTR998877' })).status).toBe(403);
      expect((await admin.session.form(`/payment-requests/${a}/pay`, { method: 'bank', reference: 'UTR998877' })).body.request.status).toBe('paid');

      const b = await raise();
      await accounts.session.post(`/payment-requests/${b}/approve`);
      expect((await admin.session.post(`/payment-requests/${b}/hold`, { note: 'Check with supplier' })).body.request.status).toBe('on_hold');
      expect((await accounts.session.post(`/payment-requests/${b}/decline`, { note: 'Duplicate bill' })).body.request).toMatchObject({ status: 'declined', decisionNote: 'Duplicate bill' });
    });

    it('declining needs a reason; the requester can cancel only while it waits for approval', async () => {
      const a = await raise();
      expect((await accounts.session.post(`/payment-requests/${a}/decline`, {})).status).toBe(400);
      expect((await ops2.session.post(`/payment-requests/${a}/cancel`)).status).toBe(403); // same team, not the requester or head
      expect((await ops.session.post(`/payment-requests/${a}/cancel`)).body.request.status).toBe('cancelled');
      const b = await raise();
      await accounts.session.post(`/payment-requests/${b}/approve`);
      expect((await ops.session.post(`/payment-requests/${b}/cancel`)).status).toBe(409);
    });
  });

  describe('who sees what', () => {
    it('a team sees its own; admin and accounts see all; bank numbers masked outside the chain', async () => {
      const opsReq = (await expense(ops.session, { payee: BANK })).body.request.id;
      await expense(marketing.session, { description: 'Stickers' });

      expect((await ops.session.get('/payment-requests')).body.requests.map((r) => r.team)).toEqual(['operations']);
      expect((await marketing.session.get(`/payment-requests/${opsReq}`)).status).toBe(404);
      expect((await procurement.session.get(`/payment-requests/${opsReq}/slip`)).status).toBe(404);
      expect((await accounts.session.get('/payment-requests')).body.requests).toHaveLength(2);
      expect((await admin.session.get('/payment-requests?team=marketing')).body.requests).toHaveLength(1);

      expect((await ops.session.get(`/payment-requests/${opsReq}`)).body.request.payee.accountNumber).toBe('123456789012'); // requester
      expect((await accounts.session.get(`/payment-requests/${opsReq}`)).body.request.payee.accountNumber).toBe('123456789012');
      expect((await ops2.session.get(`/payment-requests/${opsReq}`)).body.request.payee.accountNumber).toBe('XXXXXXXX9012'); // teammate
    });

    it('files stream to people who may see the request, and to no one else', async () => {
      const r = (await expense(ops.session)).body.request;
      const file = await accounts.session.get(`/payment-requests/${r.id}/files/${r.files[0].id}`);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toMatch(/image\/jpeg/);
      expect((await marketing.session.get(`/payment-requests/${r.id}/files/${r.files[0].id}`)).status).toBe(404);
    });

    it('the slip is a PDF, and becomes a receipt once paid', async () => {
      const id = (await expense(ops.session)).body.request.id;
      const slip = await ops.session.get(`/payment-requests/${id}/slip`).buffer(true).parse((res, cb) => {
        const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(slip.status).toBe(200);
      expect(slip.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(slip.headers['content-disposition']).toMatch(/Payment-request-PR-\d+\.pdf/);
      await accounts.session.post(`/payment-requests/${id}/approve`);
      await admin.session.form(`/payment-requests/${id}/pay`, { method: 'upi', reference: 'UPI12345678' });
      expect((await ops.session.get(`/payment-requests/${id}/slip`)).headers['content-disposition']).toMatch(/Receipt-PR-\d+\.pdf/);
    });
  });

  describe('supplier payments', () => {
    it('raised → Payment Pending; paid → Ordered From Supplier; cancelled → back where it was', async () => {
      const order = await paidOrder();
      const [kit] = order.items.map((i) => String(i._id));
      await wf.setStock(procurement.user, String(order._id), kit, { stock: 'in_stock' }, req);
      const lineOf = async () => (await Order.findById(order._id).lean()).workflow.lines.find((l) => String(l.itemId) === kit);
      const stageOf = async () => (await wf.getOrder(procurement.user, String(order._id))).lines.find((l) => l.itemId === kit).stage;

      const first = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [kit], amount: 100, payee: BANK });
      expect(first.status).toBe(201);
      expect(await stageOf()).toBe('payment_pending');
      expect(await lineOf()).toMatchObject({ supplierName: 'ARB Supplies', supplierPaymentRef: first.body.request.number });
      expect((await procurement.session.post(`/payment-requests/${first.body.request.id}/cancel`)).status).toBe(200);
      expect(await stageOf()).toBe('to_ship'); // back to In Stock

      const second = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [kit], amount: 90, payee: { ...BANK, name: 'India Motor Stores' } });
      expect(await stageOf()).toBe('payment_pending');
      await accounts.session.post(`/payment-requests/${second.body.request.id}/approve`);
      expect(await stageOf()).toBe('payment_pending'); // approved is not paid
      expect((await admin.session.form(`/payment-requests/${second.body.request.id}/pay`, { method: 'bank', reference: 'UTR12345' })).status).toBe(200);
      expect(await stageOf()).toBe('with_supplier');
      expect(await lineOf()).toMatchObject({ stock: 'ordered', supplierName: 'India Motor Stores' });
      expect((await lineOf()).supplierPaymentAt).toBeFalsy();
    });

    it('our-warehouse items have no supplier to pay — and an open supplier payment keeps an item off "Our Warehouse"', async () => {
      const order = await paidOrder();
      const [kit, mat] = order.items.map((i) => String(i._id));
      const id = String(order._id);

      await wf.setStock(procurement.user, id, kit, { stock: 'own_stock' }, req);
      const refused = await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [kit], amount: 100, payee: BANK });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/our warehouse/i);
      expect(await PaymentRequest.countDocuments({ kind: 'supplier' })).toBe(0);

      // A supplier payment raised for the other item: it is Payment Pending, so not switchable…
      const r = await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [mat], amount: 100, payee: BANK });
      expect(r.status).toBe(201);
      await expect(wf.setStock(procurement.user, id, mat, { stock: 'own_stock' }, req)).rejects.toMatchObject({ statusCode: 409 });
      // …and even if the line lost its "Payment Pending" mark, the open request itself still blocks it.
      await Order.updateOne({ _id: order._id, 'workflow.lines.itemId': order.items[1]._id },
        { $unset: { 'workflow.lines.$.supplierPaymentAt': 1, 'workflow.lines.$.supplierPaymentRef': 1 } });
      await expect(wf.setStock(procurement.user, id, mat, { stock: 'own_stock' }, req))
        .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/cancel it before/) });
    });

    it('a declined payment puts the item back too', async () => {
      const order = await paidOrder();
      const [kit] = order.items.map((i) => String(i._id));
      const r = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [kit], amount: 100, payee: BANK });
      expect((await wf.getOrder(procurement.user, String(order._id))).lines.find((l) => l.itemId === kit).stage).toBe('payment_pending');
      await accounts.session.post(`/payment-requests/${r.body.request.id}/decline`, { note: 'Wrong supplier' });
      expect((await wf.getOrder(procurement.user, String(order._id))).lines.find((l) => l.itemId === kit).stage).toBe('stock_check'); // New Order again
    });

    it('procurement raises one for in-stock items, with the customer and who closed the sale', async () => {
      const order = await paidOrder(gtmLead.user._id);
      const [kit] = order.items.map((i) => String(i._id));
      await wf.setStock(procurement.user, String(order._id), kit, { stock: 'in_stock' }, req);

      const res = await procurement.session.form('/payment-requests/supplier',
        { orderId: String(order._id), itemIds: [kit], amount: 38000, payee: BANK, description: 'Supplier invoice 4471' },
        [{ field: 'bill', buffer: PDF, name: 'invoice.pdf', type: 'application/pdf' }]);
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({
        kind: 'supplier', team: 'procurement', amount: 38000, itemNames: ['Lift kit'],
        customer: { name: 'Ravi Kumar', phone: '9812345678', city: 'Kochi, Kerala' }, closedBy: 'GTM lead: Sam',
      });
      expect(res.body.request.order.number).toMatch(/^#/);

      // A second request for the same item while one is in flight.
      expect((await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [kit], amount: 1, payee: BANK })).status).toBe(409);
      // An item still at its stock check CAN be paid for: that records "ordered from" the supplier.
      const [, mat] = order.items.map((i) => String(i._id));
      expect((await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [mat], amount: 1, payee: BANK })).status).toBe(201);
      const matLine = (await Order.findById(order._id).lean()).workflow.lines.find((l) => String(l.itemId) === mat);
      expect(matLine).toMatchObject({ supplierName: 'ARB Supplies' });
      expect(matLine.supplierPaymentAt).toBeTruthy(); // Payment Pending until paid
      // Only procurement raises them.
      expect((await ops.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [kit], amount: 1, payee: BANK })).status).toBe(403);
      // A website order says so.
      const web = await paidOrder();
      await wf.setStock(procurement.user, String(web._id), String(web.items[0]._id), { stock: 'ordered', supplierName: 'ARB' }, req);
      const w = await procurement.session.form('/payment-requests/supplier', { orderId: String(web._id), itemIds: [String(web.items[0]._id)], amount: 5, payee: BANK });
      expect(w.body.request.closedBy).toBe('Website');
    });

    it('holds its items back from shipping until paid', async () => {
      const order = await paidOrder();
      const id = String(order._id);
      const [kit, mat] = order.items.map((i) => String(i._id));
      await wf.setStock(procurement.user, id, kit, { stock: 'in_stock' }, req);
      await wf.setStock(procurement.user, id, mat, { stock: 'in_stock' }, req);
      const prId = (await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [kit], amount: 38000, payee: BANK })).body.request.id;

      const photo = { buffer: JPEG, mimetype: 'image/jpeg' };
      await expect(wf.shipWithProof(procurement.user, id, { itemIds: [kit] }, photo, req)).rejects.toMatchObject({ statusCode: 409 });
      // An item with no supplier request ships as it always has.
      await expect(wf.shipWithProof(procurement.user, id, { itemIds: [mat] }, photo, req)).resolves.toBeTruthy();

      // Same two hands as every other request: accounts approves, the admin pays.
      expect((await accounts.session.post(`/payment-requests/${prId}/approve`)).status).toBe(200);
      await admin.session.form(`/payment-requests/${prId}/pay`, { method: 'bank', reference: 'UTR55667788' });
      await expect(wf.shipWithProof(procurement.user, id, { itemIds: [kit] }, photo, req)).resolves.toBeTruthy();

      const list = (await procurement.session.get(`/payment-requests/order/${id}`)).body.requests;
      expect(list).toEqual([expect.objectContaining({ status: 'paid', itemNames: ['Lift kit'] })]);
    });
  });

  describe('the bell', () => {
    /*
      The bell is the reason the counts exist: nobody should have to open each
      section to find out whether something is waiting. So what matters is not
      that it counts, but that it counts the RIGHT person's work — a bell that
      rings for someone else's queue teaches people to ignore it.
    */
    const bell = (who) => who.session.get('/notifications/summary');

    it('shows accounts what it must approve, and never what it cannot pay', async () => {
      const waiting = (await expense(ops.session, { payee: BANK })).body.request.id;
      const approved = (await expense(marketing.session, { category: 'purchase', description: 'Flyers' })).body.request.id;
      await accounts.session.post(`/payment-requests/${approved}/approve`);

      const { body } = await bell(accounts);
      const keys = body.items.map((i) => i.key);
      expect(keys).toContain('payments_to_approve');
      expect(keys).not.toContain('payments_to_pay');
      expect(body.items.find((i) => i.key === 'payments_to_approve')).toMatchObject({ count: 1, href: '/team/payments' });
      expect(String(waiting)).toBeTruthy();
    });

    it('shows the admin what is approved and waiting to be paid, not what accounts has yet to decide', async () => {
      await expense(ops.session, { payee: BANK });                       // still waiting on accounts
      const b = (await expense(marketing.session, { category: 'purchase', description: 'Flyers' })).body.request.id;
      await accounts.session.post(`/payment-requests/${b}/approve`);

      const { body } = await bell(admin);
      const keys = body.items.map((i) => i.key);
      expect(keys).toContain('payments_to_pay');
      expect(keys).not.toContain('payments_to_approve');
      expect(body.items.find((i) => i.key === 'payments_to_pay')).toMatchObject({ count: 1, href: '/admin/payments' });
    });

    it('a team that only raises requests is told about nothing', async () => {
      await expense(ops.session, { payee: BANK });
      const { body } = await bell(ops);
      // Its own request is not work waiting ON it — it is waiting on accounts.
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('the total is the sum, and drops as the work is done', async () => {
      const a = (await expense(marketing.session, { category: 'purchase', description: 'Flyers' })).body.request.id;
      expect((await bell(accounts)).body.total).toBe(1);
      await accounts.session.post(`/payment-requests/${a}/approve`);
      // Off accounts' list the moment it is approved, onto the admin's.
      expect((await bell(accounts)).body.total).toBe(0);
      expect((await bell(admin)).body.total).toBe(1);
      await admin.session.form(`/payment-requests/${a}/pay`, { method: 'upi', reference: 'UPI12341234' });
      expect((await bell(admin)).body.total).toBe(0);
    });

    it('a customer cannot ask at all', async () => {
      const customer = await makeUser('Cara', 'customer');
      expect((await bell(customer)).status).toBe(403);
    });
  });

  describe('chat', () => {
    it('posts each step in #accounts and the requester team space, one thread per request', async () => {
      const id = (await expense(ops.session)).body.request.id;
      await accounts.session.post(`/payment-requests/${id}/approve`);
      await admin.session.form(`/payment-requests/${id}/pay`, { method: 'upi', reference: 'UPI12345678' });

      const accountsSpace = await ChatChannel.findOne({ key: 'team:accounts' }).lean();
      const msgs = await ChatMessage.find({ channel: accountsSpace._id }).sort({ seq: 1 }).lean();
      expect(msgs).toHaveLength(3);
      expect(String(msgs[0].threadOrder)).toBe(id);
      // Raised → accounts is asked. Approved → the admin is asked, and mentioned,
      // because nothing moves until they pay.
      expect(msgs[0].text).toMatch(/New fuel expense PR-\d+ .*Accounts: please approve/);
      expect(msgs[1].text).toMatch(/Admin: please pay/);
      expect(msgs[1].mentions.map(String)).toContain(String(admin.user._id));
      expect(msgs.slice(1).every((m) => String(m.threadRoot) === String(msgs[0]._id))).toBe(true);
      expect(msgs[2].text).toMatch(/Paid fuel expense .*UPI ref UPI12345678/);

      const opsSpace = await ChatChannel.findOne({ key: 'team:operations' }).lean();
      expect(await ChatMessage.countDocuments({ channel: opsSpace._id })).toBe(3);
    });
  });
});
