/**
 * Supplier credit (services/supplierLedgerService.js): what a supplier owes us, as an
 * immutable ledger. Owner's example (2026-11-06):
 *   order cancelled after we paid the supplier ₹30,000 → refund due ₹30,000
 *   supplier pays back ₹15,000 → owes us ₹15,000 (that is the credit)
 *   next order ₹40,000 → ₹15,000 from credit, ₹25,000 transferred
 * What must hold: server-side money math, one row per cause (double clicks, retries),
 * no double spend under a race, credit given back on decline / cancel / withdraw,
 * same currency only, procurement proposes / accounts approves, cursor paging.
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
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

const { default: SupplierLedgerEntry } = await import('../models/SupplierLedgerEntry.js');
const { default: cancellationService } = await import('../services/cancellationService.js');
const ledger = await import('../services/supplierLedgerService.js');
const { creditRows } = await import('../services/paymentSlipService.js');

const ARB = {
  name: 'ARB Supplies', phone: '9800000001',
  payment: { method: 'bank', accountName: 'ARB Supplies Pvt Ltd', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' },
};
const THAI = { name: 'Open N', phone: '6681000000', payment: { method: 'bank', accountName: 'Nikom Amranan', accountNumber: '8582102601', swift: 'kasithbk', bankName: 'KASIKORNBANK' } };
const fk = () => `fk-${new mongoose.Types.ObjectId()}`;
const ymd = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

describe('supplier credit (pure)', () => {
  it('reads amounts as integer paise and refuses nonsense', () => {
    expect(ledger.cleanAmountPaise('15000.555')).toBe(1500056);
    expect(ledger.cleanAmountPaise(0.1 + 0.2)).toBe(30);
    for (const bad of ['', null, 0, -5, 'abc', 0.004, 2e9]) expect(() => ledger.cleanAmountPaise(bad)).toThrow();
  });
  it('the slip says bill − credit = transfer', () => {
    expect(creditRows({ currency: 'INR', amount: 25000, credit: { amount: 15000 } })).toEqual([
      ['Bill', expect.stringMatching(/40,000\.00/)], ['Supplier credit used', expect.stringMatching(/15,000\.00/)], ['Transfer', expect.stringMatching(/25,000\.00/)],
    ]);
    expect(creditRows({ currency: 'THB', amount: 0, foreignAmount: 20000, credit: { amount: 2950 } })[0][1]).toBe('THB 22,950.00');
    expect(creditRows({ currency: 'INR', amount: 100 })).toEqual([]);
  });
  it('shows who may do what on an entry', () => {
    const mine = { _id: 'e', kind: 'repaid', status: 'pending', amountPaise: 100, createdBy: 'u1', currency: 'INR' };
    const acc = { _id: 'u2', role: 'staff', staff: { team: 'accounts', active: true } };
    expect(ledger.shape(mine, acc).can).toEqual({ approve: true, decline: true, cancel: false });
    expect(ledger.shape(mine, { ...acc, _id: 'u1' }).can.approve).toBe(false); // not their own
    expect(ledger.shape(mine, { _id: 'u1', role: 'admin' }).can).toEqual({ approve: true, decline: true, cancel: true });
    expect(ledger.shape({ ...mine, status: 'approved' }, acc).can).toEqual({ approve: false, decline: false, cancel: false });
    expect(ledger.shape(mine, acc).signedAmount).toBe(-1);
  });
});

describe('Supplier credit', () => {
  beforeAll(async () => { await dbHandler.connect(); await SupplierLedgerEntry.init(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, accounts2, procurement, ops;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    accounts2 = await makeUser('Fathima', 'staff', staff('accounts'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
  });

  const saveSupplier = async (body = ARB) => {
    const res = await procurement.session.post('/suppliers', body);
    expect(res.status).toBe(201);
    return res.body.supplier.id;
  };
  const raise = (orderId, itemId, supplierId, amount, extra = {}) => procurement.session.form('/payment-requests/supplier', { orderId, itemIds: [itemId], amount, supplierId, ...extra });
  const approveAndPay = async (prId, pay = {}) => {
    expect((await accounts.session.post(`/payment-requests/${prId}/approve`)).status).toBe(200);
    const res = await admin.session.form(`/payment-requests/${prId}/pay`, { method: 'bank', reference: 'UTR1234', ...pay });
    expect(res.status).toBe(200);
    return res.body.request;
  };
  const credit = async (supplierId, s = accounts.session) => (await s.get(`/suppliers/${supplierId}/credit`)).body;
  const owed = async (supplierId, currency = 'INR') => (await credit(supplierId)).balances.find((b) => b.currency === currency)?.owed ?? 0;

  /** ₹30,000 paid to ARB for the lift kit; then the customer cancels the order. */
  async function paidThenCancelled(supplierId, amount = 30000, extra = {}) {
    const order = await paidOrder();
    const id = String(order._id);
    const kit = String(order.items[0]._id);
    const r = await raise(id, kit, supplierId, amount, extra);
    expect(r.status).toBe(201);
    await approveAndPay(r.body.request.id, extra.currency && extra.currency !== 'INR' ? { rupees: 24300 } : {});
    expect((await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' })).success).toBe(true);
    return { order, id, kit, pr: r.body.request };
  }
  /** Refund claimed by procurement and approved by accounts → the supplier owes `amount`. */
  async function owesUs(supplierId, amount = 30000, extra = {}) {
    const x = await paidThenCancelled(supplierId, amount, extra);
    const claim = await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: x.pr.id });
    expect(claim.status).toBe(201);
    expect((await accounts.session.post(`/suppliers/credit/${claim.body.entry.id}/approve`)).status).toBe(200);
    return { ...x, claim: claim.body.entry };
  }

  it('the owner\'s example: refund due ₹30,000 → repaid ₹15,000 → next ₹40,000 order transfers ₹25,000', async () => {
    const arb = await saveSupplier();
    const { order, pr } = await paidThenCancelled(arb);
    // The order panel offers "Supplier must refund" on the paid payment.
    const panel = (await procurement.session.get(`/payment-requests/order/${order._id}`)).body;
    const line = panel.requests.find((p) => p.id === pr.id);
    expect(line.supplierRefund).toEqual({ claim: null, canClaim: true, savedSupplier: true });

    const claim = await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: pr.id, note: 'Order cancelled by customer' });
    expect(claim.status).toBe(201);
    expect(claim.body.entry).toMatchObject({ kind: 'refund_due', status: 'pending', amount: 30000, currency: 'INR', paymentRequest: { number: pr.number } });
    // Waiting for accounts: not owed yet, shown as pending.
    expect((await credit(arb)).balances).toEqual([expect.objectContaining({ currency: 'INR', owed: 0, pending: 30000 })]);
    // Procurement cannot approve; accounts can.
    expect((await procurement.session.post(`/suppliers/credit/${claim.body.entry.id}/approve`)).status).toBe(403);
    expect((await accounts.session.post(`/suppliers/credit/${claim.body.entry.id}/approve`)).status).toBe(200);
    expect(await owed(arb)).toBe(30000);
    const after = (await procurement.session.get(`/payment-requests/order/${order._id}`)).body;
    expect(after.requests.find((p) => p.id === pr.id).supplierRefund).toMatchObject({ claim: { status: 'approved', amount: 30000 }, canClaim: false });

    const back = await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 15000, date: ymd(), reference: 'UTR-BACK-1', formKey: fk() });
    expect(back.status).toBe(201);
    expect(await owed(arb)).toBe(30000); // not until accounts approves
    expect((await accounts.session.post(`/suppliers/credit/${back.body.entry.id}/approve`)).status).toBe(200);
    expect(await owed(arb)).toBe(15000);

    // Next order, ₹40,000 bill, ₹15,000 from credit.
    const o2 = await paidOrder();
    const next = await raise(String(o2._id), String(o2.items[0]._id), arb, 40000, { creditToUse: 15000 });
    expect(next.status).toBe(201);
    expect(next.body.request).toMatchObject({ amount: 25000, bill: 40000, credit: { amount: 15000 } });
    expect(await owed(arb)).toBe(0);
    const hist = (await credit(arb)).entries.map((e) => [e.kind, e.status, e.signedAmount]);
    expect(hist).toEqual([['credit_used', 'approved', -15000], ['repaid', 'approved', -15000], ['refund_due', 'approved', 30000]]);
    // What the admin pays is the ₹25,000; the slip renders with the credit block.
    const slip = await accounts.session.get(`/payment-requests/${next.body.request.id}/slip`);
    expect(slip.status).toBe(200);
    const paid = await approveAndPay(next.body.request.id);
    expect(paid.amount).toBe(25000);
    // The cancelled payment's detail carries the claim too (refund button / status).
    expect((await procurement.session.get(`/payment-requests/${pr.id}`)).body.request.supplierRefund).toMatchObject({ claim: { status: 'approved' }, canClaim: false });
  });

  it('leftover credit carries forward; partial use leaves the rest', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const o2 = await paidOrder();
    expect((await raise(String(o2._id), String(o2.items[0]._id), arb, 12000, { creditToUse: 10000 })).body.request.amount).toBe(2000);
    expect(await owed(arb)).toBe(20000);
    expect((await raise(String(o2._id), String(o2.items[1]._id), arb, 5000, { creditToUse: 4999.99 })).body.request.amount).toBe(0.01);
    expect(await owed(arb)).toBe(15000.01);
  });

  it('credit cannot be more than the balance, the whole bill, or another currency', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const o2 = await paidOrder();
    const id = String(o2._id);
    const kit = String(o2.items[0]._id);
    const over = await raise(id, kit, arb, 50000, { creditToUse: 30000.01 });
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/credit in INR is ₹30,000/);
    const whole = await raise(id, kit, arb, 20000, { creditToUse: 20000 });
    expect(whole.status).toBe(400);
    expect(whole.body.message).toMatch(/less than the bill/);
    const thb = await raise(id, kit, arb, 20000, { creditToUse: 100, currency: 'THB' });
    expect(thb.status).toBe(409);
    expect(thb.body.message).toMatch(/no credit in THB/);
    // Typed payee details (no saved supplier): no credit.
    const typed = await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [kit], amount: 20000, payee: BANK, creditToUse: 100 });
    expect(typed.status).toBe(400);
    expect(await PaymentRequest.countDocuments({ order: o2._id })).toBe(0);
    expect(await owed(arb)).toBe(30000);
  });

  it('foreign credit pays only a bill in the same currency, and nets the foreign amount', async () => {
    const thai = await saveSupplier(THAI);
    await owesUs(thai, 10000, { currency: 'THB' });
    expect((await credit(thai)).balances).toEqual([expect.objectContaining({ currency: 'THB', owed: 10000, owedText: 'THB 10,000' })]);
    const o2 = await paidOrder();
    const inr = await raise(String(o2._id), String(o2.items[0]._id), thai, 5000, { creditToUse: 100 });
    expect(inr.status).toBe(409);
    const ok = await raise(String(o2._id), String(o2.items[0]._id), thai, 22950, { currency: 'THB', creditToUse: 2950 });
    expect(ok.status).toBe(201);
    expect(ok.body.request).toMatchObject({ currency: 'THB', foreignAmount: 20000, amount: 0, rupeesPending: true, bill: 22950, credit: { amount: 2950 } });
    expect(await owed(thai, 'THB')).toBe(7050);
  });

  it('two payments using the same credit at once cannot both spend it', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const o2 = await paidOrder();
    const results = await Promise.all([
      raise(String(o2._id), String(o2.items[0]._id), arb, 40000, { creditToUse: 20000 }),
      raise(String(o2._id), String(o2.items[1]._id), arb, 40000, { creditToUse: 20000 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await owed(arb)).toBe(10000);
    expect(await SupplierLedgerEntry.countDocuments({ kind: 'credit_used' })).toBe(1);
    expect(await PaymentRequest.countDocuments({ order: o2._id })).toBe(1);
  });

  it('a declined, cancelled or auto-withdrawn payment gives its credit back — once', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const o2 = await paidOrder();
    const id = String(o2._id);
    const a = (await raise(id, String(o2.items[0]._id), arb, 10000, { creditToUse: 5000 })).body.request;
    expect(await owed(arb)).toBe(25000);
    expect((await accounts.session.post(`/payment-requests/${a.id}/decline`, { note: 'Wrong supplier' })).status).toBe(200);
    await accounts.session.post(`/payment-requests/${a.id}/decline`, { note: 'retry' }); // a retry
    expect(await owed(arb)).toBe(30000);

    const b = (await raise(id, String(o2.items[0]._id), arb, 10000, { creditToUse: 6000 })).body.request;
    expect(await owed(arb)).toBe(24000);
    expect((await procurement.session.post(`/payment-requests/${b.id}/cancel`)).status).toBe(200);
    expect(await owed(arb)).toBe(30000);

    // Waiting for accounts when the customer cancels the item: withdrawn, credit back.
    const c = (await raise(id, String(o2.items[1]._id), arb, 3000, { creditToUse: 1000 })).body.request;
    expect(await owed(arb)).toBe(29000);
    await cancellationService.cancelLines(id, { lines: [{ itemId: String(o2.items[1]._id), quantity: 1 }], reason: 'customer_request' }, { userId: admin.user._id });
    expect((await PaymentRequest.findById(c.id).lean()).status).toBe('cancelled');
    expect(await owed(arb)).toBe(30000);
    // Running the restore again (a retry) adds nothing.
    await ledger.restoreCredit(await PaymentRequest.findById(c.id).lean(), 'again');
    expect(await owed(arb)).toBe(30000);
    expect(await SupplierLedgerEntry.countDocuments({ kind: 'credit_restored' })).toBe(3);
  });

  it('editing a payment that used credit: the typed amount is the bill, the credit and supplier stay', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const other = await saveSupplier({ ...ARB, name: 'Other Supplies', phone: '9800000002' });
    const o2 = await paidOrder();
    const r = (await raise(String(o2._id), String(o2.items[0]._id), arb, 40000, { creditToUse: 15000 })).body.request;
    const edit = await procurement.session.put(`/payment-requests/${r.id}`, { amount: 45000 });
    expect(edit.status).toBe(200);
    expect(edit.body.request).toMatchObject({ amount: 30000, bill: 45000, credit: { amount: 15000 } });
    expect((await procurement.session.put(`/payment-requests/${r.id}`, { amount: 15000 })).status).toBe(400);
    const swap = await procurement.session.put(`/payment-requests/${r.id}`, { supplierId: other });
    expect(swap.status).toBe(409);
    expect(swap.body.message).toMatch(/supplier cannot change/);
    expect(await owed(arb)).toBe(15000);
  });

  it('a double-clicked claim or repayment saves once', async () => {
    const arb = await saveSupplier();
    const { pr } = await paidThenCancelled(arb);
    const claims = await Promise.all([1, 2, 3].map(() => procurement.session.post('/suppliers/credit/claims', { paymentRequestId: pr.id })));
    expect(claims.every((c) => c.status === 201)).toBe(true);
    expect(new Set(claims.map((c) => c.body.entry.id)).size).toBe(1);
    expect(await SupplierLedgerEntry.countDocuments({ kind: 'refund_due' })).toBe(1);
    await accounts.session.post(`/suppliers/credit/${claims[0].body.entry.id}/approve`);
    const body = { currency: 'INR', amount: 1000, date: ymd(), reference: 'R1', formKey: fk() };
    const reps = await Promise.all([1, 2].map(() => procurement.session.post(`/suppliers/${arb}/credit/repayments`, body)));
    expect(new Set(reps.map((r) => r.body.entry.id)).size).toBe(1);
    // A double-clicked approval approves once.
    const clicks = await Promise.all([1, 2, 3].map(() => accounts.session.post(`/suppliers/credit/${reps[0].body.entry.id}/approve`)));
    expect(clicks.filter((c) => c.status === 200)).toHaveLength(1);
    expect(await owed(arb)).toBe(29000);
  });

  it('a repayment can never take the balance below zero, even approved together', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const too = await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 30000.01, date: ymd(), formKey: fk() });
    expect(too.status).toBe(409);
    // Two ₹20,000 repayments both fit on their own; approving both at once lets only one through.
    const r1 = (await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 20000, date: ymd(), formKey: fk() })).body.entry;
    const r2 = (await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 20000, date: ymd(), formKey: fk() })).body.entry;
    const res = await Promise.all([accounts.session.post(`/suppliers/credit/${r1.id}/approve`), accounts2.session.post(`/suppliers/credit/${r2.id}/approve`)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await owed(arb)).toBe(10000);
    // Bad dates refused.
    expect((await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 1, date: ymd(3), formKey: fk() })).status).toBe(400);
    expect((await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 1, date: '2026-02-30', formKey: fk() })).status).toBe(400);
    expect((await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 1, date: ymd() })).status).toBe(400);
  });

  it('claims: only paid payments for cancelled items, saved suppliers, at most the bill; decline lets a corrected one be raised', async () => {
    const arb = await saveSupplier();
    const order = await paidOrder();
    const id = String(order._id);
    const kit = String(order.items[0]._id);
    const live = (await raise(id, kit, arb, 30000)).body.request;
    await approveAndPay(live.id);
    const notCancelled = await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: live.id });
    expect(notCancelled.status).toBe(409);
    expect(notCancelled.body.message).toMatch(/not cancelled/);
    await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' });
    expect((await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: live.id, amount: 30000.01 })).status).toBe(400);
    expect((await ops.session.post('/suppliers/credit/claims', { paymentRequestId: live.id })).status).toBe(403);
    expect((await accounts.session.post('/suppliers/credit/claims', { paymentRequestId: live.id })).status).toBe(403);
    const c1 = (await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: live.id, amount: 25000 })).body.entry;
    expect((await accounts.session.post(`/suppliers/credit/${c1.id}/decline`, {})).status).toBe(400); // needs a reason
    expect((await accounts.session.post(`/suppliers/credit/${c1.id}/decline`, { note: 'They refunded ₹30,000, not 25' })).status).toBe(200);
    const c2 = await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: live.id });
    expect(c2.status).toBe(201);
    expect(c2.body.entry.id).not.toBe(c1.id);
    // Cancelled by whoever raised it; then a third can be raised.
    expect((await accounts.session.post(`/suppliers/credit/${c2.body.entry.id}/cancel`)).status).toBe(403);
    expect((await procurement.session.post(`/suppliers/credit/${c2.body.entry.id}/cancel`)).status).toBe(200);
    expect((await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: live.id })).status).toBe(201);
    // Paid to typed details: cannot be claimed until saved.
    const o3 = await paidOrder();
    const typed = (await procurement.session.form('/payment-requests/supplier', { orderId: String(o3._id), itemIds: [String(o3.items[0]._id)], amount: 500, payee: BANK })).body.request;
    await approveAndPay(typed.id);
    await orderStatusService.updateOrderStatus(String(o3._id), 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' });
    const t = await procurement.session.post('/suppliers/credit/claims', { paymentRequestId: typed.id });
    expect(t.status).toBe(409);
    expect(t.body.message).toMatch(/save .* in the directory/);
  });

  it('an admin may approve their own; accounts may not approve what they raised; write-off is admin only and capped', async () => {
    const arb = await saveSupplier();
    const { pr } = await paidThenCancelled(arb);
    const own = (await admin.session.post('/suppliers/credit/claims', { paymentRequestId: pr.id })).body.entry;
    expect((await admin.session.post(`/suppliers/credit/${own.id}/approve`)).status).toBe(200);
    expect((await procurement.session.post(`/suppliers/${arb}/credit/write-offs`, { currency: 'INR', amount: 100, note: 'x', formKey: fk() })).status).toBe(403);
    expect((await admin.session.post(`/suppliers/${arb}/credit/write-offs`, { currency: 'INR', amount: 30000.01, note: 'gone', formKey: fk() })).status).toBe(409);
    expect((await admin.session.post(`/suppliers/${arb}/credit/write-offs`, { currency: 'INR', amount: 1000, formKey: fk() })).status).toBe(400);
    const key = fk();
    const w = await Promise.all([1, 2].map(() => admin.session.post(`/suppliers/${arb}/credit/write-offs`, { currency: 'INR', amount: 1000, note: 'Supplier closed', formKey: key })));
    expect(w.map((r) => r.status)).toEqual([201, 201]);
    expect(await owed(arb)).toBe(29000);
    // Operations sees nothing.
    expect((await ops.session.get(`/suppliers/${arb}/credit`)).status).toBe(403);
  });

  it('accounts sees the queue and who owes us; history pages by cursor; the CSV report covers a date range', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    for (let i = 0; i < 55; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await procurement.session.post(`/suppliers/${arb}/credit/repayments`, { currency: 'INR', amount: 1, date: ymd(), reference: `R${i}`, formKey: fk() });
    }
    const q1 = (await accounts.session.get('/suppliers/credit/pending')).body;
    expect(q1.entries).toHaveLength(50);
    const q2 = (await accounts.session.get(`/suppliers/credit/pending?after=${encodeURIComponent(q1.nextAfter)}`)).body;
    expect(q2.entries).toHaveLength(5);
    expect(q2.nextAfter).toBeNull();
    expect(new Set([...q1.entries, ...q2.entries].map((e) => e.id)).size).toBe(55);
    const h1 = await credit(arb);
    const h2 = (await accounts.session.get(`/suppliers/${arb}/credit?after=${encodeURIComponent(h1.nextAfter)}`)).body;
    expect(h1.entries.length + h2.entries.length).toBe(56);
    expect(h2.balances).toBeUndefined(); // only on the first page

    const owing = (await accounts.session.get('/suppliers/credit/owing')).body.suppliers;
    expect(owing).toEqual([expect.objectContaining({ supplier: { id: arb, name: 'ARB Supplies' }, currency: 'INR', owed: 30000, pending: -55 })]);

    const csv = await accounts.session.get(`/suppliers/credit/report.csv?from=${ymd(-1)}&to=${ymd()}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toMatch(/^Date,Supplier,What,Status,Currency,Amount/);
    expect(lines).toHaveLength(1 + 56);
    expect(lines[1]).toMatch(/ARB Supplies,Refund due,Approved,INR,30000.00,30000.00/);
    expect((await accounts.session.get('/suppliers/credit/report.csv?from=2026-01-01&to=2025-01-01')).status).toBe(400);
  });

  it('the directory list shows what each supplier owes', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const list = (await procurement.session.get('/suppliers')).body.suppliers;
    expect(list.find((s) => s.id === arb).credit).toEqual([expect.objectContaining({ currency: 'INR', owed: 30000 })]);
  });

  it('the history and queue read through their indexes (no collection scan)', async () => {
    const arb = await saveSupplier();
    await owesUs(arb, 30000);
    const plan = async (filter, sort) => JSON.stringify((await SupplierLedgerEntry.find(filter).sort(sort).limit(51).explain('queryPlanner')));
    expect(await plan({ supplier: new mongoose.Types.ObjectId(arb) }, { createdAt: -1, _id: -1 })).toMatch(/supplier_ledger_supplier/);
    expect(await plan({ status: 'pending' }, { createdAt: -1, _id: -1 })).toMatch(/supplier_ledger_status/);
    expect(await plan({ supplier: new mongoose.Types.ObjectId(arb) }, { createdAt: -1, _id: -1 })).not.toMatch(/COLLSCAN/);
  });
});
