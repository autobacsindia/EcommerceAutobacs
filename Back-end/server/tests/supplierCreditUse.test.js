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

const { default: SupplierLedgerEntry, LEDGER_SIGN } = await import('../models/SupplierLedgerEntry.js');
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


const SAME_ARB_PAY = ARB.payment;

describe('Using supplier credit on supplier payments', () => {
  beforeAll(async () => { await dbHandler.connect(); await SupplierLedgerEntry.init(); await PaymentRequest.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); await dbHandler.clearDatabase(); });

  let admin, accounts, procurement, procurement2, ops;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    procurement2 = await makeUser('Rahul', 'staff', staff('procurement'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
  });

  const saveSupplier = async (body = ARB) => {
    const res = await procurement.session.post('/suppliers', body);
    expect(res.status).toBe(201);
    return res.body.supplier.id;
  };
  /** The supplier owes us `amount` (a credit note, approved by accounts). */
  const giveCredit = async (supplierId, amount, currency = 'INR') => {
    const r = await procurement.session.form(`/suppliers/${supplierId}/credit/entries`, {
      type: 'credit_given', amount, currency, date: ymd(), reason: 'Credit note CN-1', formKey: fk(),
    });
    expect(r.status).toBe(201);
    expect((await accounts.session.post(`/suppliers/credit/${r.body.entry.id}/approve`)).status).toBe(200);
  };
  const owed = async (supplierId, currency = 'INR') => (await accounts.session.get(`/suppliers/${supplierId}/credit`))
    .body.balances.find((b) => b.currency === currency)?.owed ?? 0;
  const orderPay = (who, order, i, supplierId, amount, extra = {}) => who.session.form('/payment-requests/supplier', {
    orderId: String(order._id), itemIds: [String(order.items[i]._id)], amount, supplierId, ...extra,
  });
  const stockPay = (who, supplierId, amount, extra = {}) => who.session.form('/payment-requests/supplier', {
    amount, description: '20 floor mats, bill 4471', supplierId, ...extra,
  }, [{ field: 'bill', buffer: JPEG, name: 'bill.jpg', type: 'image/jpeg' }]);
  const setCredit = (who, id, body) => who.session.post(`/payment-requests/${id}/credit`, body);
  const pay = (id) => admin.session.form(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR1' });

  describe('raising a payment with the "Use supplier credit" tick', () => {
    it('partial: ₹40,000 bill with ₹15,000 credit → ₹25,000 to pay, credit 0; accounts approves, the admin pays ₹25,000', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 15000);
      const order = await paidOrder();
      const res = await orderPay(procurement, order, 0, arb, 40000, { useCredit: 'true' });
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ status: 'submitted', amount: 25000, bill: 40000, credit: { amount: 15000 }, paidByCredit: false });
      expect(await owed(arb)).toBe(0);
      // Accounts sees the full bill, the credit and what is left to pay.
      const seen = (await accounts.session.get(`/payment-requests/${res.body.request.id}`)).body.request;
      expect(seen).toMatchObject({ amount: 25000, bill: 40000, credit: { amount: 15000 }, can: { approve: true } });
      expect((await accounts.session.post(`/payment-requests/${seen.id}/approve`)).status).toBe(200);
      const paid = await pay(seen.id);
      expect(paid.status).toBe(200);
      expect(paid.body.request).toMatchObject({ status: 'paid', amount: 25000 });
    });

    it('credit bigger than the bill: ₹1,00,000 bill, ₹2,00,000 credit → pay ₹0, ₹1,00,000 credit left; approving closes it as paid (no admin step)', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 200000);
      const order = await paidOrder();
      const res = await orderPay(procurement, order, 0, arb, 100000, { useCredit: true });
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ status: 'submitted', amount: 0, bill: 100000, credit: { amount: 100000 }, paidByCredit: true });
      expect(await owed(arb)).toBe(100000);
      // Nothing for the admin to pay: no Pay button, and paying is refused.
      const forAdmin = (await admin.session.get(`/payment-requests/${res.body.request.id}`)).body.request;
      expect(forAdmin.can.pay).toBe(false);
      const refused = await pay(res.body.request.id);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/nothing to transfer/);
      // Accounts approves → closed as paid from credit; the item moves on like a paid one.
      const ok = await accounts.session.post(`/payment-requests/${res.body.request.id}/approve`);
      expect(ok.status).toBe(200);
      expect(ok.body.request).toMatchObject({ status: 'paid', amount: 0, payment: expect.objectContaining({ method: 'credit', reference: 'Supplier credit' }) });
      // No payment record to "correct" (it would turn into a bank transfer that never happened); the receipt renders.
      expect(ok.body.request.can.editPayment).toBe(false);
      expect((await admin.session.formPut(`/payment-requests/${res.body.request.id}/payment`, { method: 'bank', reference: 'X' })).status).toBe(409);
      const slip = await accounts.session.get(`/payment-requests/${res.body.request.id}/slip`);
      expect(slip.status).toBe(200);
      // Not in the admin's "to pay" queue.
      const groups = (await admin.session.get('/payment-requests/to-pay/suppliers')).body.groups || [];
      expect(groups).toHaveLength(0);
      // The next payment uses the ₹1,00,000 left.
      const next = await orderPay(procurement, order, 1, arb, 30000, { useCredit: true });
      expect(next.body.request).toMatchObject({ amount: 0, credit: { amount: 30000 } });
      expect(await owed(arb)).toBe(70000);
    });

    it('exactly the credit: the whole bill is covered and the balance is 0', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 20000);
      const order = await paidOrder();
      const res = await orderPay(procurement, order, 0, arb, 20000, { creditToUse: 20000 });
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ amount: 0, credit: { amount: 20000 }, paidByCredit: true });
      expect(await owed(arb)).toBe(0);
    });

    it('zero credit: the tick is refused (no silent full-price payment), no tick raises at full price', async () => {
      const arb = await saveSupplier();
      const order = await paidOrder();
      const res = await orderPay(procurement, order, 0, arb, 5000, { useCredit: true });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/no credit in INR/);
      expect(await PaymentRequest.countDocuments({})).toBe(0);
      const plain = await orderPay(procurement, order, 0, arb, 5000);
      expect(plain.status).toBe(201);
      expect(plain.body.request).toMatchObject({ amount: 5000, credit: null, paidByCredit: false });
    });

    it('accounts or the admin raising a fully covered payment: closed as paid at once, no chat to approve or pay', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 50000);
      const res = await stockPay(accounts, arb, 12000, { useCredit: true });
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ status: 'paid', amount: 0, credit: { amount: 12000 }, payment: expect.objectContaining({ method: 'credit' }) });
      const byAdmin = await stockPay(admin, arb, 8000, { useCredit: true });
      expect(byAdmin.body.request.status).toBe('paid');
      expect(await owed(arb)).toBe(30000);
      const asks = await ChatMessage.countDocuments({ body: { $regex: /please approve|please pay/i } });
      expect(asks).toBe(0);
      // Recorded in the ledger as used on those payments, by who.
      const used = await SupplierLedgerEntry.find({ kind: 'credit_used' }).sort({ createdAt: 1 }).lean();
      expect(used.map((e) => [e.paymentRequestNumber, e.amountPaise, e.createdByName])).toEqual([
        [res.body.request.number, 1200000, 'Anu'], [byAdmin.body.request.number, 800000, 'Owner'],
      ]);
    });

    it('"Pay a supplier" (stock) and a bill we owe take credit too; the bill counts the credit as paid', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 10000);
      const stock = await stockPay(procurement, arb, 12000, { useCredit: true });
      expect(stock.status).toBe(201);
      expect(stock.body.request).toMatchObject({ amount: 2000, bill: 12000, credit: { amount: 10000 } });
      expect(await owed(arb)).toBe(0);

      await giveCredit(arb, 6000);
      const b = await procurement.session.form('/supplier-bills', { supplierId: arb, billNumber: 'INV-9', billDate: ymd(-1), dueDate: ymd(10), amount: 26000, description: 'mats' },
        [{ field: 'bill', buffer: PDF, name: 'b.pdf', type: 'application/pdf' }]);
      expect(b.status).toBe(201);
      const billPay = await procurement.session.form('/payment-requests/supplier', { supplierBillId: b.body.bill.id, amount: 26000, useCredit: true }, []);
      expect(billPay.status).toBe(201);
      expect(billPay.body.request).toMatchObject({ amount: 20000, credit: { amount: 6000 } });
      // The whole ₹26,000 is asked for (reserved) — none left to ask.
      let bill = (await procurement.session.get(`/supplier-bills/${b.body.bill.id}`)).body.bill;
      expect(bill).toMatchObject({ leftToAsk: 0, waiting: 26000 });
      expect((await accounts.session.post(`/payment-requests/${billPay.body.request.id}/approve`)).status).toBe(200);
      expect((await pay(billPay.body.request.id)).status).toBe(200);
      bill = (await procurement.session.get(`/supplier-bills/${b.body.bill.id}`)).body.bill;
      expect(bill).toMatchObject({ paid: 26000, owed: 0 });
      // A declined bill payment gives back the WHOLE share (and the credit).
      await giveCredit(arb, 1000);
      const b2 = await procurement.session.form('/supplier-bills', { supplierId: arb, billNumber: 'INV-10', billDate: ymd(-1), dueDate: ymd(10), amount: 5000, description: 'mats' },
        [{ field: 'bill', buffer: PDF, name: 'b.pdf', type: 'application/pdf' }]);
      const p2 = await procurement.session.form('/payment-requests/supplier', { supplierBillId: b2.body.bill.id, amount: 5000, useCredit: true }, []);
      expect(p2.body.request).toMatchObject({ amount: 4000, credit: { amount: 1000 } });
      expect((await accounts.session.post(`/payment-requests/${p2.body.request.id}/decline`, { note: 'Wrong bill' })).status).toBe(200);
      expect((await procurement.session.get(`/supplier-bills/${b2.body.bill.id}`)).body.bill).toMatchObject({ leftToAsk: 5000 });
      expect(await owed(arb)).toBe(1000);
    });

    it('two payments ticking the same credit at once: one spends it, the other is refused — never below zero', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 30000);
      const order = await paidOrder();
      const results = await Promise.all([
        orderPay(procurement, order, 0, arb, 25000, { useCredit: true }),
        stockPay(procurement2, arb, 25000, { useCredit: true }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(await owed(arb)).toBe(5000);
      expect(await SupplierLedgerEntry.countDocuments({ kind: 'credit_used' })).toBe(1);
      expect(await PaymentRequest.countDocuments({})).toBe(1);
    });

    it('tampered input: a client "amount to pay", negative or oversized credit, or credit on a typed (unsaved) payee are never trusted', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 10000);
      const order = await paidOrder();
      // The amount sent is the BILL; the server computes what is transferred. A client "credit" object is ignored.
      const sneaky = await orderPay(procurement, order, 0, arb, 40000, { creditToUse: 10000, credit: JSON.stringify({ amount: 40000 }), bill: 1 });
      expect(sneaky.status).toBe(201);
      expect(sneaky.body.request).toMatchObject({ amount: 30000, bill: 40000, credit: { amount: 10000 } });
      await giveCredit(arb, 10000);
      for (const bad of ['-500', 'abc', '10000.01', '999999999999']) {
        const r = await orderPay(procurement, order, 1, arb, 5000, { creditToUse: bad });
        expect([400, 409]).toContain(r.status);
      }
      const over = await orderPay(procurement, order, 1, arb, 5000, { creditToUse: 6000 });
      expect(over.status).toBe(400);
      expect(over.body.message).toMatch(/more than the bill/);
      // Typed details saved as a NEW supplier in the same submit: no credit (and nothing saved).
      const typed = await procurement.session.form('/payment-requests/supplier', {
        amount: 5000, description: '20 floor mats, bill 4471', payee: { ...SAME_ARB_PAY, name: 'ARB Typed Traders', phone: '9811111111' }, saveSupplier: 'true', useCredit: 'true',
      }, [{ field: 'bill', buffer: JPEG, name: 'bill.jpg', type: 'image/jpeg' }]);
      expect(typed.status).toBe(400);
      expect(typed.body.message).toMatch(/saved supplier/);
      expect(await Supplier.countDocuments({ name: 'ARB Typed Traders' })).toBe(0);
      expect(await owed(arb)).toBe(10000);
    });

    it('role access: operations staff may pay a supplier but not use credit; the picker shows them no credit', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 10000);
      const r = await stockPay(ops, arb, 5000, { useCredit: true });
      expect(r.status).toBe(403);
      expect(r.body.success).not.toBe(true);
      const picker = (await ops.session.get('/suppliers?prefix=ARB')).body.suppliers;
      expect(picker[0].credit).toEqual([]);
      expect(await owed(arb)).toBe(10000);
      // Without the tick they still raise it, at full price.
      expect((await stockPay(ops, arb, 5000)).status).toBe(201);
    });
  });

  describe('changing the credit on a waiting payment (POST /:id/credit)', () => {
    it('accounts adds credit to procurement\'s waiting payment; removing it gives it all back; history and ledger say who', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 8000);
      const order = await paidOrder();
      const r = (await orderPay(procurement, order, 0, arb, 20000)).body.request;
      const add = await setCredit(accounts, r.id, { useCredit: true, rev: r.rev });
      expect(add.status).toBe(200);
      expect(add.body.request).toMatchObject({ amount: 12000, bill: 20000, credit: { amount: 8000 }, rev: 1 });
      expect(await owed(arb)).toBe(0);
      // The same click again is a no-op (nothing more to use).
      expect((await setCredit(accounts, r.id, { useCredit: true })).body.request.credit.amount).toBe(8000);
      const off = await setCredit(admin, r.id, { creditToUse: 0 });
      expect(off.status).toBe(200);
      expect(off.body.request).toMatchObject({ amount: 20000, credit: null, bill: null });
      expect(await owed(arb)).toBe(8000);
      const one = (await accounts.session.get(`/payment-requests/${r.id}`)).body.request;
      expect(one.edits.map((e) => [e.byName, e.changes[0].field, e.changes[0].from, e.changes[0].to])).toEqual([
        ['Anu', 'Supplier credit', 'none', '₹8,000'], ['Owner', 'Supplier credit', '₹8,000', 'none'],
      ]);
      const rows = await SupplierLedgerEntry.find({ paymentRequest: r.id }).sort({ createdAt: 1 }).lean();
      expect(rows.map((e) => [e.kind, e.amountPaise, e.createdByName])).toEqual([['credit_used', 800000, 'Anu'], ['credit_restored', 800000, 'Owner']]);
    });

    it('who: procurement on their own only; operations never; not after approval', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 8000);
      const order = await paidOrder();
      const r = (await orderPay(procurement, order, 0, arb, 20000)).body.request;
      expect((await setCredit(procurement2, r.id, { useCredit: true })).status).toBe(403);
      expect((await setCredit(ops, r.id, { useCredit: true })).status).toBe(404); // cannot even see it
      const mine = await setCredit(procurement, r.id, { creditToUse: 3000 });
      expect(mine.status).toBe(200);
      expect(mine.body.request.can.credit).toBe(true);
      expect((await accounts.session.post(`/payment-requests/${r.id}/approve`)).status).toBe(200);
      // After approval: procurement can no longer change the money; accounts (the approver) still can.
      expect((await setCredit(procurement, r.id, { useCredit: true })).status).toBe(403);
      const late = await setCredit(accounts, r.id, { useCredit: true });
      expect(late.body.request).toMatchObject({ status: 'approved', amount: 12000, credit: { amount: 8000 } });
      expect(await owed(arb)).toBe(0);
      // Paid: nobody changes it any more.
      expect((await pay(r.id)).status).toBe(200);
      expect((await setCredit(admin, r.id, { creditToUse: 0 })).status).toBe(409);
    });

    it('a stale screen (old rev) is refused; two credit changes at once cannot both spend it', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 10000);
      const order = await paidOrder();
      const a = (await orderPay(procurement, order, 0, arb, 10000)).body.request;
      const b = (await stockPay(procurement, arb, 10000)).body.request;
      const both = await Promise.all([setCredit(accounts, a.id, { creditToUse: 10000 }), setCredit(admin, b.id, { creditToUse: 10000 })]);
      expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(await owed(arb)).toBe(0);
      const stale = await setCredit(accounts, a.id, { creditToUse: 0, rev: 0 });
      // Whichever won, `a` was either changed (rev 1) or not (rev 0): a stale rev only fails once it moved.
      const now = (await accounts.session.get(`/payment-requests/${a.id}`)).body.request;
      if (now.rev > 0 && now.credit) expect(stale.status).toBe(409);
    });
  });

  describe('edit, decline, cancel', () => {
    it('editing the bill below the credit lowers the credit to the bill and gives the rest back; above leaves it', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 15000);
      const order = await paidOrder();
      const r = (await orderPay(procurement, order, 0, arb, 40000, { useCredit: true })).body.request;
      expect(await owed(arb)).toBe(0);
      const up = await procurement.session.put(`/payment-requests/${r.id}`, { reason: 'Correct bill', amount: 45000 });
      expect(up.body.request).toMatchObject({ amount: 30000, bill: 45000, credit: { amount: 15000 } });
      const down = await procurement.session.put(`/payment-requests/${r.id}`, { reason: 'Supplier gave a discount', amount: 10000 });
      expect(down.status).toBe(200);
      expect(down.body.request).toMatchObject({ amount: 0, bill: 10000, credit: { amount: 10000 }, paidByCredit: true });
      expect(await owed(arb)).toBe(5000);
      const one = (await accounts.session.get(`/payment-requests/${r.id}`)).body.request;
      expect(one.edits.at(-1).changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Supplier credit', to: '₹10,000 (₹5,000 given back)' })]));
      // Declined afterwards: the remaining ₹10,000 comes back — once.
      expect((await accounts.session.post(`/payment-requests/${r.id}/decline`, { note: 'Not needed' })).status).toBe(200);
      expect((await accounts.session.post(`/payment-requests/${r.id}/decline`, { note: 'again' })).status).toBe(409);
      await ledger.restoreCredit(await PaymentRequest.findById(r.id).lean(), 'retry');
      expect(await owed(arb)).toBe(15000);
    });

    it('cancelling a fully covered payment gives the credit back once', async () => {
      const arb = await saveSupplier();
      await giveCredit(arb, 5000);
      const r = (await stockPay(procurement, arb, 5000, { useCredit: true })).body.request;
      expect(r).toMatchObject({ status: 'submitted', paidByCredit: true });
      expect((await procurement.session.post(`/payment-requests/${r.id}/cancel`)).status).toBe(200);
      expect((await procurement.session.post(`/payment-requests/${r.id}/cancel`)).status).toBe(409);
      expect(await owed(arb)).toBe(5000);
      expect(await SupplierLedgerEntry.countDocuments({ kind: 'credit_restored' })).toBe(1);
    });

    it('a foreign bill covered by credit in its currency: nothing to transfer, no rupees pending', async () => {
      const thai = await saveSupplier(THAI);
      await giveCredit(thai, 30000, 'THB');
      const r = await stockPay(procurement, thai, 22950, { currency: 'THB', useCredit: true });
      expect(r.status).toBe(201);
      expect(r.body.request).toMatchObject({ currency: 'THB', foreignAmount: 0, amount: 0, rupeesPending: false, paidByCredit: true, credit: { amount: 22950 } });
      expect(await owed(thai, 'THB')).toBe(7050);
      // A rupee bill cannot use THB credit.
      expect((await stockPay(procurement, thai, 1000, { useCredit: true })).status).toBe(409);
    });
  });

  describe('a supplier bill we owe, paid with the supplier\'s credit (SB-0001 / PR-0149)', () => {
    const addBill = (amount, extra = {}) => procurement.session.form('/supplier-bills', {
      billDate: ymd(-1), amount, description: '2 Thor storm speakers + 1 echo + 1 ecu', ...extra,
    }, [{ field: 'bill', buffer: PDF, name: 'b.pdf', type: 'application/pdf' }]);

    it('the payment is already approved and on hold: accounts uses the credit → closed as paid, the bill is paid, the rest of the credit stays', async () => {
      const rk = await saveSupplier({ ...ARB, name: 'RK New Popular', phone: '9800000009' });
      const order = await paidOrder();
      const b = (await addBill(75000, { supplierId: rk, orderId: String(order._id) })).body.bill;
      const pr = (await procurement.session.form('/payment-requests/supplier', { supplierBillId: b.id, amount: 75000 }, [])).body.request;
      expect((await accounts.session.post(`/payment-requests/${pr.id}/approve`)).status).toBe(200);
      expect((await accounts.session.post(`/payment-requests/${pr.id}/hold`, { note: 'Funds on Friday' })).status).toBe(200);
      await giveCredit(rk, 100000);
      // Procurement cannot change money accounts has approved; accounts can.
      expect((await setCredit(procurement, pr.id, { useCredit: true })).status).toBe(403);
      const view = (await accounts.session.get(`/payment-requests/${pr.id}`)).body.request;
      expect(view).toMatchObject({ status: 'on_hold', can: { credit: true } });
      const used = await setCredit(accounts, pr.id, { useCredit: true, rev: view.rev });
      expect(used.status).toBe(200);
      expect(used.body.request).toMatchObject({ status: 'paid', amount: 0, bill: 75000, credit: { amount: 75000 }, payment: expect.objectContaining({ method: 'credit' }) });
      expect(await owed(rk)).toBe(25000);
      const bill = (await procurement.session.get(`/supplier-bills/${b.id}`)).body.bill;
      expect(bill).toMatchObject({ paid: 75000, owed: 0, state: 'paid' });
      const row = await SupplierLedgerEntry.findOne({ kind: 'credit_used', paymentRequest: pr.id }).lean();
      expect(row.history[0].note).toMatch(new RegExp(`${pr.number} for supplier bill`));
      expect(row.createdByName).toBe('Anu');
    });

    it('credit smaller than the approved payment: the rest stays approved for the admin, who pays only the rest; the bill counts both', async () => {
      const rk = await saveSupplier();
      const b = (await addBill(75000, { supplierId: rk })).body.bill;
      const pr = (await procurement.session.form('/payment-requests/supplier', { supplierBillId: b.id, amount: 75000 }, [])).body.request;
      expect((await accounts.session.post(`/payment-requests/${pr.id}/approve`)).status).toBe(200);
      await giveCredit(rk, 30000);
      const before = (await admin.session.get(`/payment-requests/${pr.id}`)).body.request;
      const used = await setCredit(accounts, pr.id, { useCredit: true });
      expect(used.body.request).toMatchObject({ status: 'approved', amount: 45000, credit: { amount: 30000 } });
      // The admin's old screen (₹75,000) is refused: the amount changed.
      const stale = await admin.session.form(`/payment-requests/${pr.id}/pay`, { method: 'bank', reference: 'UTR', payVersion: before.payVersion });
      expect(stale.status).toBe(409);
      expect((await pay(pr.id)).body.request).toMatchObject({ status: 'paid', amount: 45000 });
      expect((await procurement.session.get(`/supplier-bills/${b.id}`)).body.bill).toMatchObject({ paid: 75000, owed: 0 });
      expect(await owed(rk)).toBe(0);
    });

    it('the bill form\'s Pay takes the tick too; declining the payment gives the credit and the bill share back once', async () => {
      const rk = await saveSupplier();
      await giveCredit(rk, 100000);
      const b = (await addBill(75000, { supplierId: rk })).body.bill;
      const pr = await procurement.session.form('/payment-requests/supplier', { supplierBillId: b.id, amount: 75000, useCredit: 'true' }, []);
      expect(pr.body.request).toMatchObject({ status: 'submitted', amount: 0, credit: { amount: 75000 }, paidByCredit: true });
      expect(await owed(rk)).toBe(25000);
      expect((await accounts.session.post(`/payment-requests/${pr.body.request.id}/decline`, { note: 'Wrong bill' })).status).toBe(200);
      expect((await accounts.session.post(`/payment-requests/${pr.body.request.id}/decline`, { note: 'again' })).status).toBe(409);
      expect(await owed(rk)).toBe(100000);
      expect((await procurement.session.get(`/supplier-bills/${b.id}`)).body.bill).toMatchObject({ leftToAsk: 75000, paid: 0 });
    });
  });

  describe('the order page shows supplier bills linked to the order', () => {
    it('procurement / accounts / admin see the bill and its payments; other teams get none; changing the bill\'s order moves it', async () => {
      const rk = await saveSupplier();
      const order = await paidOrder();
      const other = await paidOrder();
      const b = (await procurement.session.form('/supplier-bills', { billDate: ymd(-1), amount: 75000, description: 'speakers', supplierId: rk, orderId: String(order._id) },
        [{ field: 'bill', buffer: PDF, name: 'b.pdf', type: 'application/pdf' }])).body.bill;
      const pr = (await procurement.session.form('/payment-requests/supplier', { supplierBillId: b.id, amount: 75000 }, [])).body.request;
      for (const who of [procurement, accounts, admin]) {
        const res = await who.session.get(`/payment-requests/order/${order._id}`);
        expect(res.status).toBe(200);
        expect(res.body.bills).toEqual([expect.objectContaining({
          id: b.id, number: b.number, supplier: expect.objectContaining({ name: 'ARB Supplies' }), amount: 75000, owed: 75000, waiting: 75000,
          payments: [expect.objectContaining({ id: pr.id, number: pr.number })],
        })]);
      }
      const opsView = await ops.session.get(`/payment-requests/order/${order._id}`);
      expect(opsView.status).toBe(200);
      expect(opsView.body.bills).toEqual([]);
      // Re-linked to another order: it shows there, not here.
      const moved = await procurement.session.formPut(`/supplier-bills/${b.id}`, { orderId: String(other._id), rev: b.rev });
      expect(moved.status).toBe(200);
      expect((await accounts.session.get(`/payment-requests/order/${order._id}`)).body.bills).toEqual([]);
      expect((await accounts.session.get(`/payment-requests/order/${other._id}`)).body.bills.map((x) => x.id)).toEqual([b.id]);
    });

    it('reads the bills through supplier_bill_order (no collection scan)', async () => {
      const { default: SupplierBill } = await import('../models/SupplierBill.js');
      await SupplierBill.init();
      const plan = await SupplierBill.find({ order: { $eq: new mongoose.Types.ObjectId(), $type: 'objectId' } }).sort({ createdAt: -1 }).limit(50).explain('queryPlanner');
      expect(JSON.stringify(plan.queryPlanner.winningPlan)).toMatch(/supplier_bill_order/);
    });
  });
});
