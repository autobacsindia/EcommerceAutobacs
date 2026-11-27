/**
 * "Paid, no sale bill yet" over HTTP (routes/adminRevenue.js → services/unbilledReceiptService.js):
 * money received with no Zoho invoice is counted in revenue, shown apart, never twice.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: UnbilledReceipt } = await import('../models/UnbilledReceipt.js');
const { currentFiscalYear } = await import('../utils/storeTime.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const PAY_HEAD = 'Payment Number,CustomerPayment ID,Mode,Amount,Unused Amount,Reference Number,Currency Code,Customer Name,Payment Type,Date,Payment Status,Invoice Number';

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
    upload: (url, text) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf)
      .attach('file', Buffer.from(text), { filename: 'Customer_Payment.csv', contentType: 'text/csv' }),
  };
}

let n = 0;
async function makeUser(role, staff) {
  n += 1;
  const email = `unb-${role}${n}@autobacs.test`;
  await User.create({ name: `${role} ${n}`, email, role, staff, phone: '9876500000', passwordHash: await bcrypt.hash(PW, 4) });
  return signIn(email);
}

const fyDay = (d) => new Date(currentFiscalYear().start.getTime() + d * 864e5);
const isoDay = (date) => new Date(date.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function order({ day, amount, name, status = 'delivered' }) {
  const _id = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({
    _id, user: new mongoose.Types.ObjectId(), source: 'web', status, paymentStatus: 'paid', totalAmount: amount, subtotal: amount,
    items: [], shippingAddress: { fullName: name }, createdAt: fyDay(day), updatedAt: fyDay(day),
  });
  return _id;
}

/** One CSV line of Zoho's Payments Received export. */
const payLine = ({ id, day, amount, unused = amount, name, ref = '', status = 'Paid', inv = '', no = `PAY-${id}` }) =>
  [no, id, 'Bank Transfer', amount.toFixed(2), unused.toFixed(3), ref, 'INR', `"${name}"`,
    unused === amount ? 'Customer Advance' : 'Invoice Payment', isoDay(fyDay(day)), status, inv].join(',');
const payCsv = (...lines) => [PAY_HEAD, ...lines].join('\n');

const summary = async (adm) => (await adm.get('/admin/revenue')).body.summary;

