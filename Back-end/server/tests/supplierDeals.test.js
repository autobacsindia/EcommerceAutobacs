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
const { dealView, partFor, cleanDay, partSummary } = await import('../services/supplierDealService.js');
const { dealRows } = await import('../services/paymentSlipService.js');
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
    // The whole total in one go is a full payment, not a balance.
    expect(partFor({ reservedPaise: 0, agreedPaise: 2900000 }, 2900000)).toBe('full');
  });
  it('places one payment in its deal: which payment, paid before it, balance after it', () => {
    const reqs = [
      { _id: 'a', deal: 'd1', status: 'paid', amount: 10000, part: 'advance', createdAt: new Date(1), payment: { paidAt: new Date('2026-11-08T05:00:00Z') } },
      { _id: 'c', deal: 'd1', status: 'declined', amount: 9999, part: 'part', createdAt: new Date(2) },
      { _id: 'b', deal: 'd1', status: 'submitted', amount: 19000, part: 'balance', createdAt: new Date(3) },
    ];
    expect(partSummary(deal, reqs, 'a')).toMatchObject({ partLabel: 'Advance', installment: 1, installments: 2, thisAmount: 10000, paidBefore: 0, balanceAfter: 19000, paidSoFar: 10000, balanceDue: 19000 });
    expect(partSummary(deal, reqs, 'b')).toMatchObject({ partLabel: 'Balance', installment: 2, installments: 2, thisAmount: 19000, paidBefore: 10000, waitingBefore: 0, balanceAfter: 0 });
    // A declined one takes nothing: no installment, the balance after it is what was left.
    expect(partSummary(deal, reqs, 'c')).toMatchObject({ installment: null, balanceAfter: 19000 });
    expect(partSummary(deal, reqs, 'nope')).toBeNull();
    // The order page's timeline carries the same "balance after".
    expect(dealView(deal, reqs).payments.map((p) => p.balanceAfter)).toEqual([19000, null, 0]);
  });
  it('the slip prints the whole deal, not just this payment', () => {
    const rows = Object.fromEntries(dealRows({
      supplierName: 'Sangaroon Trading', currency: 'THB', agreedTotal: 29400, partLabel: 'Advance', installment: 1, installments: 1,
      thisAmount: 10000, thisRupees: 24300, paidBefore: 0, waitingBefore: 0, balanceAfter: 19400, paidSoFar: 10000, rupeesPaid: 24300,
      balanceDue: 19400, startDate: '2026-11-06', completionDate: '2026-11-20',
    }));
    expect(rows['Agreed total']).toBe('THB 29,400.00 with Sangaroon Trading');
    expect(rows['This payment']).toMatch(/^Advance \(payment 1 of 1\) · THB 10,000.00 \(.+24,300.00 debited\)$/);
    expect(rows['Balance after this']).toBe('THB 19,400.00');
    expect(rows.Dates).toBe('advance paid 6 Nov 2026 · completion 20 Nov 2026');
    expect(dealRows(null)).toEqual([]);
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

  /**
   * A paid order and, in one step, a ₹29,000 deal on its first item with its
   * ₹10,000 advance raised (waiting for accounts).
   */
  async function withDeal(over = {}) {
    const order = await paidOrder();
    const id = String(order._id);
    const kit = String(order.items[0]._id);
    const mat = String(order.items[1]._id);
    const res = await procurement.session.form('/payment-requests/deals', {
      orderId: id, itemIds: [kit], payee: { ...BANK, name: 'Kochi Fabricators' }, currency: 'INR', agreedTotal: 29000, advance: 10000,
      completionDate: '2026-11-20', ...over,
    });
    expect(res.status).toBe(201);
    return { order, id, kit, mat, deal: res.body.deal, adv: res.body.request };
  }
  const raisePart = (s, id, dealId, amount, extra = {}) => s.form('/payment-requests/supplier', { orderId: id, dealId, amount, payee: BANK, ...extra });
  const dealOf = async (s, id) => (await s.get(`/payment-requests/order/${id}`)).body.deals[0];
  const approveAndPay = async (prId, pay = {}) => {
    expect((await accounts.session.post(`/payment-requests/${prId}/approve`)).status).toBe(200);
    const res = await admin.session.form(`/payment-requests/${prId}/pay`, { method: 'bank', reference: 'UTR1234', ...pay });
    expect(res.status).toBe(200);
    return res.body.request;
  };
  const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  it('the owner\'s example in one step: supplier, ₹29,000 total, ₹10,000 advance, completion date', async () => {
    const { id, deal, adv } = await withDeal();
    // Saved together: the deal and its advance.
    expect(deal).toMatchObject({ supplierName: 'Kochi Fabricators', currency: 'INR', agreedTotal: 29000, paid: 0, waiting: 10000, balanceDue: 29000, leftToAsk: 19000, completionDate: '2026-11-20' });
    expect(adv).toMatchObject({ part: 'advance', partLabel: 'Advance', dealId: deal.id, amount: 10000, status: 'submitted' });
    // No start date is typed: it is the day the advance is paid.
    expect(deal.startDate).toBe('');
    expect(deal.advancePaidAt).toBeNull();
    let d = await dealOf(procurement.session, id);
    expect(d.can.raise).toBe(false); // one part in flight at a time

    await approveAndPay(adv.id);
    d = await dealOf(procurement.session, id);
    expect(d).toMatchObject({ paid: 10000, waiting: 0, balanceDue: 19000, leftToAsk: 19000, fullyPaid: false, startDate: istToday() });
    expect(d.advancePaidAt).toBeTruthy();
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

  it('accounts sees what a part belongs to before approving it', async () => {
    // Regression: the request showed only "₹10,000 to Kochi Fabricators" — not that it is an advance on ₹29,000.
    const { adv } = await withDeal();
    const r = (await accounts.session.get(`/payment-requests/${adv.id}`)).body.request;
    expect(r).toMatchObject({ part: 'advance', partLabel: 'Advance' });
    expect(r.deal).toMatchObject({ supplierName: 'Kochi Fabricators', currency: 'INR', agreedTotal: 29000, partLabel: 'Advance', installment: 1, installments: 1, thisAmount: 10000, paidBefore: 0, balanceAfter: 19000, balanceDue: 29000, completionDate: '2026-11-20' });
    // The same on the payments list and in the admin's to-pay group — two reads for the page.
    const list = (await accounts.session.get('/payment-requests')).body.requests;
    expect(list.find((x) => x.id === adv.id).deal).toMatchObject({ agreedTotal: 29000, balanceAfter: 19000 });
    await accounts.session.post(`/payment-requests/${adv.id}/approve`);
    const gid = (await admin.session.get('/payment-requests/to-pay/suppliers')).body.groups[0].id;
    const group = (await admin.session.get(`/payment-requests/to-pay/suppliers/${gid}`)).body;
    expect((group.group || group).requests[0].deal).toMatchObject({ agreedTotal: 29000, balanceAfter: 19000 });
    // The PDF slip renders with it.
    const slip = await accounts.session.get(`/payment-requests/${adv.id}/slip`);
    expect(slip.status).toBe(200);
    expect(slip.headers['content-type']).toMatch(/pdf/);
  });

  it('the whole agreed total in one payment is a "Full payment"', async () => {
    const { adv } = await withDeal({ advance: 29000 });
    expect(adv).toMatchObject({ part: 'full', partLabel: 'Full payment' });
  });

  it('refuses a part that would pay more than the agreed total', async () => {
    const { id, deal, adv } = await withDeal();
    await approveAndPay(adv.id);
    const over = await raisePart(procurement.session, id, deal.id, 19000.01);
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/₹19,000 of ₹29,000 is left/);
    expect(await PaymentRequest.countDocuments({ deal: deal.id })).toBe(1);
  });

  it('an advance above the total, or a deal that cannot be saved, leaves nothing behind', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    const kit = String(order.items[0]._id);
    const body = { orderId: id, itemIds: [kit], payee: BANK, currency: 'INR', agreedTotal: 29000, advance: 29001, completionDate: '2026-11-20' };
    const over = await procurement.session.form('/payment-requests/deals', body);
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/advance cannot be more than the agreed total \(₹29,000\)/);
    // Fails after the deal is saved (no payee details): the deal is withdrawn, not left half done.
    const noPayee = await procurement.session.form('/payment-requests/deals', { ...body, advance: 10000, payee: { name: 'Kochi Fabricators', method: 'bank' } });
    expect(noPayee.status).toBe(400);
    expect(await PaymentRequest.countDocuments({})).toBe(0);
    expect(await SupplierDeal.countDocuments({ status: 'open' })).toBe(0);
    expect((await procurement.session.get(`/payment-requests/order/${id}`)).body.deals).toEqual([]);
    // …so the item is free for a proper one.
    expect((await procurement.session.form('/payment-requests/deals', { ...body, advance: 10000 })).status).toBe(201);
  });

  it('two parts raised at the same moment cannot together exceed the total', async () => {
    const { id, deal, adv } = await withDeal();
    expect((await procurement.session.post(`/payment-requests/${adv.id}/cancel`)).status).toBe(200);
    const results = await Promise.all([
      raisePart(procurement.session, id, deal.id, 20000),
      raisePart(procurement.session, id, deal.id, 20000),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await PaymentRequest.countDocuments({ deal: deal.id, status: 'submitted' })).toBe(1);
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(2000000);
  });

  it('a double-clicked approval approves once', async () => {
    const { adv } = await withDeal();
    const clicks = await Promise.all([1, 2, 3].map(() => accounts.session.post(`/payment-requests/${adv.id}/approve`)));
    expect(clicks.filter((r) => r.status === 200)).toHaveLength(1);
    const r = await PaymentRequest.findById(adv.id).lean();
    expect(r.history.filter((h) => h.action === 'approved')).toHaveLength(1);
  });

  it('a declined or cancelled part gives its share back', async () => {
    const { id, deal, adv } = await withDeal();
    expect((await accounts.session.post(`/payment-requests/${adv.id}/decline`, { note: 'Wrong amount' })).status).toBe(200);
    expect(await dealOf(procurement.session, id)).toMatchObject({ waiting: 0, leftToAsk: 29000 });
    // Declining twice (a retry) does not give it back twice.
    await accounts.session.post(`/payment-requests/${adv.id}/decline`, { note: 'Wrong amount' });
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(0);

    const b = (await raisePart(procurement.session, id, deal.id, 12000)).body;
    expect(b.request.part).toBe('advance');
    expect((await procurement.session.post(`/payment-requests/${b.request.id}/cancel`)).status).toBe(200);
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(0);
  });

  it('editing a part\'s amount keeps the total honest', async () => {
    const { deal, adv } = await withDeal();
    expect((await procurement.session.put(`/payment-requests/${adv.id}`, { amount: 30000 })).status).toBe(409);
    const ok = await procurement.session.put(`/payment-requests/${adv.id}`, { amount: 29000 });
    expect(ok.status).toBe(200);
    // The whole agreed total in one payment: "Full payment", not a "Balance".
    expect(ok.body.request.part).toBe('full');
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(2900000);
    const down = await procurement.session.put(`/payment-requests/${adv.id}`, { amount: 8000 });
    expect(down.body.request.part).toBe('advance');
    expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(800000);
    // A deal part stays in the deal's currency.
    expect((await procurement.session.put(`/payment-requests/${adv.id}`, { currency: 'THB', amount: 8000 })).status).toBe(400);
  });

  it('whoever raised it can edit until it is paid; a money change after approval goes back to accounts', async () => {
    const { adv } = await withDeal();
    expect((await accounts.session.post(`/payment-requests/${adv.id}/approve`)).status).toBe(200);
    // Wording only: stays approved.
    const words = await procurement.session.put(`/payment-requests/${adv.id}`, { description: 'Advance — powder coating included' });
    expect(words.status).toBe(200);
    expect(words.body.request.status).toBe('approved');
    // Money: back to accounts, kept in the history (old → new).
    const money = await procurement.session.put(`/payment-requests/${adv.id}`, { amount: 12000 });
    expect(money.status).toBe(200);
    expect(money.body.request.status).toBe('submitted');
    expect(money.body.request.history.at(-1).note).toMatch(/amount ₹10,000 → ₹12,000 — back to accounts to approve again/);
    // Someone else on another team cannot.
    expect((await ops.session.put(`/payment-requests/${adv.id}`, { amount: 9000 })).status).toBe(404);
    // Paid: locked.
    await accounts.session.post(`/payment-requests/${adv.id}/approve`);
    await admin.session.form(`/payment-requests/${adv.id}/pay`, { method: 'bank', reference: 'UTR9' });
    const locked = await procurement.session.put(`/payment-requests/${adv.id}`, { amount: 5000 });
    expect(locked.status).toBe(403);
    expect(locked.body.message).toMatch(/paid, declined or cancelled request cannot be edited/);
  });

  it('who sets it up, and what it refuses', async () => {
    const order = await paidOrder();
    const id = String(order._id);
    const kit = String(order.items[0]._id);
    const body = { orderId: id, itemIds: [kit], payee: BANK, currency: 'INR', agreedTotal: 29000, advance: 10000, completionDate: '2026-11-20' };
    const post = (s, over = {}) => s.form('/payment-requests/deals', { ...body, ...over });
    expect((await post(accounts.session)).status).toBe(403);
    expect((await post(ops.session)).status).toBe(403);
    expect((await post(procurement.session, { agreedTotal: 'abc' })).status).toBe(400);
    expect((await post(procurement.session, { agreedTotal: 0 })).status).toBe(400);
    expect((await post(procurement.session, { advance: 0 })).status).toBe(400);
    expect((await post(procurement.session, { completionDate: '' })).status).toBe(400);
    expect((await post(procurement.session, { completionDate: '2026-02-30' })).status).toBe(400);
    expect((await post(procurement.session, { currency: 'XYZ' })).status).toBe(400);
    expect((await post(procurement.session, { itemIds: [String(new mongoose.Types.ObjectId())] })).status).toBe(400);
    expect(await SupplierDeal.countDocuments({ status: 'open' })).toBe(0);
    expect(await PaymentRequest.countDocuments({})).toBe(0);
    expect((await post(procurement.session)).status).toBe(201);
    // One open deal per item.
    expect((await post(procurement.session)).status).toBe(409);
    expect(await PaymentRequest.countDocuments({})).toBe(1);
  });

  it('one way to pay per item: a deal item takes no one-off payment, and vice versa', async () => {
    const { id, kit, mat, adv } = await withDeal();
    // Even with no part in flight, the item is paid through its deal.
    expect((await procurement.session.post(`/payment-requests/${adv.id}/cancel`)).status).toBe(200);
    const plain = await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [kit], amount: 5000, payee: BANK });
    expect(plain.status).toBe(409);
    expect(plain.body.message).toMatch(/paid in parts/);
    expect((await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [mat], amount: 500, payee: BANK })).status).toBe(201);
    expect((await procurement.session.form('/payment-requests/deals', {
      orderId: id, itemIds: [mat], payee: BANK, agreedTotal: 900, advance: 100, completionDate: '2026-11-20',
    })).status).toBe(409);
  });

  it('changing the total or completion date needs a reason, is kept in history, and never drops below what is asked for', async () => {
    const { deal } = await withDeal();
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
    const { id, deal, adv } = await withDeal();
    expect((await procurement.session.post(`/payment-requests/deals/${deal.id}/remove`)).status).toBe(409);
    await procurement.session.post(`/payment-requests/${adv.id}/cancel`);
    expect((await procurement.session.post(`/payment-requests/deals/${deal.id}/remove`, { note: 'set up by mistake' })).status).toBe(200);
    expect((await procurement.session.get(`/payment-requests/order/${id}`)).body.deals).toEqual([]);
  });

  it('the item ships only once the balance is paid', async () => {
    const { id, kit, mat, deal, adv } = await withDeal();
    await approveAndPay(adv.id);
    await expect(assertNoPendingSupplierPayment(id, [kit])).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/balance of ₹19,000/) });
    await expect(wf.shipWithProof(procurement.user, id, { itemIds: [kit] }, photo, req)).rejects.toMatchObject({ statusCode: 409 });
    // The other item is not part of the deal.
    await expect(assertNoPendingSupplierPayment(id, [mat])).resolves.toBeUndefined();
    const bal = (await raisePart(procurement.session, id, deal.id, 19000)).body.request.id;
    await approveAndPay(bal);
    await expect(wf.shipWithProof(procurement.user, id, { itemIds: [kit] }, photo, req)).resolves.toBeTruthy();
  });

  describe('a deal in a foreign currency (THB)', () => {
    const thb = { currency: 'THB', agreedTotal: 29400, advance: 10000 };

    it('is agreed, raised, approved and checked in baht; the rupees are what the bank debited', async () => {
      const { id, kit, deal, adv } = await withDeal(thb);
      expect(deal).toMatchObject({ currency: 'THB', agreedTotal: 29400, waiting: 10000, leftToAsk: 19400 });
      // Approved in baht — no guessed rupee figure.
      expect(adv).toMatchObject({ currency: 'THB', foreignAmount: 10000, amount: 0, rupeesPending: true, part: 'advance' });
      expect((await accounts.session.post(`/payment-requests/${adv.id}/approve`)).status).toBe(200);
      // Paying needs the rupee debit.
      expect((await admin.session.form(`/payment-requests/${adv.id}/pay`, { method: 'bank', reference: 'UTR1' })).status).toBe(400);
      const paid = await admin.session.form(`/payment-requests/${adv.id}/pay`, { method: 'bank', reference: 'UTR1', rupees: 24300 });
      expect(paid.status).toBe(200);
      expect(paid.body.request).toMatchObject({ amount: 24300, foreignAmount: 10000, currency: 'THB' });

      let d = await dealOf(procurement.session, id);
      // The deal still counts in baht; the rupees are shown beside.
      expect(d).toMatchObject({ currency: 'THB', paid: 10000, balanceDue: 19400, leftToAsk: 19400, rupeesPaid: 24300, startDate: istToday() });
      expect(d.payments[0]).toMatchObject({ amount: 10000, rupees: 24300 });

      // Overpay is checked in baht.
      const over = await raisePart(procurement.session, id, deal.id, 19400.01);
      expect(over.status).toBe(409);
      expect(over.body.message).toMatch(/THB 19,400 of THB 29,400 is left/);
      // A part in another currency than the deal's is refused.
      expect((await raisePart(procurement.session, id, deal.id, 19400, { currency: 'INR' })).status).toBe(400);
      await expect(assertNoPendingSupplierPayment(id, [kit])).rejects.toMatchObject({ message: expect.stringMatching(/THB 19,400/) });

      const bal = await raisePart(procurement.session, id, deal.id, 19400);
      expect(bal.status).toBe(201);
      expect(bal.body.request).toMatchObject({ currency: 'THB', foreignAmount: 19400, part: 'balance' });
      expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(2940000);
      // A declined foreign part gives back its baht.
      expect((await accounts.session.post(`/payment-requests/${bal.body.request.id}/decline`, { note: 'Wrong' })).status).toBe(200);
      expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(1000000);
      const bal2 = (await raisePart(procurement.session, id, deal.id, 19400)).body.request.id;
      await approveAndPay(bal2, { rupees: 47100 });
      d = await dealOf(procurement.session, id);
      expect(d).toMatchObject({ paid: 29400, balanceDue: 0, fullyPaid: true, rupeesPaid: 71400 });
    });

    it('a part paid from a THB account (no rupees) moves the deal by its baht, exactly as a rupee-debited one', async () => {
      const { id, deal, adv } = await withDeal(thb);
      await accounts.session.post(`/payment-requests/${adv.id}/approve`);
      const paid = await admin.session.form(`/payment-requests/${adv.id}/pay`, {
        method: 'bank', reference: 'UTR1', paidFrom: 'foreign', sentAmount: '10000', accountLabel: "HR's Thailand account",
      });
      expect(paid.status).toBe(200);
      expect(paid.body.request).toMatchObject({ amount: 0, foreignAmount: 10000, paidFrom: { currency: 'THB', amount: 10000 } });
      const d = await dealOf(procurement.session, id);
      expect(d).toMatchObject({ currency: 'THB', paid: 10000, balanceDue: 19400, leftToAsk: 19400, rupeesPaid: 0 });
      expect(d.payments[0]).toMatchObject({ amount: 10000, rupees: null });
      // The balance part, paid the same way, completes the deal.
      const bal = (await raisePart(procurement.session, id, deal.id, 19400)).body.request.id;
      await approveAndPay(bal, { paidFrom: 'foreign', sentAmount: '19400' });
      expect(await dealOf(procurement.session, id)).toMatchObject({ paid: 29400, balanceDue: 0, fullyPaid: true, rupeesPaid: 0 });
    });

    it('a foreign supplier bill is paid on its own, never in a batch transfer', async () => {
      const { adv } = await withDeal(thb);
      expect((await accounts.session.post(`/payment-requests/${adv.id}/approve`)).status).toBe(200);
      const groups = (await admin.session.get('/payment-requests/to-pay/suppliers')).body;
      expect(JSON.stringify(groups)).not.toMatch(adv.number);
      const batch = await admin.session.form('/payment-requests/pay-batch', { ids: [adv.id], expectedTotal: 0, method: 'bank', reference: 'UTR9' });
      expect(batch.status).toBe(400);
      expect(batch.body.message).toMatch(/foreign-currency bill/);
    });

    it('a one-off supplier payment may be in any currency too', async () => {
      const order = await paidOrder();
      const res = await procurement.session.form('/payment-requests/supplier', {
        orderId: String(order._id), itemIds: [String(order.items[1]._id)], currency: 'USD', amount: 120, payee: BANK,
      });
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ currency: 'USD', foreignAmount: 120, amount: 0, rupeesPending: true });
    });
  });

  describe('cancelling an order with a supplier advance', () => {
    it('is allowed while the advance only waits for accounts', async () => {
      const { id } = await withDeal();
      const res = await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' });
      expect(res.success).toBe(true);
    });

    it('is blocked once accounts approved it — whole order, per line, customer and admin', async () => {
      const { id, kit, mat, adv } = await withDeal();
      expect((await accounts.session.post(`/payment-requests/${adv.id}/approve`)).status).toBe(200);

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
      const { id, adv } = await withDeal();
      await approveAndPay(adv.id);
      const res = await admin.session.put(`/orders/${id}/status`, { status: 'cancelled', reason: 'customer_request' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.message).toMatch(/Supplier advance already paid/);
      expect((await Order.findById(id).lean()).status).toBe('processing');
    });

    it('a waiting advance is withdrawn when the order is cancelled — not left in accounts\' queue', async () => {
      // Regression: it stayed "submitted" for good (approving it was refused) and kept its share of the total.
      const { id, deal, adv } = await withDeal();
      expect((await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' })).success).toBe(true);
      const r = await PaymentRequest.findById(adv.id).lean();
      expect(r.status).toBe('cancelled');
      expect(r.history.at(-1)).toMatchObject({ action: 'cancelled', byName: 'System', note: expect.stringMatching(/Withdrawn automatically — order cancelled/) });
      expect((await SupplierDeal.findById(deal.id).lean()).reservedPaise).toBe(0);
      const queue = await accounts.session.get('/payment-requests?status=to_approve');
      expect(queue.body.requests.map((x) => x.id)).not.toContain(adv.id);
      // Nothing to approve or pay any more.
      expect((await accounts.session.post(`/payment-requests/${adv.id}/approve`)).status).toBe(409);
      expect((await admin.session.form(`/payment-requests/${adv.id}/pay`, { method: 'bank' })).status).toBe(409);
    });

    it('cancelling one item withdraws only the waiting payments for that item', async () => {
      const order = await paidOrder();
      const id = String(order._id);
      const [kit, mat] = order.items.map((i) => String(i._id));
      const forKit = (await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [kit], amount: 30000, payee: BANK })).body.request;
      const forMat = (await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [mat], amount: 900, payee: BANK })).body.request;
      const res = await cancellationService.cancelLines(id, { lines: [{ itemId: kit, quantity: 1 }], reason: 'customer_request' }, { userId: admin.user._id });
      expect(res.success).toBe(true);
      expect((await PaymentRequest.findById(forKit.id).lean()).status).toBe('cancelled');
      expect((await PaymentRequest.findById(forMat.id).lean()).status).toBe('submitted');
      // The roll-up and a retry find nothing more to do.
      const { withdrawWaitingSupplierPayments } = await import('../services/supplierAdvanceGuard.js');
      expect(await withdrawWaitingSupplierPayments(await Order.findById(id).lean())).toEqual([]);
      expect((await PaymentRequest.findById(forKit.id).lean()).history.filter((h) => h.action === 'cancelled')).toHaveLength(1);
    });

    it('a payment for an item with only some units cancelled is still live', async () => {
      const { itemsCancelled } = await import('../services/supplierAdvanceGuard.js');
      const order = { status: 'processing', items: [{ _id: 'a', quantity: 2 }, { _id: 'b', quantity: 1 }], cancellations: [{ lines: [{ itemId: 'a', quantity: 1 }, { itemId: 'b', quantity: 1 }] }] };
      expect(itemsCancelled(order, ['a'])).toBe(false);
      expect(itemsCancelled(order, ['b'])).toBe(true);
      expect(itemsCancelled(order, ['a', 'b'])).toBe(false);
      expect(itemsCancelled({ ...order, status: 'cancelled' }, ['a'])).toBe(true);
    });

    it('an approved one-off supplier payment cannot be paid once the order is cancelled', async () => {
      // Regression: the admin could still pay a supplier for a cancelled order (200).
      const order = await paidOrder();
      const id = String(order._id);
      const kit = String(order.items[0]._id);
      const p = (await procurement.session.form('/payment-requests/supplier', { orderId: id, itemIds: [kit], amount: 30000, payee: BANK })).body.request;
      expect((await accounts.session.post(`/payment-requests/${p.id}/approve`)).status).toBe(200);
      // One-off payments do not block cancelling (only a deal advance does).
      expect((await orderStatusService.updateOrderStatus(id, 'cancelled', { isAdmin: true, reason: 'customer_request', cancelledBy: 'admin' })).success).toBe(true);
      // Approved, so not withdrawn automatically: accounts declines it.
      expect((await PaymentRequest.findById(p.id).lean()).status).toBe('approved');
      const pay = await admin.session.form(`/payment-requests/${p.id}/pay`, { method: 'bank', reference: 'UTR1' });
      expect(pay.status).toBe(409);
      expect(pay.body.message).toMatch(/cancelled — decline this supplier payment instead/);
      const batch = await admin.session.form('/payment-requests/pay-batch', { ids: JSON.stringify([p.id]), expectedTotal: 30000, method: 'bank' });
      expect(batch.status).toBe(409);
      expect((await PaymentRequest.findById(p.id).lean()).status).toBe('approved');
      // The request says why, and offers decline instead of pay — straight from approved.
      const seen = (await accounts.session.get(`/payment-requests/${p.id}`)).body.request;
      expect(seen).toMatchObject({ orderCancelled: true, can: expect.objectContaining({ pay: false, approve: false, decline: true }) });
      expect((await accounts.session.post(`/payment-requests/${p.id}/decline`, { note: 'Order cancelled' })).status).toBe(200);
      // On a live order an approved payment still cannot be declined (hold it first, as before).
      const order2 = await paidOrder();
      const p2 = (await procurement.session.form('/payment-requests/supplier', { orderId: String(order2._id), itemIds: [String(order2.items[0]._id)], amount: 100, payee: BANK })).body.request;
      await accounts.session.post(`/payment-requests/${p2.id}/approve`);
      expect((await accounts.session.post(`/payment-requests/${p2.id}/decline`, { note: 'changed mind' })).status).toBe(409);
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

    it('finds an order by its short number, customer name or phone — and returns no address or phone', async () => {
      const order = await paidOrder();
      const id = String(order._id);
      const short = id.slice(-8).toUpperCase();
      const look = async (q) => (await ops.session.get(`/payment-requests/order-lookup?q=${encodeURIComponent(q)}`)).body.orders;
      for (const q of [`#${short}`, short.toLowerCase(), id, 'ravi kum', '98123 45678']) {
        const found = await look(q);
        expect([q, found.map((o) => o.id)]).toEqual([q, [id]]);
      }
      const [o] = await look(`#${short}`);
      expect(o).toEqual({ id, number: `#${short}`, customer: 'Ravi Kumar', total: 52000, createdAt: expect.any(String) });
      // The old website number finds it too; it reads as the panel's number (the link stores that one).
      await Order.updateOne({ _id: order._id }, { $set: { wpId: 10495 } });
      expect(await look('10495')).toEqual([expect.objectContaining({ id, number: `#${short}` })]);
      expect(await look('nobody-like-this')).toEqual([]);
      expect(await look('a')).toEqual([]); // too short to search
      // An unpaid order is not in the team workflow: not offered.
      const unpaid = await Order.create({ user: new mongoose.Types.ObjectId(), items: [{ product: new mongoose.Types.ObjectId(), name: 'X', price: 1, quantity: 1 }], shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1', city: 'K', state: 'K', postalCode: '682001' }, subtotal: 1, totalAmount: 1, status: 'awaiting_payment', paymentStatus: 'pending' });
      expect((await look('ravi')).map((x) => x.id)).not.toContain(String(unpaid._id));
      const customer = await makeUser('Cara', 'customer');
      expect((await customer.session.get('/payment-requests/order-lookup?q=ravi')).status).toBe(403);
    });

    it('links, changes and removes the order on an expense — at any status, kept in history', async () => {
      const a = await paidOrder();
      const b = await paidOrder();
      const res = await expense(ops.session, { description: 'Fuel for a delivery' });
      const prId = res.body.request.id;
      expect(res.body.request.order).toBeNull();
      expect(res.body.request.can.linkOrder).toBe(true);
      const link = (s, orderId) => s.post(`/payment-requests/${prId}/order`, { orderId });

      const linked = await link(ops.session, String(a._id));
      expect(linked.status).toBe(200);
      expect(linked.body.request.order).toMatchObject({ id: String(a._id) });
      expect((await procurement.session.get(`/payment-requests/order/${a._id}`)).body.requests.map((r) => r.id)).toEqual([prId]);

      // Paid already: still linkable — no money changes.
      expect((await accounts.session.post(`/payment-requests/${prId}/approve`)).status).toBe(200);
      expect((await admin.session.form(`/payment-requests/${prId}/pay`, { method: 'upi', reference: 'UPI1' })).status).toBe(200);
      const moved = await link(accounts.session, String(b._id));
      expect(moved.status).toBe(200);
      expect(moved.body.request.status).toBe('paid');
      expect((await procurement.session.get(`/payment-requests/order/${a._id}`)).body.requests).toEqual([]);
      expect((await procurement.session.get(`/payment-requests/order/${b._id}`)).body.requests).toHaveLength(1);

      const removed = await link(ops.session, null);
      expect(removed.body.request.order).toBeNull();
      const hist = (await PaymentRequest.findById(prId).lean()).history.map((h) => h.note);
      expect(hist).toEqual(expect.arrayContaining([
        expect.stringMatching(/^linked to order #/), expect.stringMatching(/^order #\w+ → #\w+$/), expect.stringMatching(/^order #\w+ removed$/),
      ]));
      // A retry of the same link changes nothing.
      const again = await link(ops.session, null);
      expect(again.status).toBe(200);
      expect((await PaymentRequest.findById(prId).lean()).history).toHaveLength(hist.length);
    });

    it('who may link an expense, and what is refused', async () => {
      const order = await paidOrder();
      const prId = (await expense(ops.session, { description: 'Fuel for a delivery' })).body.request.id;
      const otherOps = await makeUser('Olu', 'staff', staff('operations'));
      const opsHead = await makeUser('Oona', 'staff', staff('operations', true));
      expect((await otherOps.session.post(`/payment-requests/${prId}/order`, { orderId: String(order._id) })).status).toBe(403);
      expect((await procurement.session.post(`/payment-requests/${prId}/order`, { orderId: String(order._id) })).status).toBe(404);
      expect((await opsHead.session.post(`/payment-requests/${prId}/order`, { orderId: String(order._id) })).status).toBe(200);
      expect((await ops.session.post(`/payment-requests/${prId}/order`, { orderId: String(new mongoose.Types.ObjectId()) })).status).toBe(400);
      // A supplier payment's order is fixed.
      const sup = await procurement.session.form('/payment-requests/supplier', { orderId: String(order._id), itemIds: [String(order.items[1]._id)], amount: 500, payee: BANK });
      expect(sup.body.request.can.linkOrder).toBe(false);
      expect((await admin.session.post(`/payment-requests/${sup.body.request.id}/order`, { orderId: null })).status).toBe(400);
    });

    it('refuses an order that does not exist', async () => {
      expect((await expense(ops.session, { orderId: String(new mongoose.Types.ObjectId()) })).status).toBe(400);
      expect((await expense(ops.session, { orderId: 'not-an-id' })).status).toBe(400);
    });
  });
});
