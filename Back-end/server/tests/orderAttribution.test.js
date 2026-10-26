/**
 * Crediting a website order to the salesman who closed it (routes/staff.js
 * /attribution/*, services/orderAttributionService.js), over HTTP with real auth,
 * CSRF and Mongo.
 *
 * What must hold:
 *   - only admin and marketing can list or credit; everyone else gets 403
 *   - only PAID WEBSITE orders: never an unpaid one, a staff-made one, or a WooCommerce import
 *   - only a GTM head or GTM lead can be credited (not an executive, not another team, not inactive)
 *   - it changes the seller and nothing else: totals, status and payment are untouched
 *   - compare-and-set on the seller the person saw: a stale screen or a race → 409, one winner
 *   - every change is kept on the order, newest first; un-crediting is allowed
 *   - once credited, the order is in that salesman's "my orders"
 *   - the list shows only what identifies the order — no phone, email or street
 *   - the list is cursor-paginated and bounded
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
const { default: orderStatusService } = await import('../services/orderStatusService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';

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
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email), id: String(user._id) };
};
const staff = (team, extra = {}) => ({ team, isHead: false, active: true, ...extra });

const ADDRESS = { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' };

async function websiteOrder({ paid = true, source = 'web', salesUser = null, createdAt, user } = {}) {
  const order = await Order.create({
    user: user || new mongoose.Types.ObjectId(), source, salesUser,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Roof rack', price: 18000, quantity: 2 }],
    shippingAddress: ADDRESS, guestEmail: 'ravi@example.com',
    subtotal: 36000, totalAmount: 36000, status: 'awaiting_payment', paymentStatus: 'pending',
    ...(createdAt && { createdAt }),
  });
  if (paid) {
    const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
    if (!res?.success) throw new Error(res?.message);
  }
  return Order.findById(order._id).lean();
}

describe('Crediting a website order to a salesman', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, marketing, head, lead, lead2;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    marketing = await makeUser('Mira', 'staff', staff('marketing'));
    head = await makeUser('Hari', 'staff', staff('sales', { isHead: true }));
    lead = await makeUser('Sam', 'staff', staff('sales'));
    lead2 = await makeUser('Tara', 'staff', staff('sales', { subRole: 'lead' }));
  });

  const credit = (s, orderId, salesUserId, expectedSalesUserId = null, note) =>
    s.put(`/staff/attribution/orders/${orderId}`, { salesUserId, expectedSalesUserId, ...(note && { note }) });

  describe('who', () => {
    it('admin and marketing only — the GTM head, other teams and leads get 403', async () => {
      const order = await websiteOrder();
      const others = [
        head, lead,
        await makeUser('Anu', 'staff', staff('accounts')),
        await makeUser('Priya', 'staff', staff('procurement')),
        await makeUser('Omar', 'staff', staff('operations')),
        await makeUser('Dev', 'staff', staff('developer')),
      ];
      for (const u of others) {
        expect((await u.session.get('/staff/attribution/orders')).status).toBe(403);
        expect((await u.session.get('/staff/attribution/sellers')).status).toBe(403);
        expect((await credit(u.session, order._id, u.id)).status).toBe(403);
      }
      expect((await Order.findById(order._id).lean()).salesUser).toBeNull();
      expect((await admin.session.get('/staff/attribution/orders')).status).toBe(200);
      expect((await marketing.session.get('/staff/attribution/orders')).status).toBe(200);
    });

    it('marketing loses access the moment they are deactivated', async () => {
      await User.updateOne({ _id: marketing.user._id }, { $set: { 'staff.active': false } });
      expect([401, 403]).toContain((await marketing.session.get('/staff/attribution/orders')).status);
    });

    it('offers only active GTM heads and leads as sellers', async () => {
      await makeUser('Exec', 'staff', staff('sales', { subRole: 'executive' }));
      await makeUser('Support', 'staff', staff('sales', { subRole: 'support' }));
      await makeUser('Gone', 'staff', staff('sales', { active: false }));
      const res = await marketing.session.get('/staff/attribution/sellers');
      expect(res.body.sellers.map((s) => s.name).sort()).toEqual(['Hari', 'Sam', 'Tara']);
      expect(res.body.sellers.find((s) => s.name === 'Hari').isHead).toBe(true);
    });
  });

  describe('which orders', () => {
    it('lists paid website orders only, with just enough to recognise them', async () => {
      const paid = await websiteOrder();
      await websiteOrder({ paid: false });
      await websiteOrder({ source: 'offline', salesUser: lead.user._id });
      await websiteOrder({ source: 'woocommerce' });
      const res = await marketing.session.get('/staff/attribution/orders');
      expect(res.body.orders.map((o) => o.id)).toEqual([String(paid._id)]);
      const row = res.body.orders[0];
      expect(row).toMatchObject({ customer: 'Ravi Kumar', city: 'Kochi, Kerala', totalAmount: 36000, items: ['Roof rack × 2'], seller: null, history: [] });
      // No contact details or street address for marketing.
      expect(JSON.stringify(row)).not.toMatch(/9812345678|ravi@example\.com|1 Road/);
    });

    it('refuses an unpaid order (its payment links are tied to the salesman) and an unknown one', async () => {
      const unpaid = await websiteOrder({ paid: false });
      expect((await credit(marketing.session, unpaid._id, lead.id)).status).toBe(409);
      expect((await credit(marketing.session, new mongoose.Types.ObjectId(), lead.id)).status).toBe(404);
      expect((await Order.findById(unpaid._id).lean()).salesUser).toBeNull();
    });

    it("a paid salesman's order can move to another salesman, or back to Website order", async () => {
      const offline = await websiteOrder({ source: 'offline', salesUser: lead.user._id });
      expect((await credit(marketing.session, offline._id, lead2.id, lead.id)).status).toBe(200);
      expect(String((await Order.findById(offline._id).lean()).salesUser)).toBe(lead2.id);
      // The seller the person saw must still be the seller: a stale screen is refused.
      expect((await credit(marketing.session, offline._id, null, lead.id)).status).toBe(409);
      expect((await credit(marketing.session, offline._id, null, lead2.id)).status).toBe(200);
      const back = await Order.findById(offline._id).lean();
      expect(back.salesUser).toBeNull();
      expect(back.salesAttribution.map((h) => h.toName)).toEqual(['Tara', '']);
    });

    it('the admin orders list says who sold each order (empty = Website order)', async () => {
      const web = await websiteOrder();
      const sold = await websiteOrder({ source: 'offline', salesUser: lead.user._id });
      const res = await admin.session.get('/orders/admin/all?limit=50');
      expect(res.status).toBe(200);
      const byId = new Map(res.body.orders.map((o) => [String(o._id), o]));
      expect(byId.get(String(sold._id)).salesUser).toMatchObject({ name: 'Sam' });
      expect(byId.get(String(sold._id)).source).toBe('offline');
      expect(byId.get(String(web._id)).salesUser).toBeFalsy();
    });

    it('pages with a cursor, 25 at a time, newest first, no repeats', async () => {
      const t0 = Date.now() - 60 * 60 * 1000;
      for (let i = 0; i < 26; i += 1) await websiteOrder({ createdAt: new Date(t0 + i * 1000) });
      const p1 = await marketing.session.get('/staff/attribution/orders');
      expect(p1.body.orders).toHaveLength(25);
      expect(p1.body.nextCursor).toBeTruthy();
      const p2 = await marketing.session.get(`/staff/attribution/orders?cursor=${p1.body.nextCursor}`);
      expect(p2.body.orders).toHaveLength(1);
      expect(p2.body.nextCursor).toBeNull();
      const all = [...p1.body.orders, ...p2.body.orders];
      expect(new Set(all.map((o) => o.id)).size).toBe(26);
      const times = all.map((o) => new Date(o.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });
  });

  describe('crediting', () => {
    it('sets the seller and nothing else, keeps the history, and puts it in their "my orders"', async () => {
      const order = await websiteOrder();
      const before = await Order.findById(order._id).lean();

      const res = await credit(marketing.session, order._id, lead.id, null, 'Closed on a call yesterday');
      expect(res.status).toBe(200);
      expect(res.body.order).toMatchObject({ seller: { id: lead.id, name: 'Sam' } });
      expect(res.body.order.history).toEqual([expect.objectContaining({ by: 'Mira', from: null, to: 'Sam', note: 'Closed on a call yesterday' })]);

      const after = await Order.findById(order._id).lean();
      expect(String(after.salesUser)).toBe(lead.id);
      for (const k of ['totalAmount', 'subtotal', 'status', 'paymentStatus', 'source']) expect(after[k]).toEqual(before[k]);
      expect(after.items).toEqual(before.items);
      expect(after.statusHistory).toEqual(before.statusHistory);

      const mine = await lead.session.get('/staff/sales/orders');
      expect(mine.status).toBe(200);
      expect(mine.body.orders.map((o) => o.id)).toContain(String(order._id));
    });

    it('reads one order for the order page — null when it is not a paid website order', async () => {
      const order = await websiteOrder();
      const unpaid = await websiteOrder({ paid: false });
      const offline = await websiteOrder({ source: 'offline', salesUser: lead.user._id });
      expect((await admin.session.get(`/staff/attribution/orders/${order._id}`)).body.order).toMatchObject({ id: String(order._id), seller: null });
      expect((await admin.session.get(`/staff/attribution/orders/${unpaid._id}`)).body.order).toBeNull();
      expect((await admin.session.get(`/staff/attribution/orders/${offline._id}`)).body.order).toBeNull();
      expect((await lead.session.get(`/staff/attribution/orders/${order._id}`)).status).toBe(403);
    });

    it('can move the credit to another salesman, or remove it — newest change first', async () => {
      const order = await websiteOrder();
      await credit(marketing.session, order._id, lead.id);
      const moved = await credit(admin.session, order._id, lead2.id, lead.id);
      expect(moved.status).toBe(200);
      const removed = await credit(admin.session, order._id, null, lead2.id);
      expect(removed.status).toBe(200);
      expect(removed.body.order.seller).toBeNull();
      expect(removed.body.order.history.map((h) => [h.from, h.to])).toEqual([['Tara', null], ['Sam', 'Tara'], [null, 'Sam']]);
      expect((await Order.findById(order._id).lean()).salesUser).toBeNull();
    });

    it('a stale screen cannot overwrite a change it did not see', async () => {
      const order = await websiteOrder();
      await credit(admin.session, order._id, lead.id); // marketing's screen still says "no one"
      const stale = await credit(marketing.session, order._id, lead2.id, null);
      expect(stale.status).toBe(409);
      expect(String((await Order.findById(order._id).lean()).salesUser)).toBe(lead.id);
    });

    it('two people at once: exactly one wins', async () => {
      const order = await websiteOrder();
      const [a, b] = await Promise.all([
        credit(admin.session, order._id, lead.id),
        credit(marketing.session, order._id, lead2.id),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const saved = await Order.findById(order._id).lean();
      expect(saved.salesAttribution).toHaveLength(1);
      expect(String(saved.salesUser)).toBe(String(saved.salesAttribution[0].to));
    });

    it('only a GTM head or lead can be credited', async () => {
      const order = await websiteOrder();
      const exec = await makeUser('Exec', 'staff', staff('sales', { subRole: 'executive' }));
      const gone = await makeUser('Gone', 'staff', staff('sales', { active: false }));
      for (const u of [exec, gone, marketing, admin]) {
        expect((await credit(admin.session, order._id, u.id)).status).toBe(400);
      }
      expect((await credit(admin.session, order._id, head.id)).status).toBe(200);
    });

    it('the customer never sees who sold or credited it, or the team workflow (regression)', async () => {
      const customer = await makeUser('Ravi', 'customer');
      const order = await websiteOrder({ user: customer.user._id });
      expect((await credit(marketing.session, order._id, lead.id, null, 'internal note')).status).toBe(200);

      const own = await customer.session.get(`/orders/${order._id}`);
      expect(own.status).toBe(200);
      expect(own.body.order).toMatchObject({ _id: String(order._id), totalAmount: 36000 });
      for (const k of ['workflow', 'salesAttribution', 'salesUser', 'salesRep', 'crmLeadId']) expect(own.body.order).not.toHaveProperty(k);
      expect(JSON.stringify(own.body)).not.toMatch(/internal note|Mira/);

      const staffView = await marketing.session.get(`/orders/${order._id}`);
      expect(staffView.body.order.salesAttribution).toHaveLength(1);
      expect(staffView.body.order.workflow).toBeTruthy();
    });

    it('checks its input', async () => {
      const order = await websiteOrder();
      const put = (body) => marketing.session.put(`/staff/attribution/orders/${order._id}`, body);
      expect((await put({ salesUserId: lead.id })).status).toBe(400); // what they saw is required
      expect((await put({ expectedSalesUserId: null })).status).toBe(400);
      expect((await put({ salesUserId: 'aaaaaaaaaaaa', expectedSalesUserId: null })).status).toBe(400);
      expect((await put({ salesUserId: lead.id, expectedSalesUserId: null, note: 'x'.repeat(301) })).status).toBe(400);
      expect((await put({ salesUserId: null, expectedSalesUserId: null })).status).toBe(400); // no change
      expect((await marketing.session.put('/staff/attribution/orders/not-an-id', { salesUserId: lead.id, expectedSalesUserId: null })).status).toBe(400);
      expect((await Order.findById(order._id).lean()).salesAttribution).toBeUndefined();
    });
  });
});
