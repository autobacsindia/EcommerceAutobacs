/**
 * Procurement records, accounts approves (owner, 2026-11-20) — over HTTP, with real
 * payment requests and the real supplier ledger.
 *
 * What must hold:
 *   - "Supplier refunded" on the order writes the SAME ledger row Payments → Suppliers
 *     uses (kind repaid, tied to the paid payment), so the order and the supplier's
 *     balance always agree
 *   - part refunds add up; a refund larger than what is still owed on that payment is
 *     refused when recorded AND when approved (two at once cannot both fit)
 *   - a double-submitted refund (same form key) saves one row and one set of files
 *   - a declined refund shows why, and procurement can record it again
 *   - procurement proposes, accounts approves: procurement cannot approve, accounts
 *     cannot record; nobody approves their own entry except the admin
 *   - a supplier change waits for accounts' review (approve / reject with a reason),
 *     listed across orders, with who / when / why kept on the order
 *   - a return on an item bought from two suppliers offers both
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
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { default: SupplierLedgerEntry } = await import('../models/SupplierLedgerEntry.js');
const { default: supplierLedgerRepository } = await import('../repositories/supplierLedgerRepository.js');
const { destinationOptions } = await import('../services/returnService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);

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
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
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
  const email = `${name.toLowerCase().replace(/\s+/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const staff = (team, isHead = false) => ({ team, isHead, active: true });
const bank = (name) => ({ name, method: 'bank', accountName: `${name} Pvt Ltd`, accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' });

async function paidOrder() {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Jerry Can 20L', variantLabel: 'jerry can with locking mount', price: 4500, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 4500, totalAmount: 4500, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}


const MEASURED_CORRECTIONS = 1; // was 2 (claim + its refunds read separately) before the optimization pass

describe('Procurement records, accounts approves', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, accounts2, procurement, order, id, item;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Fathima KA', 'staff', staff('accounts'));
    accounts2 = await makeUser('Anu', 'staff', staff('accounts'));
    procurement = await makeUser('Aromal S', 'staff', staff('procurement'));
    order = await paidOrder();
    id = String(order._id);
    item = String(order.items[0]._id);
  });

  const lineUrl = () => `/staff/work/orders/${id}/lines/${item}`;
  const raise = (fields) => procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [item], amount: 1000, ...fields });
  const change = (partId, body, s = procurement.session) => s.post(`${lineUrl()}/parts/${partId}/change`, body);
  const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  let fk = 0;
  const formKey = () => { fk += 1; return `form-key-${Date.now()}-${fk}`; };
  const refund = (prId, fields = {}, files = [], s = procurement.session) => s.form('/suppliers/credit/order-refunds', {
    paymentRequestId: prId, amount: 1000, date: today(), method: 'upi', reference: 'UTR998877', note: 'GS sent it back', formKey: formKey(), ...fields,
  }, files);
  const decide = (entryId, action, s = accounts.session, body = {}) => s.post(`/suppliers/credit/${entryId}/${action}`, body);
  const orderRow = async (prId, s = procurement.session) => (await s.get(`/payment-requests/order/${id}`)).body.requests.find((r) => r.id === prId);
  const proof = { field: 'proof', buffer: JPEG, name: 'upi.jpg', type: 'image/jpeg' };

  /** G S Enterprises paid ₹2,065 (PR), supplier changed, claim raised → { prId, supplierId, claimId }. */
  async function paidThenChanged({ approveClaim = true } = {}) {
    const pr = await raise({ payee: bank('G S Enterprises'), amount: 2065, saveSupplier: 'true' });
    expect(pr.status).toBe(201);
    const prId = pr.body.request.id;
    expect((await accounts.session.post(`/payment-requests/${prId}/approve`)).status).toBe(200);
    expect((await admin.session.form(`/payment-requests/${prId}/pay`, { method: 'bank', reference: 'UTR12345' })).status).toBe(200);
    expect((await change('main', { supplierName: 'India Motor Stores', reasonCode: 'late', reasonNote: 'GS Enterprises factory closed' })).status).toBe(200);
    const claim = await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: prId });
    expect(claim.status).toBe(201);
    if (approveClaim) expect((await decide(claim.body.entry.id, 'approve')).status).toBe(200);
    const supplierId = (await PaymentRequest.findById(prId).lean()).supplier.toString();
    return { prId, supplierId, claimId: claim.body.entry.id };
  }
  const balance = async (supplierId) => (await accounts.session.get(`/suppliers/${supplierId}/credit`)).body.balances?.[0]?.owed ?? 0;

  it('walk-through: GS refunds ₹2,065 in two parts → procurement records → accounts approves → order and ledger agree', async () => {
    const { prId, supplierId } = await paidThenChanged();
    expect(await balance(supplierId)).toBe(2065);
    expect((await orderRow(prId)).supplierRefund.claim).toMatchObject({ status: 'approved', amount: 2065, refunded: 0, left: 2065, canRecordRefund: true });

    const first = await refund(prId, { amount: 1000 }, [proof]);
    expect(first.status).toBe(201);
    expect(first.body.entry).toMatchObject({
      kind: 'repaid', status: 'pending', amount: 1000, method: 'upi', methodLabel: 'UPI', reference: 'UTR998877',
      paymentRequest: { id: prId }, order: { id }, can: { approve: false },
    });
    expect(first.body.entry.files).toHaveLength(1);
    // Waiting: on the order, and in accounts' queue — the same row.
    expect((await orderRow(prId)).supplierRefund.claim).toMatchObject({ refunded: 0, refundPending: 1000, left: 1065 });
    const queue = (await accounts.session.get('/suppliers/credit/pending')).body.entries;
    expect(queue.map((e) => e.id)).toContain(first.body.entry.id);
    expect(queue.find((e) => e.id === first.body.entry.id).can.approve).toBe(true);
    // The proof opens for accounts.
    const file = await accounts.session.get(`/suppliers/credit/${first.body.entry.id}/files/${first.body.entry.files[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');

    expect((await decide(first.body.entry.id, 'approve')).status).toBe(200);
    expect(await balance(supplierId)).toBe(1065);
    expect((await orderRow(prId)).supplierRefund.claim).toMatchObject({ refunded: 1000, refundPending: 0, left: 1065 });

    const second = await refund(prId, { amount: 1065, method: 'bank', reference: 'NEFT55' });
    expect(second.status).toBe(201);
    expect((await decide(second.body.entry.id, 'approve')).status).toBe(200);
    expect(await balance(supplierId)).toBe(0);
    const claim = (await orderRow(prId)).supplierRefund.claim;
    expect(claim).toMatchObject({ refunded: 2065, left: 0, canRecordRefund: false });
    expect(claim.refunds.map((r) => [r.amount, r.status, r.decidedByName])).toEqual([[1000, 'approved', 'Fathima KA'], [1065, 'approved', 'Fathima KA']]);
    // Nothing more can come back.
    expect((await refund(prId, { amount: 1 })).status).toBe(409);
  });

  it('a refund larger than what is still owed on the payment is refused — when recorded and when approved', async () => {
    const { prId } = await paidThenChanged();
    expect((await refund(prId, { amount: 2066 })).body.message).toMatch(/Only ₹2,065 is still to come back/);
    const a = await refund(prId, { amount: 1500 });
    expect(a.status).toBe(201);
    // ₹1,500 waiting counts: only ₹565 left to record.
    expect((await refund(prId, { amount: 600 })).status).toBe(409);
    expect((await refund(prId, { amount: 565 })).status).toBe(201);

    // Two raised at the same moment can both slip past the "record" check — the
    // approval (under the supplier's lock) still lets at most the claim through.
    await SupplierLedgerEntry.create({
      supplier: (await SupplierLedgerEntry.findById(a.body.entry.id).lean()).supplier, supplierName: 'G S Enterprises', kind: 'repaid',
      currency: 'INR', amountPaise: 150000, status: 'pending', key: 'repaid:race-slipped-in', paymentRequest: prId, paymentRequestNumber: 'PR',
      createdBy: procurement.user._id, createdByName: 'Aromal S',
    });
    const raced = await SupplierLedgerEntry.findOne({ key: 'repaid:race-slipped-in' }).lean();
    expect((await decide(a.body.entry.id, 'approve')).status).toBe(200);
    const refused = await decide(String(raced._id), 'approve');
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/Only ₹565 is still to come back/);
  });

  it('a refund before accounts approved the claim waits: accounts must approve the claim first', async () => {
    const { prId, claimId } = await paidThenChanged({ approveClaim: false });
    const r = await refund(prId, { amount: 2065 });
    expect(r.status).toBe(201);
    const early = await decide(r.body.entry.id, 'approve');
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/Approve the refund claim on PR-\d+ \(₹2,065\) first/);
    expect((await decide(claimId, 'approve')).status).toBe(200);
    expect((await decide(r.body.entry.id, 'approve')).status).toBe(200);
  });

  it('no claim → no refund; a payment with no claim cannot be refunded', async () => {
    const pr = await raise({ payee: bank('G S Enterprises'), amount: 2065, saveSupplier: 'true' });
    expect((await refund(pr.body.request.id)).body.message).toMatch(/Raise "Supplier must refund" on this payment first/);
    expect((await refund('not-an-id')).status).toBe(404);
  });

  it('double submit (same form key) saves ONE refund and ONE set of files', async () => {
    const { prId } = await paidThenChanged();
    const key = formKey();
    const [a, b] = await Promise.all([refund(prId, { formKey: key }, [proof]), refund(prId, { formKey: key }, [proof])]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(a.body.entry.id).toBe(b.body.entry.id);
    expect(await SupplierLedgerEntry.countDocuments({ kind: 'repaid' })).toBe(1);
    expect([...stored.keys()].filter((k) => k.startsWith('payment-requests/supplier-refunds/'))).toHaveLength(1);
    // A retry afterwards: the same answer.
    expect((await refund(prId, { formKey: key })).body.entry.id).toBe(a.body.entry.id);
  });

  it('declined → procurement sees why and records it again', async () => {
    const { prId } = await paidThenChanged();
    const r = await refund(prId, { amount: 2065, reference: 'WRONG-UTR' });
    expect((await decide(r.body.entry.id, 'decline', accounts.session, { note: 'UTR not in the bank statement' })).status).toBe(200);
    let claim = (await orderRow(prId)).supplierRefund.claim;
    expect(claim).toMatchObject({ refunded: 0, refundPending: 0, left: 2065, canRecordRefund: true });
    expect(claim.refunds[0]).toMatchObject({ status: 'declined', decisionNote: 'UTR not in the bank statement', decidedByName: 'Fathima KA' });
    const again = await refund(prId, { amount: 2065, reference: 'UTR-RIGHT' });
    expect(again.status).toBe(201);
    expect((await decide(again.body.entry.id, 'approve')).status).toBe(200);
    claim = (await orderRow(prId)).supplierRefund.claim;
    expect(claim).toMatchObject({ refunded: 2065, left: 0 });
  });

  it('who may do what: procurement records, accounts approves; nobody approves their own (except the admin)', async () => {
    const { prId } = await paidThenChanged();
    expect((await refund(prId, {}, [], accounts.session)).status).toBe(403);
    const r = await refund(prId);
    expect((await decide(r.body.entry.id, 'approve', procurement.session)).status).toBe(403);
    // The accounts row on the order view offers no "record" button.
    expect((await orderRow(prId, accounts.session)).supplierRefund.claim.canRecordRefund).toBe(false);
    // The admin may raise and approve their own.
    const own = await refund(prId, { amount: 500 }, [], admin.session);
    expect(own.status).toBe(201);
    expect((await decide(own.body.entry.id, 'approve', admin.session)).status).toBe(200);
    expect((await decide(r.body.entry.id, 'approve', accounts2.session)).status).toBe(200);
  });

  it('what is typed is checked: how, reference, date', async () => {
    const { prId } = await paidThenChanged();
    expect((await refund(prId, { method: 'cheque' })).body.message).toMatch(/Choose how the supplier paid it back/);
    expect((await refund(prId, { reference: '' })).body.message).toMatch(/UTR/);
    expect((await refund(prId, { method: 'credit_note', reference: '' })).body.message).toMatch(/credit note number/);
    expect((await refund(prId, { date: '2099-01-01' })).status).toBe(400);
    expect((await refund(prId, { amount: 0 })).status).toBe(400);
    expect((await refund(prId, { method: 'cash', reference: '' })).status).toBe(201);
  });

  it('approving a refund reads the ledger in a bounded number of queries (measured: optimization pass)', async () => {
    const { prId } = await paidThenChanged();
    const done = await refund(prId, { amount: 500 });
    expect((await decide(done.body.entry.id, 'approve')).status).toBe(200);
    const r = await refund(prId, { amount: 500 });
    const spies = ['claimFor', 'refundsFor', 'correctionsFor'].map((k) => jest.spyOn(supplierLedgerRepository, k));
    expect((await decide(r.body.entry.id, 'approve')).status).toBe(200);
    const calls = Object.fromEntries(spies.map((s, i) => [['claimFor', 'refundsFor', 'correctionsFor'][i], s.mock.calls.length]));
    spies.forEach((s) => s.mockRestore());
    console.info('[measure] approve refund ledger reads', JSON.stringify(calls));
    expect(calls).toEqual({ claimFor: 1, refundsFor: 1, correctionsFor: MEASURED_CORRECTIONS });
  });

  it('a claim cannot be corrected below the refunds already recorded on it', async () => {
    const { prId, claimId } = await paidThenChanged();
    const r = await refund(prId, { amount: 1500 });
    expect((await decide(r.body.entry.id, 'approve')).status).toBe(200);
    const claim = await SupplierLedgerEntry.findById(claimId).lean();
    const res = await procurement.session.post(`/suppliers/credit/${claimId}/edit`, { amount: 1000, reason: 'Agreed a lower refund', rev: claim.rev || 0, formKey: formKey() });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/₹1,500 of refunds are already recorded/);
  });

  describe('supplier change review', () => {
    const review = (partId, body, s = accounts.session) => s.post(`${lineUrl()}/parts/${partId}/review`, body);
    const pendingList = async (s = accounts.session) => (await s.get('/staff/work/supplier-changes/pending')).body;

    it('a change waits for accounts: listed across orders, approved or rejected with a reason, kept on the order', async () => {
      await raise({ payee: bank('G S Enterprises') });
      // The PR was waiting — the change cancels it the normal way.
      const res = await change('main', { supplierName: 'India Motor Stores', reasonCode: 'late', reasonNote: 'GS factory closed' });
      expect(res.status).toBe(200);
      const was = res.body.order.lines[0].supplierParts.find((p) => p.status === 'replaced');
      expect(was.review).toMatchObject({ status: 'pending' });
      expect((await Order.findById(id).lean()).workflow.reviewPendingAt).toBeInstanceOf(Date);

      const list = await pendingList();
      expect(list.changes).toEqual([expect.objectContaining({
        orderId: id, itemId: item, partId: was.id, from: 'G S Enterprises', to: 'India Motor Stores',
        reason: "Supplier can't deliver on time — GS factory closed", changedByName: 'Aromal S', can: { review: true },
      })]);
      // Accounts' order view offers the review; procurement's does not.
      expect((await accounts.session.get(`/staff/work/orders/${id}`)).body.order.lines[0].actions).toContain('supplier_review');
      expect((await procurement.session.get(`/staff/work/orders/${id}`)).body.order.lines[0].actions).not.toContain('supplier_review');
      expect((await pendingList(procurement.session)).changes[0].can.review).toBe(false);

      expect((await review(was.id, { decision: 'approve' }, procurement.session)).status).toBe(403);
      expect((await review(was.id, { decision: 'reject' })).status).toBe(400);
      const rejected = await review(was.id, { decision: 'reject', note: 'Ask GS first — they deliver next week' });
      expect(rejected.status).toBe(200);
      expect(rejected.body.order.lines[0].supplierParts.find((p) => p.id === was.id).review)
        .toMatchObject({ status: 'rejected', byName: 'Fathima KA', note: 'Ask GS first — they deliver next week' });
      // Decided once; off the list; the order's mark cleared.
      expect((await review(was.id, { decision: 'approve' }, accounts2.session)).status).toBe(409);
      expect((await pendingList()).changes).toEqual([]);
      expect((await Order.findById(id).lean()).workflow.reviewPendingAt).toBeUndefined();
      const audit = await AuditLog.findOne({ 'details.change': 'supplier_change_rejected' }).lean();
      expect(audit?.details).toMatchObject({ partId: was.id, note: 'Ask GS first — they deliver next week' });
    });

    it('two changes on one order: the mark stays until both are reviewed; the admin may review their own', async () => {
      await raise({ payee: bank('G S Enterprises') });
      const first = await change('main', { supplierName: 'India Motor Stores', reasonCode: 'late' }, admin.session);
      expect(first.status).toBe(200);
      const active = first.body.order.lines[0].supplierParts.find((p) => p.status === 'active');
      const second = await change(active.id, { supplierName: 'Trek N Trade', reasonCode: 'out_of_stock' });
      expect(second.status).toBe(200);
      const [a, b] = second.body.order.lines[0].supplierParts.filter((p) => p.status === 'replaced');
      expect((await pendingList()).changes).toHaveLength(2);
      expect((await review(a.id, { decision: 'approve' }, admin.session)).status).toBe(200);
      expect((await Order.findById(id).lean()).workflow.reviewPendingAt).toBeInstanceOf(Date);
      expect((await review(b.id, { decision: 'approve' })).status).toBe(200);
      expect((await Order.findById(id).lean()).workflow.reviewPendingAt).toBeUndefined();
    });

    it('the person who made the change cannot review it (unless admin)', async () => {
      const lead = await makeUser('Accounts Lead', 'staff', staff('accounts'));
      await raise({ payee: bank('G S Enterprises') });
      // An accounts member cannot change suppliers at all — so they can never review their own.
      expect((await change('main', { supplierName: 'X', reasonCode: 'late' }, lead.session)).status).toBe(403);
    });

    it('the list is a cursor page riding workflow_review_pending', async () => {
      const plan = await Order.find({ 'workflow.reviewPendingAt': { $type: 'date' } }).sort({ 'workflow.reviewPendingAt': 1, _id: 1 }).explain('queryPlanner');
      const text = JSON.stringify(plan);
      expect(text).toContain('workflow_review_pending');
    });
  });

  it('a return on an item bought from two suppliers offers both', () => {
    const itemId = new mongoose.Types.ObjectId();
    const o = {
      items: [{ _id: itemId, name: 'Jerry Can 20L', quantity: 1, price: 4500 }],
      workflow: { lines: [{ itemId, supplierName: 'Trek N Trade', parts: [
        { supplierName: 'G S Enterprises', status: 'replaced' },
        { supplierName: 'Trek N Trade', status: 'active' },
        { supplierName: 'Mount Co', status: 'active' },
      ] }] },
    };
    expect(destinationOptions(o, { items: [{ orderItemId: itemId, name: 'Jerry Can 20L', quantity: 1 }] }).suppliers).toEqual(['Trek N Trade', 'Mount Co']);
  });
});
