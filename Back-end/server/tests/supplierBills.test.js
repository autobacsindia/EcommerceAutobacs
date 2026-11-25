/**
 * "We owe suppliers" (owner, 2026-11-24): supplier bills we pay later, paid through
 * the ordinary supplier payment flow (POST /payment-requests/supplier with
 * supplierBillId → accounts approves → the admin pays, singly or in one transfer).
 *
 * What must hold (CLAUDE.md money path):
 *   - only procurement / the admin add, change, cancel or pay bills; accounts sees them
 *   - the bill's supplier is a saved one; the payment always goes to the bill's supplier
 *   - live payments + paid ≤ the bill — refused over it, also when two land at once
 *   - a declined / cancelled payment gives its share back; an edit moves it
 *   - paid / part paid / overdue are worked out from the payments; the cache heals
 *   - the same bill cannot be added twice; a double submit adds one
 *   - the list is cursor-paginated; the daily overdue reminder posts once per day
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

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);

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

const ARB = {
  name: 'ARB Supplies', contactPerson: 'Joseph', phone: '9800000001', gstin: '32ABCDE1234F1Z5', address: 'Kochi',
  payment: { method: 'bank', accountName: 'ARB Supplies Pvt Ltd', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' },
};
const OTHER_BANK = { name: 'Tyre World', method: 'bank', accountName: 'Tyre World', accountNumber: '998877665544', ifsc: 'ICIC0004321', bankName: 'ICICI' };

const { default: SupplierBill } = await import('../models/SupplierBill.js');
const billsService = await import('../services/supplierBillService.js');

const istDay = (offsetDays = 0) => billsService.todayIst(new Date(Date.now() + offsetDays * 86400000));

describe('We owe suppliers (supplier bills)', () => {
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

  const RK = { ...ARB, name: 'RK New Popular', gstin: '' };
  const addSupplier = async (over = {}) => {
    const res = await procurement.session.post('/suppliers', { ...RK, ...over });
    expect(res.status).toBe(201);
    return res.body.supplier;
  };
  const BILL_PDF = [{ field: 'bill', buffer: PDF, name: 'bill-4471.pdf', type: 'application/pdf' }];
  const addBill = (s, fields = {}, files = BILL_PDF) => s.form('/supplier-bills', {
    billNumber: 'INV-4471', billDate: istDay(-3), dueDate: istDay(10), amount: 26000, description: '40 floor mats', ...fields,
  }, files);
  const pay = (s, billId, fields = {}) => s.form('/payment-requests/supplier', { supplierBillId: billId, amount: 10000, ...fields }, []);
  const payBatch = (s, ids, expectedTotal) => s.form('/payment-requests/pay-batch',
    { ids, expectedTotal, method: 'bank', reference: 'UTR4471' },
    [{ field: 'proof', buffer: JPEG, name: 'transfer.jpg', type: 'image/jpeg' }]);
  const payOne = (s, id) => s.form(`/payment-requests/${id}/pay`, { method: 'bank', reference: 'UTR1' }, [{ field: 'proof', buffer: JPEG, name: 'p.jpg', type: 'image/jpeg' }]);
  const bill = async (id) => (await procurement.session.get(`/supplier-bills/${id}`)).body.bill;
  const reservedOf = async (id) => (await SupplierBill.findById(id).lean()).reservedPaise;

  describe('adding a bill', () => {
    it('procurement adds one for a saved supplier, with the bill copy kept private', async () => {
      const s = await addSupplier();
      const res = await addBill(procurement.session, { supplierId: s.id });
      expect(res.status).toBe(201);
      expect(res.body.bill).toMatchObject({
        number: expect.stringMatching(/^SB-\d{4}$/), supplier: { id: s.id, name: 'RK New Popular' },
        billNumber: 'INV-4471', amount: 26000, paid: 0, waiting: 0, owed: 26000, leftToAsk: 26000,
        state: 'unpaid', overdue: false, can: { pay: true, edit: true, cancel: true },
      });
      expect(res.body.bill.files).toHaveLength(1);
      expect([...stored.keys()][0]).toMatch(/^supplier-bills\//);
      const file = await procurement.session.get(`/supplier-bills/${res.body.bill.id}/files/${res.body.bill.files[0].id}`);
      expect(file.status).toBe(200);
      expect(file.headers['cache-control']).toMatch(/no-store/);
    });

    it('accounts sees bills but cannot add them; other teams see nothing', async () => {
      const s = await addSupplier();
      await addBill(procurement.session, { supplierId: s.id });
      expect((await accounts.session.get('/supplier-bills')).body.bills).toHaveLength(1);
      expect((await addBill(accounts.session, { supplierId: s.id, billNumber: 'X1' })).status).toBe(403);
      expect((await ops.session.get('/supplier-bills')).status).toBe(403);
      expect((await ops.session.get('/supplier-bills/by-supplier')).status).toBe(403);
      expect((await addBill(ops.session, { supplierId: s.id, billNumber: 'X2' })).status).toBe(403);
    });

    it('refuses a supplier not on the list, an inactive one, and bad numbers or days', async () => {
      const s = await addSupplier();
      const cases = [
        [{ supplierId: '' }, /Pick the supplier/],
        [{ supplierId: String(new mongoose.Types.ObjectId()) }, /Pick the supplier/],
        [{ supplierId: s.id, billNumber: '  ' }, /bill number/],
        [{ supplierId: s.id, amount: 0 }, /at least ₹1/],
        [{ supplierId: s.id, amount: 'abc' }, /in rupees/],
        [{ supplierId: s.id, amount: 20000000 }, /over ₹1 crore/],
        [{ supplierId: s.id, dueDate: '2026-02-30' }, /Pick the day/],
        [{ supplierId: s.id, dueDate: '' }, /Pick the day/],
        [{ supplierId: s.id, billDate: istDay(2) }, /future/],
        [{ supplierId: s.id, billDate: istDay(-3), dueDate: istDay(-5) }, /before the bill date/],
      ];
      for (const [fields, msg] of cases) {
        const res = await addBill(procurement.session, fields, []);
        expect([res.status, res.body.message]).toEqual([400, expect.stringMatching(msg)]);
      }
      await Supplier.updateOne({ _id: s.id }, { active: false });
      expect((await addBill(procurement.session, { supplierId: s.id }, [])).status).toBe(409);
      expect(await SupplierBill.countDocuments()).toBe(0);
      expect(stored.size).toBe(0);
    });

    it('the same supplier bill cannot be added twice ("INV 4471" = "inv-4471"); another supplier may use the number', async () => {
      const s = await addSupplier();
      const other = await addSupplier({ name: 'Tyre World' });
      expect((await addBill(procurement.session, { supplierId: s.id })).status).toBe(201);
      const again = await addBill(procurement.session, { supplierId: s.id, billNumber: 'inv 4471' });
      expect(again.status).toBe(409);
      expect(again.body.message).toMatch(/already added \(SB-/);
      expect(stored.size).toBe(1);
      expect((await addBill(procurement.session, { supplierId: other.id })).status).toBe(201);
    });

    it('a double submit (same clientId) adds one bill — in turn and at the same moment', async () => {
      const s = await addSupplier();
      const a = await addBill(procurement.session, { supplierId: s.id, clientId: 'form-key-0001' });
      const b = await addBill(procurement.session, { supplierId: s.id, clientId: 'form-key-0001' });
      expect(b.body.bill.id).toBe(a.body.bill.id);
      const [c, d] = await Promise.all([
        addBill(procurement.session, { supplierId: s.id, billNumber: 'B-2', clientId: 'form-key-0002' }),
        addBill(procurement.session, { supplierId: s.id, billNumber: 'B-2', clientId: 'form-key-0002' }),
      ]);
      expect(c.body.bill.id).toBe(d.body.bill.id);
      expect(await SupplierBill.countDocuments()).toBe(2);
    });

    it('two people adding the same bill at the same moment: one is saved, the other is told', async () => {
      const s = await addSupplier();
      const res = await Promise.all([
        addBill(procurement.session, { supplierId: s.id }),
        addBill(admin.session, { supplierId: s.id, billNumber: 'INV 4471' }),
      ]);
      expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await SupplierBill.countDocuments()).toBe(1);
    });

    it('links an order when given one; a made-up order is refused', async () => {
      const s = await addSupplier();
      const order = await paidOrder();
      const res = await addBill(procurement.session, { supplierId: s.id, orderId: String(order._id) });
      expect(res.body.bill.order).toEqual({ id: String(order._id), number: expect.any(String) });
      expect((await addBill(procurement.session, { supplierId: s.id, billNumber: 'Z', orderId: String(new mongoose.Types.ObjectId()) })).status).toBe(400);
    });
  });

  describe('paying a bill (the ordinary supplier payment)', () => {
    let s, b;
    beforeEach(async () => {
      s = await addSupplier();
      b = (await addBill(procurement.session, { supplierId: s.id })).body.bill;
    });

    it('part-pays it: always to the bill\'s supplier, in rupees, with the bill named', async () => {
      const other = await addSupplier({ name: 'Tyre World' });
      const res = await pay(procurement.session, b.id, { supplierId: other.id, payee: OTHER_BANK, saveSupplier: 'true' });
      expect(res.status).toBe(201);
      const r = res.body.request;
      expect(r).toMatchObject({ kind: 'supplier', amount: 10000, order: null, supplierBillId: b.id, supplier: { id: s.id }, reference: 'INV-4471' });
      expect(r.description).toMatch(/Bill INV-4471 \(SB-/);
      const raw = await PaymentRequest.findById(r.id).lean();
      expect(raw.payee).toMatchObject({ name: 'RK New Popular', accountNumber: '123456789012' });
      expect(raw.history[0].note).toMatch(/₹10,000 of ₹26,000/);
      expect(await Supplier.countDocuments()).toBe(2); // nothing new saved
      expect(await bill(b.id)).toMatchObject({ paid: 0, waiting: 10000, owed: 26000, leftToAsk: 16000, state: 'unpaid' });
    });

    it('paid → part paid, then the balance → paid (and off the owed list)', async () => {
      const r1 = (await pay(procurement.session, b.id)).body.request;
      await accounts.session.post(`/payment-requests/${r1.id}/approve`);
      expect((await payOne(admin.session, r1.id)).status).toBe(200);
      expect(await bill(b.id)).toMatchObject({ paid: 10000, waiting: 0, owed: 16000, leftToAsk: 16000, state: 'part_paid' });
      const r2 = (await pay(procurement.session, b.id, { amount: 16000 })).body.request;
      await accounts.session.post(`/payment-requests/${r2.id}/approve`);
      await payOne(admin.session, r2.id);
      const done = await bill(b.id);
      expect(done).toMatchObject({ paid: 26000, owed: 0, leftToAsk: 0, state: 'paid', can: { pay: false, cancel: false } });
      expect(done.payments.map((p) => [p.number, p.status])).toEqual([[r1.number, 'paid'], [r2.number, 'paid']]);
      expect((await accounts.session.get('/supplier-bills')).body.bills).toHaveLength(0);
      expect((await accounts.session.get('/supplier-bills?show=paid')).body.bills.map((x) => x.id)).toEqual([b.id]);
      expect((await SupplierBill.findById(b.id).lean())).toMatchObject({ paidPaise: 2600000, settled: true, settledAt: expect.any(Date) });
    });

    it('cannot ask for more than is left — and two payments at the same moment cannot together go over', async () => {
      const over = await pay(procurement.session, b.id, { amount: 26000.01 });
      expect(over.status).toBe(409);
      expect(over.body.message).toMatch(/Only ₹26,000 of ₹26,000 is left/);
      const res = await Promise.all([
        pay(procurement.session, b.id, { amount: 15000 }),
        pay(admin.session, b.id, { amount: 15000 }),
      ]);
      expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await reservedOf(b.id)).toBe(1500000);
      expect(await PaymentRequest.countDocuments({ supplierBill: b.id })).toBe(1);
    });

    it('a declined or cancelled payment gives its share back; a declined one is not sent again', async () => {
      const r1 = (await pay(procurement.session, b.id, { amount: 20000 })).body.request;
      expect((await accounts.session.post(`/payment-requests/${r1.id}/decline`, { note: 'wrong amount' })).status).toBe(200);
      expect(await reservedOf(b.id)).toBe(0);
      const again = await procurement.session.formPut(`/payment-requests/${r1.id}`, { reason: 'fixed', amount: 19000 });
      expect(again.status).toBe(409);
      const r2 = (await pay(procurement.session, b.id, { amount: 26000 })).body.request;
      expect((await procurement.session.post(`/payment-requests/${r2.id}/cancel`, { note: 'raised by mistake' })).status).toBe(200);
      expect(await reservedOf(b.id)).toBe(0);
      expect(await bill(b.id)).toMatchObject({ leftToAsk: 26000, waiting: 0, paid: 0 });
    });

    it('editing the payment moves its share: more must fit, less gives back; the supplier cannot change', async () => {
      const r = (await pay(procurement.session, b.id, { amount: 10000 })).body.request;
      await pay(procurement.session, b.id, { amount: 10000 });
      const tooMuch = await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'more', amount: 16000.5 });
      expect(tooMuch.status).toBe(409);
      expect(await reservedOf(b.id)).toBe(2000000);
      expect((await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'balance', amount: 16000 })).status).toBe(200);
      expect(await reservedOf(b.id)).toBe(2600000);
      expect((await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'less', amount: 4000 })).status).toBe(200);
      expect(await reservedOf(b.id)).toBe(1400000);
      const other = await addSupplier({ name: 'Tyre World' });
      const moved = await procurement.session.formPut(`/payment-requests/${r.id}`, { reason: 'other', supplierId: other.id });
      expect(moved.status).toBe(409);
      expect(moved.body.message).toMatch(/pays a supplier bill/);
    });

    it('a bill payment is rupees only', async () => {
      const res = await pay(procurement.session, b.id, { currency: 'THB', amount: 1000 });
      expect(res.status).toBe(400);
      expect(await reservedOf(b.id)).toBe(0);
    });

    it('only procurement / the admin pay a bill; a cancelled bill cannot be paid', async () => {
      expect((await pay(accounts.session, b.id)).status).toBe(403);
      expect((await procurement.session.post(`/supplier-bills/${b.id}/cancel`, { reason: 'added twice' })).status).toBe(200);
      const res = await pay(procurement.session, b.id);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/cancelled/);
    });

    it('a supplier with no way to pay them takes nothing from the bill', async () => {
      await Supplier.updateOne({ _id: s.id }, { $set: { 'payment.method': 'card' } });
      const res = await pay(procurement.session, b.id);
      expect(res.status).toBe(409);
      expect(await reservedOf(b.id)).toBe(0);
    });

    it('bill payments, stock payments and order payments to one supplier go out in one transfer', async () => {
      const ids = [];
      for (const amount of [16000, 10000]) {
        const r = (await pay(procurement.session, b.id, { amount })).body.request;
        await accounts.session.post(`/payment-requests/${r.id}/approve`);
        ids.push(r.id);
      }
      const stock = (await procurement.session.form('/payment-requests/supplier', { supplierId: s.id, amount: 500.5, description: 'Wiper blades' }, [])).body.request;
      await accounts.session.post(`/payment-requests/${stock.id}/approve`);
      ids.push(stock.id);
      const groups = (await admin.session.get('/payment-requests/to-pay/suppliers')).body.groups;
      expect(groups.map((g) => [g.count, g.total])).toEqual([[3, 26500.5]]);
      expect((await payBatch(admin.session, ids, 26500.5)).status).toBe(200);
      expect(await bill(b.id)).toMatchObject({ state: 'paid', paid: 26000, owed: 0 });
      const by = (await accounts.session.get('/supplier-bills/by-supplier')).body;
      expect(by.suppliers).toEqual([]);
      expect(by.total).toEqual({ owed: 0, overdue: 0 });
    });

    it('the paid cache heals from the payments on a view', async () => {
      await SupplierBill.updateOne({ _id: b.id }, { paidPaise: 999900, settled: true });
      expect(await bill(b.id)).toMatchObject({ paid: 0, state: 'unpaid' });
      expect(await SupplierBill.findById(b.id).lean()).toMatchObject({ paidPaise: 0, settled: false });
    });
  });

  describe('changing and cancelling a bill', () => {
    let s, b;
    beforeEach(async () => {
      s = await addSupplier();
      b = (await addBill(procurement.session, { supplierId: s.id })).body.bill;
    });

    it('changes the due date and amount, logged; never below what is already asked for', async () => {
      await pay(procurement.session, b.id, { amount: 20000 });
      const low = await procurement.session.formPut(`/supplier-bills/${b.id}`, { rev: 0, amount: 19999 });
      expect(low.status).toBe(409);
      expect(low.body.message).toMatch(/₹20,000 is already asked for/);
      const ok = await procurement.session.formPut(`/supplier-bills/${b.id}`, { rev: 0, amount: 21000, dueDate: istDay(20) });
      expect(ok.status).toBe(200);
      expect(ok.body.bill).toMatchObject({ amount: 21000, leftToAsk: 1000, dueDate: istDay(20), rev: 1 });
      const full = (await procurement.session.get(`/supplier-bills/${b.id}`)).body.bill;
      expect(full.history.at(-1).note).toMatch(/amount ₹26,000 → ₹21,000; |due /);
    });

    it('a stale form, a supplier change, or accounts are refused', async () => {
      await procurement.session.formPut(`/supplier-bills/${b.id}`, { rev: 0, description: 'first' });
      expect((await procurement.session.formPut(`/supplier-bills/${b.id}`, { rev: 0, description: 'second' })).status).toBe(409);
      const other = await addSupplier({ name: 'Tyre World' });
      expect((await procurement.session.formPut(`/supplier-bills/${b.id}`, { supplierId: other.id })).status).toBe(400);
      expect((await accounts.session.formPut(`/supplier-bills/${b.id}`, { amount: 1 })).status).toBe(403);
    });

    it('cancel: needs a reason; refused while a payment is raised; never deleted', async () => {
      expect((await procurement.session.post(`/supplier-bills/${b.id}/cancel`, {})).status).toBe(400);
      const r = (await pay(procurement.session, b.id)).body.request;
      const busy = await procurement.session.post(`/supplier-bills/${b.id}/cancel`, { reason: 'duplicate' });
      expect(busy.status).toBe(409);
      await procurement.session.post(`/payment-requests/${r.id}/cancel`, { note: 'oops' });
      const done = await procurement.session.post(`/supplier-bills/${b.id}/cancel`, { reason: 'duplicate' });
      expect(done.body.bill).toMatchObject({ state: 'cancelled', owed: 0, can: { pay: false, edit: false } });
      expect(await SupplierBill.countDocuments()).toBe(1);
      // A cancelled bill frees its number: the right one can be added again.
      expect((await addBill(procurement.session, { supplierId: s.id })).status).toBe(201);
    });
  });

  describe('what we owe, overdue, and the list', () => {
    it('per supplier: owed, overdue and next due; the list filters overdue', async () => {
      const s = await addSupplier();
      const t = await addSupplier({ name: 'Tyre World' });
      const late = (await addBill(procurement.session, { supplierId: s.id, billNumber: 'A1', billDate: istDay(-40), dueDate: istDay(-5), amount: 5000 })).body.bill;
      await addBill(procurement.session, { supplierId: s.id, billNumber: 'A2', dueDate: istDay(3), amount: 7000 });
      await addBill(procurement.session, { supplierId: t.id, billNumber: 'T1', dueDate: istDay(30), amount: 1000 });
      expect(late).toMatchObject({ overdue: true, dueInDays: -5 });
      const r = (await pay(procurement.session, late.id, { amount: 2000 })).body.request;
      await accounts.session.post(`/payment-requests/${r.id}/approve`);
      await payOne(admin.session, r.id);

      const by = (await accounts.session.get('/supplier-bills/by-supplier')).body;
      expect(by.suppliers).toEqual([
        { id: s.id, name: 'RK New Popular', bills: 2, owed: 10000, overdueBills: 1, overdue: 3000, nextDue: istDay(-5) },
        { id: t.id, name: 'Tyre World', bills: 1, owed: 1000, overdueBills: 0, overdue: 0, nextDue: istDay(30) },
      ]);
      expect(by.total).toEqual({ owed: 11000, overdue: 3000 });
      const overdue = (await accounts.session.get('/supplier-bills?due=overdue')).body;
      expect(overdue.bills.map((x) => [x.billNumber, x.state, x.owed])).toEqual([['A1', 'part_paid', 3000]]);
      const all = (await accounts.session.get('/supplier-bills')).body;
      expect(all.summary).toMatchObject({ count: 3, owed: 11000 });
      expect(all.bills.map((x) => x.billNumber)).toEqual(['A1', 'A2', 'T1']);
      expect((await accounts.session.get(`/supplier-bills?supplier=${t.id}`)).body.bills.map((x) => x.billNumber)).toEqual(['T1']);
    });

    it('is cursor-paginated: soonest due first, no bill twice or skipped', async () => {
      const s = await addSupplier();
      const docs = Array.from({ length: billsService.PAGE_SIZE + 5 }, (_, i) => ({
        number: `SB-${String(i + 1).padStart(4, '0')}`, supplier: s.id, supplierName: 'RK New Popular',
        billNumber: `P${i}`, billKey: `p${i}`, dueDate: istDay(i % 7), amountPaise: 10000, createdBy: procurement.user._id,
      }));
      await SupplierBill.insertMany(docs);
      const p1 = (await accounts.session.get('/supplier-bills')).body;
      expect(p1.bills).toHaveLength(billsService.PAGE_SIZE);
      expect(p1.nextCursor).toBeTruthy();
      const p2 = (await accounts.session.get(`/supplier-bills?cursor=${encodeURIComponent(p1.nextCursor)}`)).body;
      expect(p2.bills).toHaveLength(5);
      expect(p2.nextCursor).toBeNull();
      const seen = [...p1.bills, ...p2.bills].map((x) => x.billNumber);
      expect(new Set(seen).size).toBe(docs.length);
      const days = [...p1.bills, ...p2.bills].map((x) => x.dueDate);
      expect([...days].sort()).toEqual(days);
    });

    it('the daily reminder lists overdue bills once a day, and stays quiet when none are', async () => {
      expect(await billsService.remindOverdue()).toMatchObject({ overdue: 0, posted: false });
      const s = await addSupplier();
      await addBill(procurement.session, { supplierId: s.id, billNumber: 'L1', billDate: istDay(-30), dueDate: istDay(-2), amount: 5000 });
      await addBill(procurement.session, { supplierId: s.id, billNumber: 'L2', dueDate: istDay(2), amount: 5000 });
      expect(await billsService.remindOverdue()).toMatchObject({ overdue: 1, posted: true });
      await billsService.remindOverdue();
      for (const key of ['team:procurement', 'team:accounts']) {
        const space = await ChatChannel.findOne({ key }).lean();
        const msgs = await ChatMessage.find({ channel: space._id }).lean();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].text).toMatch(/Supplier bills overdue \(1\):\n• RK New Popular — bill L1 \(SB-\d+\): ₹5,000 owed, due .* \(2 days late\)/);
      }
    });
  });
});
