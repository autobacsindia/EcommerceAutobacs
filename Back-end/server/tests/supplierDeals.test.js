/**
 * Supplier deals: a made-to-order item paid to the supplier in parts
 * (services/supplierDealService.js + paymentRequestService part payments).
 *
 * Owner's example: supplier total ₹29,000, ₹10,000 advance before they start,
 * ₹19,000 balance once it is made. What must hold:
 *   - the server works out paid / waiting / balance; balance = agreed − paid
 *   - a part that would take the asked-for total past the agreed total is refused,
 *     also when two are raised at the same moment
 *   - approve is once only (double click → one approval)
 *   - a declined / cancelled part gives its share back
 *   - the item ships only once the balance is paid
 *   - an approved / paid advance blocks cancelling the order (customer and admin)
 *   - an expense can be linked to an order and shows there, without holding shipping
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

const { default: SupplierDeal } = await import('../models/SupplierDeal.js');
const { default: cancellationService } = await import('../services/cancellationService.js');
const { dealView, partFor, cleanDay } = await import('../services/supplierDealService.js');
const { assertNoPendingSupplierPayment } = await import('../services/paymentRequestService.js');
const { CUSTOMER_BLOCK_MESSAGE } = await import('../services/supplierAdvanceGuard.js');

const photo = { buffer: JPEG, mimetype: 'image/jpeg' };

describe('dealView / partFor (pure)', () => {
  const deal = { _id: 'd1', status: 'open', agreedPaise: 2900000, itemIds: [], startDate: '2026-11-08', completionDate: '2026-11-20' };
  it('works the numbers out from the requests only', () => {
    const v = dealView(deal, [
      { _id: 'a', deal: 'd1', status: 'paid', amount: 10000, part: 'advance', createdAt: new Date(1) },
      { _id: 'b', deal: 'd1', status: 'submitted', amount: 5000.5, part: 'part', createdAt: new Date(2) },
      { _id: 'c', deal: 'd1', status: 'declined', amount: 9999, part: 'part', createdAt: new Date(3) },
      { _id: 'x', deal: 'other', status: 'paid', amount: 1, createdAt: new Date(4) },
    ]);
    expect(v).toMatchObject({ agreedTotal: 29000, paid: 10000, waiting: 5000.5, balanceDue: 19000, leftToAsk: 13999.5, fullyPaid: false });
    expect(v.payments.map((p) => p.partLabel)).toEqual(['Advance', 'Part payment', 'Part payment']);
  });
  it('names the part from what was already asked for', () => {
    expect(partFor({ reservedPaise: 0, agreedPaise: 2900000 }, 1000000)).toBe('advance');
    expect(partFor({ reservedPaise: 1000000, agreedPaise: 2900000 }, 500000)).toBe('part');
    expect(partFor({ reservedPaise: 1000000, agreedPaise: 2900000 }, 1900000)).toBe('balance');
    expect(partFor({ reservedPaise: 0, agreedPaise: 2900000 }, 2900000)).toBe('balance');
  });
  it('accepts only real calendar days', () => {
    expect(cleanDay('2026-11-08', 'x')).toBe('2026-11-08');
    expect(cleanDay('', 'x')).toBe('');
    expect(() => cleanDay('2026-02-30', 'x')).toThrow();
    expect(() => cleanDay('08/11/2026', 'x')).toThrow();
  });
});

describe('Supplier deals — advance and balance', () => {
  beforeAll(async () => { await dbHandler.connect(); await SupplierDeal.init(); });
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

  /** A paid order and a ₹29,000 deal on its first item. */
  async function withDeal(over = {}) {
    const order = await paidOrder();
    const id = String(order._id);
    const kit = String(order.items[0]._id);
    const mat = String(order.items[1]._id);
    const res = await procurement.session.post('/payment-requests/deals', {
      orderId: id, itemIds: [kit], supplierName: 'Kochi Fabricators', agreedTotal: 29000,
      startDate: '2026-11-08', completionDate: '2026-11-20', ...over,
    });
    expect(res.status).toBe(201);
    return { order, id, kit, mat, deal: res.body.deal };
  }
  const raisePart = (s, id, dealId, amount) => s.form('/payment-requests/supplier', { orderId: id, dealId, amount, payee: BANK });
  const dealOf = async (s, id) => (await s.get(`/payment-requests/order/${id}`)).body.deals[0];
  const approveAndPay = async (prId) => {
    expect((await accounts.session.post(`/payment-requests/${prId}/approve`)).status).toBe(200);
    expect((await admin.session.form(`/payment-requests/${prId}/pay`, { method: 'bank', reference: 'UTR1234' })).status).toBe(200);
  };

  it('the owner\'s example: ₹10,000 advance, then the ₹19,000 balance, worked out by the server', async () => {
    const { id, deal } = await withDeal();
    expect(deal).toMatchObject({ agreedTotal: 29000, paid: 0, balanceDue: 29000, leftToAsk: 29000, startDate: '2026-11-08', completionDate: '2026-11-20' });

    const adv = await raisePart(procurement.session, id, deal.id, 10000);
    expect(adv.status).toBe(201);
    expect(adv.body.request).toMatchObject({ part: 'advance', partLabel: 'Advance', dealId: deal.id, amount: 10000 });
    let d = await dealOf(procurement.session, id);
    expect(d).toMatchObject({ paid: 0, waiting: 10000, balanceDue: 29000, leftToAsk: 19000 });
    expect(d.can.raise).toBe(false); // one part in flight at a time

    await approveAndPay(adv.body.request.id);
    d = await dealOf(procurement.session, id);
    expect(d).toMatchObject({ paid: 10000, waiting: 0, balanceDue: 19000, leftToAsk: 19000, fullyPaid: false });
    expect(d.can.raise).toBe(true);

    const bal = await raisePart(procurement.session, id, deal.id, 19000);
    expect(bal.status).toBe(201);
    expect(bal.body.request.part).toBe('balance');
    await approveAndPay(bal.body.request.id);
    d = await dealOf(accounts.session, id);
    expect(d).toMatchObject({ paid: 29000, balanceDue: 0, leftToAsk: 0, fullyPaid: true });
    expect(d.payments.map((p) => [p.partLabel, p.amount, p.status])).toEqual([['Advance', 10000, 'paid'], ['Balance', 19000, 'paid']]);
    expect(d.payments.every((p) => p.paidAt)).toBe(true);
  });

  it('refuses a part that would pay more than the agreed total', async () => {
    const { id, deal } = await withDeal();
    const adv = await raisePart(procurement.session, id, deal.id, 10000);
    await approveAndPay(adv.body.request.id);
    const over = await raisePart(procurement.session, id, deal.id, 19000.01);
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/₹19,000 of ₹29,000 is left/);
    expect(await PaymentRequest.countDocuments({ deal: deal.id })).toBe(1);
    // A first part over the total too.
    const fresh = await withDeal();
    expect((await raisePart(procurement.session, fresh.id, fresh.deal.id, 29001)).status).toBe(409);
  });

  it('two parts raised at the same moment cannot together exceed the total', async () => {
    const { id, deal } = await withDeal();
    const results = await Promise.all([
      raisePart(procurement.session, id, deal.id, 20000),
      raisePart(procurement.session, id, deal.id, 20000),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await PaymentRequest.countDocuments({ deal: deal.id })).toBe(1);
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(2000000);
  });

  it('a double-clicked approval approves once', async () => {
    const { id, deal } = await withDeal();
    const prId = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
    const clicks = await Promise.all([1, 2, 3].map(() => accounts.session.post(`/payment-requests/${prId}/approve`)));
    expect(clicks.filter((r) => r.status === 200)).toHaveLength(1);
    const r = await PaymentRequest.findById(prId).lean();
    expect(r.history.filter((h) => h.action === 'approved')).toHaveLength(1);
  });

  it('a declined or cancelled part gives its share back', async () => {
    const { id, deal } = await withDeal();
    const a = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
    expect((await accounts.session.post(`/payment-requests/${a}/decline`, { note: 'Wrong amount' })).status).toBe(200);
    expect(await dealOf(procurement.session, id)).toMatchObject({ waiting: 0, leftToAsk: 29000 });
    // Declining twice (a retry) does not give it back twice.
    await accounts.session.post(`/payment-requests/${a}/decline`, { note: 'Wrong amount' });
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(0);

    const b = (await raisePart(procurement.session, id, deal.id, 12000)).body;
    expect(b.request.part).toBe('advance');
    expect((await procurement.session.post(`/payment-requests/${b.request.id}/cancel`)).status).toBe(200);
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(0);
  });

  it('editing a part\'s amount keeps the total honest', async () => {
    const { id, deal } = await withDeal();
    const prId = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
    expect((await procurement.session.put(`/payment-requests/${prId}`, { amount: 30000 })).status).toBe(409);
    const ok = await procurement.session.put(`/payment-requests/${prId}`, { amount: 29000 });
    expect(ok.status).toBe(200);
    expect(ok.body.request.part).toBe('balance');
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(2900000);
    const down = await procurement.session.put(`/payment-requests/${prId}`, { amount: 8000 });
    expect(down.body.request.part).toBe('advance');
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(800000);
  });

  it('who sets it up, and what it refuses', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    const kit = String(order.items[0]._id);
    const body = { orderId: id, itemIds: [kit], supplierName: 'Kochi Fabricators', agreedTotal: 29000 };
    expect((await accounts.session.post('/payment-requests/deals', body)).status).toBe(403);
    expect((await ops.session.post('/payment-requests/deals', body)).status).toBe(403);
    expect((await procurement.session.post('/payment-requests/deals', { ...body, agreedTotal: 'abc' })).status).toBe(400);
    expect((await procurement.session.post('/payment-requests/deals', { ...body, agreedTotal: 0 })).status).toBe(400);
    expect((await procurement.session.post('/payment-requests/deals', { ...body, startDate: '2026-11-20', completionDate: '2026-11-08' })).status).toBe(400);
    expect((await procurement.session.post('/payment-requests/deals', { ...body, itemIds: [String(new mongoose.Types.ObjectId())] })).status).toBe(400);
    expect((await procurement.session.post('/payment-requests/deals', body)).status).toBe(201);
    // One open deal per item — also at the same moment (unique index).
    expect((await procurement.session.post('/payment-requests/deals', body)).status).toBe(409);
  });

  it('one way to pay per item: a deal item takes no one-off payment, and vice versa', async () => {
    const { id, kit, mat } = await withDeal();
    const plain = await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [kit], amount: 5000, payee: BANK });
    expect(plain.status).toBe(409);
    expect(plain.body.message).toMatch(/paid in parts/);
    expect((await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [mat], amount: 500, payee: BANK })).status).toBe(201);
    expect((await procurement.session.post('/payment-requests/deals', { orderId: id, itemIds: [mat], supplierName: 'X Co', agreedTotal: 900 })).status).toBe(409);
  });

  it('changing the total or dates needs a reason, is kept in history, and never drops below what is asked for', async () => {
    const { id, deal } = await withDeal();
    await raisePart(procurement.session, id, deal.id, 10000);
    expect((await procurement.session.put(`/payment-requests/deals/${deal.id}`, { completionDate: '2026-11-27' })).status).toBe(400);
    const late = await procurement.session.put(`/payment-requests/deals/${deal.id}`, { completionDate: '2026-11-27', note: 'Supplier delayed a week' });
    expect(late.status).toBe(200);
    expect(late.body.deal.completionDate).toBe('2026-11-27');
    expect(late.body.deal.history.at(-1).note).toMatch(/completion 20 Nov 2026 → 27 Nov 2026 — Supplier delayed a week/);
    const low = await procurement.session.put(`/payment-requests/deals/${deal.id}`, { agreedTotal: 9000, note: 'Re-priced' });
    expect(low.status).toBe(409);
    expect(low.body.message).toMatch(/₹10,000 is already asked for/);
    const up = await procurement.session.put(`/payment-requests/deals/${deal.id}`, { agreedTotal: 31000, note: 'Extra coating' });
    expect(up.body.deal).toMatchObject({ agreedTotal: 31000, leftToAsk: 21000 });
    expect((await accounts.session.put(`/payment-requests/deals/${deal.id}`, { agreedTotal: 1, note: 'nope' })).status).toBe(403);
  });

  it('a deal can be removed only while nothing is asked for on it', async () => {
    const { id, deal } = await withDeal();
    const prId = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
    expect((await procurement.session.post(`/payment-requests/deals/${deal.id}/remove`)).status).toBe(409);
    await procurement.session.post(`/payment-requests/${prId}/cancel`);
    expect((await procurement.session.post(`/payment-requests/deals/${deal.id}/remove`, { note: 'set up by mistake' })).status).toBe(200);
    expect((await procurement.session.get(`/payment-requests/order/${id}`)).body.deals).toEqual([]);
  });

  it('the item ships only once the balance is paid', async () => {
    const { id, kit, mat, deal } = await withDeal();
    const adv = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
    await approveAndPay(adv);
    await expect(assertNoPendingSupplierPayment(id, [kit])).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/balance of ₹19,000/) });
    await expect(wf.shipWithProof(procurement.user, id, { itemIds: [kit] }, photo, req)).rejects.toMatchObject({ statusCode: 409 });
    // The other item is not part of the deal.
    await expect(assertNoPendingSupplierPayment(id, [mat])).resolves.toBeUndefined();
    const bal = (await raisePart(procurement.session, id, deal.id, 19000)).body.request.id;
    await approveAndPay(bal);
    await expect(wf.shipWithProof(procurement.user, id, { itemIds: [kit] }, photo, req)).resolves.toBeTruthy();
  });

  describe('cancelling an order with a supplier advance', () => {
    it('is allowed while the advance only waits for accounts', async () => {
      const { id, deal } = await withDeal();
      await raisePart(procurement.session, id, deal.id, 10000);
      const res = await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' });
      expect(res.success).toBe(true);
    });

    it('is blocked once accounts approved it — whole order, per line, customer and admin', async () => {
      const { id, kit, mat, deal } = await withDeal();
      const prId = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
      expect((await accounts.session.post(`/payment-requests/${prId}/approve`)).status).toBe(200);

      const whole = await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' });
      expect(whole).toMatchObject({ success: false, blocked: 'supplier_advance' });
      expect(whole.message).toMatch(/Supplier advance already paid — this order can't be cancelled/);

      const line = await cancellationService.cancelLines(id, { lines: [{ itemId: kit, quantity: 1 }], reason: 'customer_request' }, { userId: admin.user._id });
      expect(line).toMatchObject({ success: false, blocked: 'supplier_advance' });
      const customer = await cancellationService.cancelLines(id, { lines: [{ itemId: kit, quantity: 1 }], reason: 'customer_request' }, { byCustomer: true });
      expect(customer.message).toBe(CUSTOMER_BLOCK_MESSAGE);
      expect(customer.message).not.toMatch(/supplier|advance|PR-/i);

      // The other item, not made to order, can still be cancelled.
      const other = await cancellationService.cancelLines(id, { lines: [{ itemId: mat, quantity: 1 }], reason: 'customer_request' }, { userId: admin.user._id });
      expect(other.success).toBe(true);
      expect((await Order.findById(id).lean()).status).toBe('processing');
    });

    it('is blocked through the admin status endpoint, and stays blocked once paid', async () => {
      const { id, deal } = await withDeal();
      const prId = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
      await approveAndPay(prId);
      const res = await admin.session.put(`/orders/${id}/status`, { status: 'cancelled', reason: 'customer_request' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.message).toMatch(/Supplier advance already paid/);
      expect((await Order.findById(id).lean()).status).toBe('processing');
    });

    it('a deal part on a cancelled order cannot be approved', async () => {
      const { id, deal } = await withDeal();
      const prId = (await raisePart(procurement.session, id, deal.id, 10000)).body.request.id;
      expect((await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' })).success).toBe(true);
      const res = await accounts.session.post(`/payment-requests/${prId}/approve`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/decline this supplier payment/);
      expect((await accounts.session.post(`/payment-requests/${prId}/decline`, { note: 'Order cancelled' })).status).toBe(200);
    });
  });

  describe('expenses linked to an order', () => {
    it('shows on the order and never holds shipping', async () => {
      const order = await paidOrder();
      const id = String(order._id);
      const kit = String(order.items[0]._id);
      const res = await expense(ops.session, { orderId: id, description: 'Fuel for the delivery to Kochi' });
      expect(res.status).toBe(201);
      expect(res.body.request.order).toMatchObject({ id });
      const list = (await procurement.session.get(`/payment-requests/order/${id}`)).body.requests;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ kind: 'expense', itemIds: [], status: 'submitted' });
      // An open expense on the order is not a supplier payment: the item still ships.
      await expect(assertNoPendingSupplierPayment(id, [kit])).resolves.toBeUndefined();
    });

    it('refuses an order that does not exist', async () => {
      expect((await expense(ops.session, { orderId: String(new mongoose.Types.ObjectId()) })).status).toBe(400);
      expect((await expense(ops.session, { orderId: 'not-an-id' })).status).toBe(400);
    });
  });
});
