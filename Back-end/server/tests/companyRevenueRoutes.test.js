/**
 * Company revenue over HTTP (routes/adminRevenue.js + the header in routes/adminStats.js):
 * admin-only on the server, and every sale counted once across the panel and Zoho.
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
const { default: ZohoInvoice } = await import('../models/ZohoInvoice.js');
const { currentFiscalYear } = await import('../utils/storeTime.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const HEAD = 'Invoice Date,Invoice ID,Invoice Number,Invoice Status,Customer Name,Currency Code,SubTotal,Total,Balance,PurchaseOrder,Item Name';

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
      .attach('file', Buffer.from(text), { filename: 'invoices.csv', contentType: 'text/csv' }),
  };
}

let n = 0;
async function makeUser(role, staff) {
  n += 1;
  const email = `rev-${role}${n}@autobacs.test`;
  await User.create({ name: `${role} ${n}`, email, role, staff, phone: '9876500000', passwordHash: await bcrypt.hash(PW, 4) });
  return signIn(email);
}

// Days after the FY start, as an ISO date (IST) — keeps the test inside the current FY.
const fyDay = (d) => new Date(currentFiscalYear().start.getTime() + d * 864e5);
const isoDay = (date) => new Date(date.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

/** Raw insert: these tests are about counting, not the order lifecycle. */
async function order({ day, amount, name, status = 'delivered', paymentStatus = 'paid', source = 'web' }) {
  const _id = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({
    _id, user: new mongoose.Types.ObjectId(), source, status, paymentStatus, totalAmount: amount, subtotal: amount,
    items: [], shippingAddress: { fullName: name }, createdAt: fyDay(day), updatedAt: fyDay(day),
  });
  return _id;
}

const invLine = ({ id, day, total, name, status = 'Closed', po = '' }) =>
  [isoDay(fyDay(day)), id, `INV-${id}`, status, `"${name}"`, 'INR', (total / 1.18).toFixed(2), total.toFixed(2), '0', po, 'Item'].join(',');
const invCsv = (...lines) => [HEAD, ...lines].join('\n');