describe('Paid, no sale bill yet', () => {
  beforeAll(async () => { await dbHandler.connect(); await UnbilledReceipt.init(); });
  afterEach(() => dbHandler.clearDatabase());
  afterAll(async () => {
    await dbHandler.closeDatabase();
    cronService?.shutdown?.();
    adaptiveThrottlingService?.shutdown?.();
  });

  describe('admin only, on the server', () => {
    it('401 without a login', async () => {
      await request(app).get(`${BASE}/admin/revenue/unbilled`).expect(401);
      // A write without a login is refused before it reaches the route (CSRF first, then auth).
      expect([401, 403]).toContain((await request(app).post(`${BASE}/admin/revenue/unbilled`).send({})).status);
      expect(await UnbilledReceipt.countDocuments()).toBe(0);
    });

    it.each([{ role: 'customer' }, { role: 'staff', staff: { team: 'accounts', isHead: true, active: true } }])('403 for $role', async ({ role, staff }) => {
      const u = await makeUser(role, staff);
      expect((await u.get('/admin/revenue/unbilled')).status).toBe(403);
      expect((await u.post('/admin/revenue/unbilled', {
        customerName: 'X', amount: 100, receivedAt: isoDay(fyDay(3)), proof: 'p',
      })).status).toBe(403);
      expect((await u.upload('/admin/revenue/zoho-import', payCsv(payLine({ id: '1', day: 5, amount: 100, name: 'X' })))).status).toBe(403);
      expect(await UnbilledReceipt.countDocuments()).toBe(0);
    });
  });

  describe('Zoho payments export', () => {
    let adm;
    beforeEach(async () => { adm = await makeUser('admin'); });

    it('counts unused money once, apart from bills, and the same file twice changes nothing', async () => {
      const file = payCsv(
        payLine({ id: '11', day: 10, amount: 50000, name: 'Kiran Motors' }), // advance, no bill
        payLine({ id: '12', day: 11, amount: 30000, unused: 10000, name: 'Rao', inv: 'AUTO/1' }), // 20k on a bill, 10k left
        payLine({ id: '13', day: 12, amount: 9000, unused: 0, name: 'Billed Co', inv: 'AUTO/2' }), // fully on a bill
        payLine({ id: '14', day: 13, amount: 7000, name: 'Draft Co', status: 'Draft' }), // not money in
      );
      const up = await adm.upload('/admin/revenue/zoho-import', file);
      expect(up.status).toBe(200);
      expect(up.body.result).toMatchObject({ kind: 'payments', inserted: 2, skipped: { draft: 1, void: 0 } });

      let s = await summary(adm);
      expect(s.revenue.unbilled).toMatchObject({ total: 60000, count: 2, zoho: 60000, manual: 0 });
      expect(s.revenue.total).toBe(60000);
      expect(s.sales).toMatchObject({ total: 2, unbilled: 2 });
      expect(s.months.reduce((a, m) => a + m.unbilled, 0)).toBe(60000);
      expect(s.months.reduce((a, m) => a + m.total, 0)).toBe(60000);

      const again = await adm.upload('/admin/revenue/zoho-import', file);
      expect(again.body.result).toMatchObject({ inserted: 0, updated: 2 });
      expect(await UnbilledReceipt.countDocuments()).toBe(2);
      s = await summary(adm);
      expect(s.revenue.unbilled.total).toBe(60000);

      const { stats } = (await adm.get('/admin/stats')).body;
      expect(stats.companyRevenue).toMatchObject({ total: 60000, unbilled: 60000 });
    });

    it('a payment Zoho later puts on an invoice drops out (the bill counts instead), and comes back if un-applied', async () => {
      await adm.upload('/admin/revenue/zoho-import', payCsv(payLine({ id: '21', day: 20, amount: 40000, name: 'Prakash' }))).expect(200);
      expect((await summary(adm)).revenue.unbilled.total).toBe(40000);

      const later = await adm.upload('/admin/revenue/zoho-import',
        payCsv(payLine({ id: '21', day: 20, amount: 40000, unused: 0, name: 'Prakash', inv: 'AUTO/26-27/0300' })));
      expect(later.body.result).toMatchObject({ billed: 1 });
      expect((await summary(adm)).revenue.unbilled.total).toBe(0);
      const billed = (await adm.get('/admin/revenue/unbilled?state=billed')).body.receipts;
      expect(billed).toHaveLength(1);
      expect(billed[0]).toMatchObject({ amount: 0, state: 'billed' });

      await adm.upload('/admin/revenue/zoho-import', payCsv(payLine({ id: '21', day: 20, amount: 40000, name: 'Prakash' }))).expect(200);
      expect((await summary(adm)).revenue.unbilled.total).toBe(40000);
    });

    it('a Razorpay payment of a website order is that order — not counted again', async () => {
      const orderId = await order({ day: 30, amount: 12000, name: 'Meena' });
      await Payment.collection.insertOne({
        order: orderId, user: new mongoose.Types.ObjectId(), amount: 12000, paymentMethod: 'upi', paymentGateway: 'razorpay',
        gatewayPaymentId: 'pay_AbCdEf12345678', status: 'completed', createdAt: fyDay(30),
      });
      await adm.upload('/admin/revenue/zoho-import',
        payCsv(payLine({ id: '31', day: 31, amount: 12000, name: 'Someone Else', ref: 'pay_AbCdEf12345678' }))).expect(200);

      const s = await summary(adm);
      expect(s.revenue.unbilled.total).toBe(0);
      expect(s.revenue.total).toBe(12000); // the website order, once
      const row = await UnbilledReceipt.findOne({ zohoPaymentId: '31' }).lean();
      expect(row).toMatchObject({ state: 'in_panel', stateBy: 'auto' });
      expect(String(row.order)).toBe(String(orderId));
    });

    it('a payment that looks like a panel order is held back; the admin decision survives re-import', async () => {
      await order({ day: 40, amount: 10000, name: 'Ravi Kumar' });
      const file = payCsv(payLine({ id: '41', day: 41, amount: 10000, name: 'Ravi Kumar' }));
      await adm.upload('/admin/revenue/zoho-import', file).expect(200);

      let s = await summary(adm);
      expect(s.revenue.total).toBe(10000); // never 20000 on a guess
      const row = await UnbilledReceipt.findOne({ zohoPaymentId: '41' }).lean();
      expect(['in_panel', 'needs_check']).toContain(row.state);
      expect(s.revenue.unbilled.total).toBe(0);

      await adm.patch(`/admin/revenue/unbilled/${row._id}`, { decision: 'count' }).expect(200);
      expect((await summary(adm)).revenue.unbilled.total).toBe(10000);

      await adm.upload('/admin/revenue/zoho-import', file).expect(200);
      await adm.post('/admin/revenue/zoho-rematch').expect(200);
      s = await summary(adm);
      expect(s.revenue.unbilled.total).toBe(10000);
      expect(s.revenue.total).toBe(20000);
    });
  });

  describe('added by hand', () => {
    let adm;
    beforeEach(async () => { adm = await makeUser('admin'); });
    const entry = (o = {}) => ({
      customerName: 'Arun', amount: 1250000, receivedAt: isoDay(fyDay(0)), mode: 'Bank', proof: 'https://app.clickup.com/t/x', note: 'Phase 2 balance', ...o,
    });

    it('validates: proof, amount, date', async () => {
      expect((await adm.post('/admin/revenue/unbilled', entry({ proof: '' }))).status).toBe(400);
      expect((await adm.post('/admin/revenue/unbilled', entry({ amount: 0 }))).status).toBe(400);
      expect((await adm.post('/admin/revenue/unbilled', entry({ amount: 2e8 }))).status).toBe(400);
      expect((await adm.post('/admin/revenue/unbilled', entry({ receivedAt: 'not-a-day' }))).status).toBe(400);
      const future = isoDay(new Date(Date.now() + 10 * 864e5));
      expect((await adm.post('/admin/revenue/unbilled', entry({ receivedAt: future }))).status).toBe(400);
      expect(await UnbilledReceipt.countDocuments()).toBe(0);
    });

    it('counts, then "now billed" needs an invoice number and drops it; remove needs a reason', async () => {
      const add = await adm.post('/admin/revenue/unbilled', entry());
      expect(add.status).toBe(201);
      expect(add.body.receipt).toMatchObject({ source: 'manual', state: 'open', amount: 1250000 });
      expect(add.body.receipt.history).toBeUndefined();
      let s = await summary(adm);
      expect(s.revenue.unbilled).toMatchObject({ total: 1250000, manual: 1250000, count: 1 });

      const id = add.body.receipt._id;
      expect((await adm.patch(`/admin/revenue/unbilled/${id}`, { decision: 'billed' })).status).toBe(400);
      expect((await adm.patch(`/admin/revenue/unbilled/${id}`, { decision: 'billed', invoiceNumber: '<x>' })).status).toBe(400);
      expect((await adm.patch(`/admin/revenue/unbilled/${id}`, { decision: 'same_as_panel' })).status).toBe(400); // no order to compare
      const b = await adm.patch(`/admin/revenue/unbilled/${id}`, { decision: 'billed', invoiceNumber: 'AUTO/26-27/0301' });
      expect(b.status).toBe(200);
      expect(b.body.receipt).toMatchObject({ state: 'billed', billedAs: 'AUTO/26-27/0301' });
      expect((await summary(adm)).revenue.unbilled.total).toBe(0);

      const two = (await adm.post('/admin/revenue/unbilled', entry({ customerName: 'Suresh', amount: 90000 }))).body.receipt;
      expect((await adm.patch(`/admin/revenue/unbilled/${two._id}`, { decision: 'remove' })).status).toBe(400);
      await adm.patch(`/admin/revenue/unbilled/${two._id}`, { decision: 'remove', note: 'Not our sale' }).expect(200);
      s = await summary(adm);
      expect(s.revenue.unbilled.total).toBe(0);
      const doc = await UnbilledReceipt.findById(two._id).lean();
      expect(doc.history.map((h) => h.action)).toEqual(['added', 'removed']);
      expect((await adm.patch(`/admin/revenue/unbilled/${new mongoose.Types.ObjectId()}`, { decision: 'count' })).status).toBe(404);
    });

    it('lists newest first with a bounded cursor', async () => {
      const ago = (d) => isoDay(new Date(Date.now() - d * 864e5));
      for (const d of [3, 2, 1]) await adm.post('/admin/revenue/unbilled', entry({ customerName: `C${d}`, receivedAt: ago(d) })).expect(201);
      const p1 = (await adm.get('/admin/revenue/unbilled?period=all&limit=2')).body;
      expect(p1.receipts.map((r) => r.customerName)).toEqual(['C1', 'C2']);
      const p2 = (await adm.get(`/admin/revenue/unbilled?period=all&limit=2&cursor=${p1.nextCursor}`)).body;
      expect(p2.receipts.map((r) => r.customerName)).toEqual(['C3']);
      expect(p2.nextCursor).toBeNull();
      expect((await adm.get('/admin/revenue/unbilled?cursor=junk_x')).status).toBe(400);
      expect((await adm.get('/admin/revenue/unbilled?state=nope')).status).toBe(400);
    });
  });
});
