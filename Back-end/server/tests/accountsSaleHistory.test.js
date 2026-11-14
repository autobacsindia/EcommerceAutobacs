/**
 * Accounts can READ an order's "Sale history" — when a website order was credited
 * to a salesman, by whom, with what proof — on the order panel they already use
 * (GET /staff/work/orders/:id → `saleHistory`), and open its proof files
 * (GET /staff/attribution/orders/:id/proof/:fileId). Over HTTP with real auth,
 * CSRF and Mongo; only file storage is faked.
 *
 * What must hold:
 *   - accounts (and admin) get the history: how the order started, then each change, oldest first
 *   - display-safe only: names, dates, note, file names — never the storage location
 *   - an order whose seller never changed gets `saleHistory: null` (nothing extra on screen)
 *   - legacy entries without a changeId still show, marked as before proof was required
 *   - other teams on the same panel get `saleHistory: null`
 *   - proof files open for accounts; sales, procurement and inactive accounts are refused
 *   - accounts can READ only: changing the seller, or listing orders to credit, is still 403
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

const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, url: '' };
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
const { default: orderStatusService } = await import('../services/orderStatusService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const NOTE = 'Customer confirmed on WhatsApp that Sam closed it';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

let n = 0;
const nextChange = () => { n += 1; return `change-${n}-abcdef`; };
const csrfFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='))?.split(';')[0].split('=')[1] || '';
async function makeUser(name, role, staff) {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  const agent = request.agent(app);
  const login = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(login.status).toBe(200);
  return { user, id: String(user._id), agent, csrf: csrfFrom(login) };
}
const staffOf = (team, extra = {}) => ({ team, isHead: false, active: true, ...extra });

function submit(s, orderId, { to = null, seen = null, note = NOTE, files = [] } = {}) {
  let r = s.agent.put(`${BASE}/staff/attribution/orders/${orderId}`).set('X-XSRF-TOKEN', s.csrf)
    .field('salesUserId', to || '').field('expectedSalesUserId', seen || '').field('changeId', nextChange());
  if (note) r = r.field('note', note);
  for (const [name, buffer] of files) r = r.attach('proof', buffer, name);
  return r;
}

/** A paid order that has entered the team workflow, as a real payment leaves it. */
async function paidOrder({ source = 'web', salesUser = null, salesAttribution } = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(), source, salesUser,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Roof rack', price: 18000, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    guestEmail: 'ravi@example.com', subtotal: 18000, totalAmount: 18000, status: 'awaiting_payment', paymentStatus: 'pending',
    ...(salesAttribution && { salesAttribution }),
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}
const panel = (s, orderId) => s.agent.get(`${BASE}/staff/work/orders/${orderId}`);
const proofUrl = (orderId, fileId) => `${BASE}/staff/attribution/orders/${orderId}/proof/${fileId}`;

