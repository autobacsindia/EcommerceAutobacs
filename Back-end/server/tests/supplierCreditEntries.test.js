/**
 * Supplier credit added straight from the Suppliers tab (owner, 2026-11-21):
 * procurement adds credit given to us / refund received / adjustment up or down,
 * with a reason, date, optional payment link and proof; accounts approves or rejects;
 * only approved entries count. Owner's example:
 *   procurement adds ₹5,000 credit for G S Enterprises → accounts approves → owes us ₹5,000
 * What must hold: amounts > 0 with the type setting the direction; the balance never
 * goes below zero (checked again under the lock at approval); double submits save once;
 * nobody but the admin approves their own; an approved entry is corrected, never
 * overwritten; full who/when/why history.
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


const { default: SupplierLedgerEntry } = await import('../models/SupplierLedgerEntry.js');
const { default: AuditLog } = await import('../models/AuditLog.js');

const GS = { name: 'G S Enterprises', phone: '9800000002', payment: { method: 'upi', upiId: 'gs@okaxis' } };
const OTHER = { name: 'ARB Supplies', phone: '9800000001', payment: { method: 'upi', upiId: 'arb@okaxis' } };
const fk = () => `fk-${new mongoose.Types.ObjectId()}`;
const ymd = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const proof = { field: 'proof', buffer: JPEG, name: 'credit-note.jpg', type: 'image/jpeg' };

describe('Supplier credit added on the Suppliers tab', () => {
  beforeAll(async () => { await dbHandler.connect(); await SupplierLedgerEntry.init(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, accounts2, procurement, procurement2, ops;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    accounts2 = await makeUser('Fathima', 'staff', staff('accounts'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    procurement2 = await makeUser('Rahul', 'staff', staff('procurement'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
  });

  const saveSupplier = async (body = GS) => {
    const res = await procurement.session.post('/suppliers', body);
    expect(res.status).toBe(201);
    return res.body.supplier.id;
  };
  const add = (who, supplierId, fields = {}, files = []) => who.session.form(`/suppliers/${supplierId}/credit/entries`, {
    type: 'credit_given', amount: 5000, date: ymd(), reason: 'Credit note CN-112', formKey: fk(), ...fields,
  }, files);
  const approve = (who, id, body = {}) => who.session.post(`/suppliers/credit/${id}/approve`, body);
  const credit = async (supplierId, s = accounts.session) => (await s.get(`/suppliers/${supplierId}/credit`)).body;
  const balance = async (supplierId) => (await credit(supplierId)).balances?.find((b) => b.currency === 'INR') || { owed: 0, pending: 0 };
  /** Added by procurement and approved by accounts. */
  const approved = async (supplierId, fields = {}) => {
    const r = await add(procurement, supplierId, fields);
    expect(r.status).toBe(201);
    expect((await approve(accounts, r.body.entry.id)).status).toBe(200);
    return r.body.entry;
  };

  it('the owner\'s example: procurement adds ₹5,000 → waiting for accounts → approved → owes us ₹5,000', async () => {
    const gs = await saveSupplier();
    const r = await add(procurement, gs, {}, [proof]);
    expect(r.status).toBe(201);
    expect(r.body.entry).toMatchObject({ kind: 'credit_given', kindLabel: 'Credit given to us', status: 'pending', amount: 5000, signedAmount: 5000, note: 'Credit note CN-112', date: ymd() });
    // Not counted yet: shown as waiting.
    expect(await balance(gs)).toMatchObject({ owed: 0, pending: 5000, pendingText: '₹5,000' });
    const listed = (await procurement.session.get('/suppliers')).body.suppliers.find((s) => s.id === gs);
    expect(listed.credit).toEqual([expect.objectContaining({ owed: 0, pending: 5000 })]);
    // Accounts sees it in the queue and the proof opens.
    expect((await accounts.session.get('/suppliers/credit/pending')).body.entries.map((e) => e.id)).toContain(r.body.entry.id);
    const file = await accounts.session.get(`/suppliers/credit/${r.body.entry.id}/files/${r.body.entry.files[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/image\/jpeg/);
    expect((await approve(accounts, r.body.entry.id, { note: 'Checked CN-112' })).status).toBe(200);
    expect(await balance(gs)).toMatchObject({ owed: 5000, owedText: '₹5,000', pending: 0 });
    // Full history for every role that may see it: who proposed, who approved, when, why.
    for (const who of [admin, accounts, procurement2]) {
      const e = (await credit(gs, who.session)).entries[0];
      expect(e.createdByName).toBe('Priya');
      expect(e.decidedByName).toBe('Anu');
      expect(e.decisionNote).toBe('Checked CN-112');
      expect(e.history.map((h) => [h.action, h.byName])).toEqual([['raised', 'Priya'], ['approved', 'Anu']]);
    }
    expect(await AuditLog.countDocuments({ resource: 'SupplierLedgerEntry' })).toBeGreaterThanOrEqual(2);
  });

  it('each type moves the balance its own way; refund received and adjustment down take it down', async () => {
    const gs = await saveSupplier();
    await approved(gs, { amount: 10000 });
    await approved(gs, { type: 'adjustment_up', amount: 500, reason: 'Missed freight credit' });
    await approved(gs, { type: 'repaid', amount: 3000, reason: 'UPI refund', reference: 'UTR998877' });
    await approved(gs, { type: 'adjustment_down', amount: 1500, reason: 'Double-counted credit note' });
    expect((await balance(gs)).owed).toBe(6000);
    const kinds = (await credit(gs)).entries.map((e) => [e.kindLabel, e.signedAmount]);
    expect(kinds).toEqual([
      ['Adjustment (owes us less)', -1500], ['Supplier paid back', -3000], ['Adjustment (owes us more)', 500], ['Credit given to us', 10000],
    ]);
  });

  it('who may add: procurement and admin; accounts and operations may not; operations sees nothing', async () => {
    const gs = await saveSupplier();
    expect((await add(accounts, gs)).status).toBe(403);
    expect((await add(ops, gs)).status).toBe(403);
    expect((await ops.session.get(`/suppliers/${gs}/credit`)).status).toBe(403);
    const mine = await add(admin, gs);
    expect(mine.status).toBe(201);
    // The admin may approve their own; procurement can never approve.
    const p = await add(procurement, gs);
    expect((await approve(procurement, p.body.entry.id)).status).toBe(403);
    expect((await approve(admin, mine.body.entry.id)).status).toBe(200);
    expect((await credit(gs, procurement.session)).can).toEqual({ propose: true, writeOff: false });
    expect((await credit(gs, accounts.session)).can).toEqual({ propose: false, writeOff: false });
  });

  it('refuses zero, negative and silly amounts, a missing reason, a wrong type or date, an unknown supplier', async () => {
    const gs = await saveSupplier();
    for (const amount of [0, -5000, '', 'abc', 0.001, 2e9]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await add(procurement, gs, { amount })).status).toBe(400);
    }
    expect((await add(procurement, gs, { reason: '   ' })).body.message).toMatch(/Say why/);
    expect((await add(procurement, gs, { type: 'written_off' })).status).toBe(400);
    expect((await add(procurement, gs, { type: 'credit_used' })).status).toBe(400);
    expect((await add(procurement, gs, { date: ymd(3) })).status).toBe(400);
    expect((await add(procurement, gs, { date: '2026-02-30' })).status).toBe(400);
    expect((await add(procurement, gs, { date: '' })).body.message).toBe('Enter the date.');
    expect((await add(procurement, gs, { formKey: '' })).status).toBe(400);
    expect((await add(procurement, String(new mongoose.Types.ObjectId()))).status).toBe(404);
    expect(await SupplierLedgerEntry.countDocuments({})).toBe(0);
  });

  it('the balance never goes below zero: refused when added, and again when two are approved together', async () => {
    const gs = await saveSupplier();
    const none = await add(procurement, gs, { type: 'adjustment_down', amount: 1 });
    expect(none.status).toBe(409);
    expect(none.body.message).toMatch(/owes us nothing/);
    await approved(gs, { amount: 5000 });
    expect((await add(procurement, gs, { type: 'repaid', amount: 5000.01 })).status).toBe(409);
    // Each fits alone; approving both at once lets only one through.
    const a = (await add(procurement, gs, { type: 'repaid', amount: 4000 })).body.entry;
    const b = (await add(procurement, gs, { type: 'adjustment_down', amount: 4000 })).body.entry;
    const res = await Promise.all([approve(accounts, a.id), approve(accounts2, b.id)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await balance(gs)).owed).toBe(1000);
  });

  it('a double-clicked or retried submit saves once and keeps one copy of the proof', async () => {
    const gs = await saveSupplier();
    const formKey = fk();
    const res = await Promise.all([1, 2, 3].map(() => add(procurement, gs, { formKey }, [proof])));
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(new Set(res.map((r) => r.body.entry.id)).size).toBe(1);
    expect(await SupplierLedgerEntry.countDocuments({})).toBe(1);
    expect(stored.size).toBe(1);
    // A form key reused against a different supplier is refused, not silently answered.
    const other = await saveSupplier(OTHER);
    expect((await add(procurement, other, { formKey })).status).toBe(409);
  });

  it('reject needs a reason; the rejected entry stays in history and a corrected one can be added', async () => {
    const gs = await saveSupplier();
    const first = (await add(procurement, gs, { amount: 50000 })).body.entry;
    expect((await accounts.session.post(`/suppliers/credit/${first.id}/decline`, {})).status).toBe(400);
    expect((await accounts.session.post(`/suppliers/credit/${first.id}/decline`, { note: 'CN-112 is for ₹5,000' })).status).toBe(200);
    expect((await approve(accounts, first.id)).status).toBe(409);
    const again = await add(procurement, gs, { amount: 5000 });
    expect(again.status).toBe(201);
    await approve(accounts, again.body.entry.id);
    const entries = (await credit(gs, procurement.session)).entries;
    expect(entries.map((e) => [e.status, e.amount])).toEqual([['approved', 5000], ['declined', 50000]]);
    expect(entries[1]).toMatchObject({ decidedByName: 'Anu', decisionNote: 'CN-112 is for ₹5,000' });
    expect((await balance(gs)).owed).toBe(5000);
  });

  it('a pending entry is edited with a reason by whoever added it; an approval of the old version is refused', async () => {
    const gs = await saveSupplier();
    const e = (await add(procurement, gs, { amount: 5000 })).body.entry;
    expect(e.can.edit).toBe(true);
    const edit = (who, body) => who.session.post(`/suppliers/credit/${e.id}/edit`, { rev: 0, formKey: fk(), ...body });
    expect((await edit(procurement, { amount: 4500 })).status).toBe(400); // no reason
    expect((await edit(procurement2, { amount: 4500, reason: 'x' })).status).toBe(403); // not theirs
    expect((await edit(accounts, { amount: 4500, reason: 'x' })).status).toBe(403);
    const ok = await edit(procurement, { amount: 4500, reference: 'CN-112A', reason: 'Credit note was revised' });
    expect(ok.status).toBe(200);
    expect(ok.body.entry).toMatchObject({ status: 'pending', amount: 4500, reference: 'CN-112A', rev: 1 });
    expect(ok.body.entry.edits[0]).toMatchObject({ byName: 'Priya', reason: 'Credit note was revised' });
    expect(ok.body.entry.edits[0].changes).toEqual(expect.arrayContaining([{ field: 'Amount', from: '₹5,000', to: '₹4,500' }]));
    expect((await approve(accounts, e.id, { rev: 0 })).status).toBe(409);
    expect((await approve(accounts, e.id, { rev: 1 })).status).toBe(200);
    expect((await balance(gs)).owed).toBe(4500);
    // A pending adjustment down cannot be edited above the balance either.
    const down = (await add(procurement, gs, { type: 'adjustment_down', amount: 100 })).body.entry;
    const big = await procurement.session.post(`/suppliers/credit/${down.id}/edit`, { rev: 0, formKey: fk(), amount: 4500.01, reason: 'x' });
    expect(big.status).toBe(409);
  });

  it('an approved entry is never overwritten: a correction for the difference waits for accounts', async () => {
    const gs = await saveSupplier();
    const e = await approved(gs, { amount: 5000 });
    const fix = await procurement2.session.post(`/suppliers/credit/${e.id}/edit`, { rev: e.rev, formKey: fk(), amount: 4000, reason: 'Supplier revised CN-112' });
    expect(fix.status).toBe(200);
    expect(fix.body.correction).toMatchObject({ kind: 'correction_down', amount: 1000, status: 'pending', correctionOf: { id: e.id, kindLabel: 'Credit given to us' } });
    // Unchanged until approved; the original row's money is untouched.
    expect(await balance(gs)).toMatchObject({ owed: 5000, pending: -1000 });
    expect((await SupplierLedgerEntry.findById(e.id).lean()).amountPaise).toBe(500000);
    // Nobody approves their own correction.
    expect((await approve(procurement2, fix.body.correction.id)).status).toBe(403);
    expect((await approve(accounts, fix.body.correction.id)).status).toBe(200);
    expect((await balance(gs)).owed).toBe(4000);
    const row = (await credit(gs)).entries.find((x) => x.id === e.id);
    expect(row).toMatchObject({ amount: 5000, correctedAmount: 4000 });
  });

  it('may name one of this supplier\'s payments; another supplier\'s or an unknown one is refused', async () => {
    const gs = await saveSupplier();
    const other = await saveSupplier(OTHER);
    const order = await paidOrder();
    const pay = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [String(order.items[0]._id)], amount: 2065, supplierId: gs });
    expect(pay.status).toBe(201);
    const number = pay.body.request.number;
    const r = await add(procurement, gs, { paymentNumber: number.toLowerCase() });
    expect(r.status).toBe(201);
    expect(r.body.entry.link).toEqual({ paymentRequest: { id: pay.body.request.id, number }, order: { id: String(order._id), number: expect.any(String) } });
    // Information only: not tied to the payment's refund-claim checks.
    expect(r.body.entry.paymentRequest).toBeNull();
    expect((await approve(accounts, r.body.entry.id)).status).toBe(200);
    const wrong = await add(procurement, other, { paymentNumber: number });
    expect(wrong.status).toBe(409);
    expect(wrong.body.message).toMatch(/not ARB Supplies/);
    expect((await add(procurement, gs, { paymentNumber: 'PR-999999' })).status).toBe(404);
  });
});

// ── Optimization pass (measured): the add path's reads ride indexes ──────────
describe('Supplier credit entries — query plans', () => {
  beforeAll(async () => { await dbHandler.connect(); await SupplierLedgerEntry.init(); await PaymentRequest.init(); });
  afterAll(async () => { await dbHandler.closeDatabase(); });

  it('the form-key, payment-number and balance reads use their indexes (no collection scan)', async () => {
    const plan = async (q) => JSON.stringify(await q.explain('queryPlanner'));
    const byKey = await plan(SupplierLedgerEntry.findOne({ key: 'entry:fk-x' }));
    expect(byKey).toMatch(/supplier_ledger_key/);
    const byNumber = await plan(PaymentRequest.findOne({ number: 'PR-0088' }));
    expect(byNumber).toMatch(/payment_request_number/);
    const balance = JSON.stringify(await SupplierLedgerEntry.aggregate([
      { $match: { supplier: new mongoose.Types.ObjectId(), status: { $in: ['approved', 'pending'] } } },
      { $group: { _id: '$currency', n: { $sum: '$amountPaise' } } },
    ]).explain('queryPlanner'));
    expect(balance).toMatch(/supplier_ledger_supplier/);
    for (const p of [byKey, byNumber, balance]) expect(p).not.toMatch(/COLLSCAN/);
  });
});