describe('Company revenue routes', () => {
  beforeAll(async () => { await dbHandler.connect(); await ZohoInvoice.init(); });
  afterEach(() => dbHandler.clearDatabase());
  afterAll(async () => {
    await dbHandler.closeDatabase();
    cronService?.shutdown?.();
    adaptiveThrottlingService?.shutdown?.();
  });

  describe('admin only, on the server', () => {
    it('401 without a login', async () => {
      await request(app).get(`${BASE}/admin/revenue`).expect(401);
      await request(app).get(`${BASE}/admin/stats`).expect(401);
      await request(app).get(`${BASE}/admin/revenue/zoho-invoices`).expect(401);
    });

    it('403 for a customer', async () => {
      const customer = await makeUser('customer');
      expect((await customer.get('/admin/revenue')).status).toBe(403);
      expect((await customer.get('/admin/stats')).status).toBe(403);
      expect((await customer.upload('/admin/revenue/zoho-import', invCsv(invLine({ id: '1', day: 5, total: 100, name: 'X' })))).status).toBe(403);
    });

    it.each(['accounts', 'sales', 'marketing', 'operations', 'procurement', 'developer'])('403 for %s staff, even a head', async (team) => {
      const staff = await makeUser('staff', { team, isHead: true, active: true });
      expect((await staff.get('/admin/revenue')).status).toBe(403);
      expect((await staff.get('/admin/stats')).status).toBe(403);
      expect((await staff.get('/admin/revenue/zoho-invoices')).status).toBe(403);
      expect((await staff.post('/admin/revenue/zoho-rematch')).status).toBe(403);
      expect((await staff.get('/admin/revenue/sales')).status).toBe(403);
      expect(await ZohoInvoice.countDocuments()).toBe(0);
    });

    it('200 for the admin, never cached by the browser', async () => {
      const adm = await makeUser('admin');
      const res = await adm.get('/admin/revenue');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body.summary).toMatchObject({ basis: 'incl_gst', revenue: { total: 0 }, ordersFulfilled: { total: 0 } });
    });
  });

  describe('every sale counted once', () => {
    let adm;
    beforeEach(async () => { adm = await makeUser('admin'); });

    it('adds Zoho-only sales to panel orders, and not a Zoho invoice that IS a panel order', async () => {
      await order({ day: 10, amount: 10000, name: 'Ravi Kumar' }); // delivered website order
      await order({ day: 12, amount: 5000, name: 'Neha', status: 'shipped', source: 'woocommerce' });
      await order({ day: 14, amount: 7000, name: 'Arjun', status: 'cancelled' }); // never counted
      await order({ day: 15, amount: 3000, name: 'Meera', paymentStatus: 'refunded' }); // never counted

      const up = await adm.upload('/admin/revenue/zoho-import', invCsv(
        invLine({ id: '1', day: 11, total: 10000, name: 'Ravi Kumar' }), // same as the website order
        invLine({ id: '2', day: 20, total: 200000, name: 'Sharma Motors Pvt Ltd' }), // store / B2B
        invLine({ id: '3', day: 21, total: 50000, name: 'Draft Co', status: 'Draft' }), // not a sale
      ));
      expect(up.status).toBe(200);
      expect(up.body.result).toMatchObject({ inserted: 2, skipped: { draft: 1, void: 0 } });

      const { summary } = (await adm.get('/admin/revenue')).body;
      // Zoho is the book of record: both bills count; the website order Zoho billed is not added again.
      expect(summary.revenue.zoho).toMatchObject({ total: 210000, count: 2 });
      expect(summary.revenue.website.total).toBe(5000);
      expect(summary.revenue.website.bySource).toMatchObject({ web: { total: 0 }, woocommerce: { total: 5000 } });
      expect(summary.revenue.total).toBe(215000);
      expect(summary.zohoMatched.linked).toEqual({ count: 1, total: 10000 });
      expect(summary.ordersFulfilled).toEqual({ total: 2, website: 0, zoho: 2 });
      // Sales = every counted order (delivered or on the way) + Zoho-only bills
      expect(summary.sales).toEqual({ total: 3, website: { total: 1, delivered: 0, shipped: 1, processing: 0 }, zoho: 2, zohoCancelled: 0, unbilled: 0 });

      // The list behind the figures: the same three sales, newest first, across both sources.
      const list = (await adm.get('/admin/revenue/sales?limit=2')).body;
      expect(list.sales.map((x) => x.kind)).toEqual(['zoho', 'order']); // the billed website order is not listed twice
      const next = (await adm.get(`/admin/revenue/sales?limit=2&cursor=${list.nextCursor}`)).body;
      expect(next.sales.map((x) => x.amount)).toEqual([10000]);
      expect(next.nextCursor).toBeNull();
      expect((await adm.get('/admin/revenue/sales?source=woocommerce')).body.sales.map((x) => x.amount)).toEqual([5000]);
      expect((await adm.get('/admin/revenue/sales?source=nope')).status).toBe(400);
      expect(summary.months.reduce((a, m) => a + m.total, 0)).toBe(215000);
    });

    it('importing the same file twice changes nothing', async () => {
      const file = invCsv(invLine({ id: '9', day: 30, total: 1180, name: 'Walk In' }));
      await adm.upload('/admin/revenue/zoho-import', file).expect(200);
      const second = await adm.upload('/admin/revenue/zoho-import', file);
      expect(second.body.result).toMatchObject({ inserted: 0, updated: 1 });
      expect(await ZohoInvoice.countDocuments()).toBe(1);
      expect((await adm.get('/admin/revenue')).body.summary.revenue.total).toBe(1180);
    });

    it('a doubtful bill counts once (as the bill) until the admin decides, and that decision survives re-import', async () => {
      const orderId = await order({ day: 40, amount: 10000, name: 'Ravi' });
      const file = invCsv(invLine({ id: '7', day: 42, total: 4000, name: 'Ravi' })); // part billed?
      await adm.upload('/admin/revenue/zoho-import', file).expect(200);

      let s = (await adm.get('/admin/revenue')).body.summary;
      expect(s.revenue.total).toBe(4000); // never 14000 on a guess
      expect(s.zohoMatched.needsCheck).toEqual({ count: 1, total: 4000 });

      const list = (await adm.get('/admin/revenue/zoho-invoices?state=needs_check')).body;
      expect(list.invoices).toHaveLength(1);
      expect(String(list.invoices[0].match.order._id)).toBe(String(orderId));

      await adm.patch(`/admin/revenue/zoho-invoices/${list.invoices[0]._id}`, { decision: 'different' }).expect(200);
      s = (await adm.get('/admin/revenue')).body.summary;
      expect(s.revenue.total).toBe(14000);

      await adm.upload('/admin/revenue/zoho-import', file).expect(200);
      expect((await adm.get('/admin/revenue')).body.summary.revenue.total).toBe(14000);
      const doc = await ZohoInvoice.findOne({ zohoInvoiceId: '7' }).lean();
      expect(doc.match).toMatchObject({ state: 'zoho_only', by: 'admin' });
      expect(doc.history.some((h) => h.action === 'matched' && h.byName)).toBe(true);
    });

    it('refuses to confirm an invoice as an order that is not a counted sale', async () => {
      const cancelled = await order({ day: 50, amount: 999, name: 'Z', status: 'cancelled' });
      await adm.upload('/admin/revenue/zoho-import', invCsv(invLine({ id: '8', day: 50, total: 999, name: 'Q' }))).expect(200);
      const inv = await ZohoInvoice.findOne({ zohoInvoiceId: '8' }).lean();
      const res = await adm.patch(`/admin/revenue/zoho-invoices/${inv._id}`, { decision: 'same', orderId: String(cancelled) });
      expect(res.status).toBe(400);
    });

    it('Zoho credit notes reduce the bill they name; a fully credited bill is no sale and no order', async () => {
      await adm.upload('/admin/revenue/zoho-import', invCsv(
        invLine({ id: '21', day: 60, total: 100000, name: 'Fleet Co' }),
        invLine({ id: '22', day: 61, total: 30000, name: 'Garage One' }),
      )).expect(200);
      const CN = 'Credit Note Date,CreditNotes ID,Credit Note Number,Credit Note Status,Currency Code,SubTotal,Total,Associated Invoice Number';
      const notes = [CN, `${isoDay(fyDay(65))},c1,CN-1,Closed,INR,8474.58,10000,INV-21`, `${isoDay(fyDay(66))},c2,CN-2,Closed,INR,25423.73,30000,INV-22`,
        `${isoDay(fyDay(66))},c3,CN-3,Void,INR,1,1,INV-21`].join('\n');
      const up = await adm.upload('/admin/revenue/zoho-import', notes);
      expect(up.body.result).toMatchObject({ kind: 'credit_notes', inserted: 2, skipped: { void: 1 } });
      await adm.upload('/admin/revenue/zoho-import', notes).expect(200); // again: no double refund

      const { summary } = (await adm.get('/admin/revenue')).body;
      expect(summary.revenue.zoho).toMatchObject({ total: 90000, creditNotes: 40000, count: 1 });
      expect(summary.sales).toMatchObject({ zoho: 1, zohoCancelled: 1 });
      const zohoRows = (await adm.get('/admin/revenue/sales?source=zoho')).body.sales;
      expect(zohoRows.map((x) => x.status).sort()).toEqual(['cancelled_by_credit_note', 'closed']);
    });

    it('rejects a file that is not a Zoho invoice export with a 400', async () => {
      const res = await adm.upload('/admin/revenue/zoho-import', 'Date,Amount\n2026-01-01,5');
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Zoho/);
    });

    it('puts the full figure and orders fulfilled in the header stats', async () => {
      await order({ day: 10, amount: 10000, name: 'Ravi' });
      await adm.upload('/admin/revenue/zoho-import', invCsv(invLine({ id: '5', day: 20, total: 50000, name: 'Store Sale' }))).expect(200);
      const { stats } = (await adm.get('/admin/stats')).body;
      expect(stats.companyRevenue).toMatchObject({ total: 60000, zoho: 50000, panelNotInZoho: 10000, basis: 'incl_gst' });
      expect(stats.sales).toMatchObject({ total: 2, zoho: 1, website: { total: 1, delivered: 1 }, fyLabel: expect.any(String) });
    });
  });
});