describe('Accounts: read-only Sale history on an order', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); stored.clear(); });

  let admin; let marketing; let accounts; let procurement; let lead; let lead2;
  beforeEach(async () => {
    admin = await makeUser('Asha', 'admin');
    marketing = await makeUser('Arjun', 'staff', staffOf('marketing'));
    accounts = await makeUser('Anu', 'staff', staffOf('accounts'));
    procurement = await makeUser('Priya', 'staff', staffOf('procurement'));
    lead = await makeUser('Sam', 'staff', staffOf('sales', { subRole: 'lead' }));
    lead2 = await makeUser('Nevin', 'staff', staffOf('sales', { subRole: 'lead' }));
  });

  it('accounts sees how a website order started, then each change oldest first, with display-safe fields only', async () => {
    const order = await paidOrder();
    expect((await submit(marketing, order._id, { to: lead.id, files: [['chat.png', PNG]] })).status).toBe(200);
    expect((await submit(admin, order._id, { to: lead2.id, seen: lead.id, note: 'Moved: Nevin did the follow-up visit' })).status).toBe(200);

    const res = await panel(accounts, order._id);
    expect(res.status).toBe(200);
    const h = res.body.order.saleHistory;
    expect(h.startedAs).toBe('Website order');
    expect(h.changes.map((c) => [c.by, c.from, c.to])).toEqual([['Arjun', null, 'Sam'], ['Asha', 'Sam', 'Nevin']]);
    expect(h.changes[0]).toMatchObject({ note: NOTE, proofRequired: true, files: [expect.objectContaining({ name: 'chat.png', contentType: 'image/png' })] });
    expect(typeof h.changes[0].at).toBe('string');
    // Never the storage location, nor the people's ids.
    const raw = JSON.stringify(h);
    expect(raw).not.toMatch(/publicId|order-credit-proof|provider|"url"/);
    expect(raw).not.toContain(lead.id);
    expect(res.body.order.soldBy).toBe('Nevin');
  });

  it('accounts can open the proof file; sales, procurement and inactive accounts cannot', async () => {
    const order = await paidOrder();
    const credited = await submit(marketing, order._id, { to: lead.id, files: [['chat.png', PNG]] });
    const fileId = credited.body.order.history[0].files[0].id;

    const ok = await accounts.agent.get(proofUrl(order._id, fileId));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/image\/png/);
    expect(ok.headers['cache-control']).toMatch(/no-store/);

    expect((await lead.agent.get(proofUrl(order._id, fileId))).status).toBe(403);
    expect((await procurement.agent.get(proofUrl(order._id, fileId))).status).toBe(403);
    expect((await accounts.agent.get(proofUrl(order._id, new mongoose.Types.ObjectId()))).status).toBe(404);

    await User.updateOne({ _id: accounts.user._id }, { $set: { 'staff.active': false } });
    expect([401, 403]).toContain((await accounts.agent.get(proofUrl(order._id, fileId))).status);
  });

  it('accounts can read only — changing the seller or listing orders to credit is refused, and nothing changes', async () => {
    const order = await paidOrder();
    const res = await submit(accounts, order._id, { to: lead.id, files: [['chat.png', PNG]] });
    expect(res.status).toBe(403);
    const after = await Order.findById(order._id).lean();
    expect(after.salesUser).toBeNull();
    expect(after.salesAttribution || []).toHaveLength(0);
    expect(stored.size).toBe(0);
    expect((await accounts.agent.get(`${BASE}/staff/attribution/orders`)).status).toBe(403);
    expect((await accounts.agent.get(`${BASE}/staff/attribution/sellers`)).status).toBe(403);
  });

  it('an order whose seller never changed has no history', async () => {
    const web = await paidOrder();
    const sold = await paidOrder({ source: 'offline', salesUser: lead.user._id });
    for (const o of [web, sold]) {
      const res = await panel(accounts, o._id);
      expect(res.status).toBe(200);
      expect(res.body.order.saleHistory).toBeNull();
    }
  });

  it('shows legacy changes written before proof was required, and a salesman\'s order that was moved', async () => {
    const legacy = await paidOrder({
      source: 'offline',
      salesUser: lead2.user._id,
      salesAttribution: [{ at: new Date('2026-09-01T10:00:00Z'), byName: 'Old admin', fromName: 'Sam', toName: 'Nevin', note: '' }],
    });
    const h = (await panel(accounts, legacy._id)).body.order.saleHistory;
    expect(h.startedAs).toBe('Sales order — Sam');
    expect(h.changes).toEqual([expect.objectContaining({ by: 'Old admin', from: 'Sam', to: 'Nevin', note: '', proofRequired: false, files: [] })]);
  });

  it('other teams on the same panel do not get it; admin does', async () => {
    const order = await paidOrder();
    await submit(marketing, order._id, { to: lead.id });
    const p = await panel(procurement, order._id);
    expect(p.status).toBe(200);
    expect(p.body.order.saleHistory).toBeNull();
    expect((await panel(admin, order._id)).body.order.saleHistory.changes).toHaveLength(1);
  });
});
