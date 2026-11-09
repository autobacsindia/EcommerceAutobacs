/**
 * Proof is required for every change to who is credited with an order
 * (PUT /staff/attribution/orders/:id), over HTTP with real auth, CSRF and Mongo.
 * Only file storage is faked.
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
let storageDown = false;
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    if (storageDown) throw new Error('storage down');
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
const { MAX_CHANGES } = await import('../services/orderAttributionService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const NOTE = 'Closed by this salesman on a call';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const PDF = Buffer.from('%PDF-1.4 fake pdf body');
const office = (folder) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml ${folder}document.xml`)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(40, 0)]);

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

/** A form submission, exactly as the popup sends it. */
function submit(s, orderId, { to = null, seen = null, note, changeId = nextChange(), files = [] } = {}) {
  let r = s.agent.put(`${BASE}/staff/attribution/orders/${orderId}`).set('X-XSRF-TOKEN', s.csrf)
    .field('salesUserId', to || '').field('expectedSalesUserId', seen || '').field('changeId', changeId);
  if (note) r = r.field('note', note);
  for (const [name, buffer] of files) r = r.attach('proof', buffer, name);
  return r;
}

async function paidOrder(extra = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(), source: 'web', salesUser: null,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Roof rack', price: 18000, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    guestEmail: 'ravi@example.com', subtotal: 18000, totalAmount: 18000, status: 'processing', paymentStatus: 'paid', ...extra,
  });
  return Order.findById(order._id).lean();
}
const reload = (o) => Order.findById(o._id).lean();

describe('Proof for changing who is credited with an order', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); stored.clear(); storageDown = false; });

  let admin; let marketing; let lead; let lead2;
  beforeEach(async () => {
    admin = await makeUser('Asha', 'admin');
    marketing = await makeUser('Mira', 'staff', staffOf('marketing'));
    lead = await makeUser('Sam', 'staff', staffOf('sales', { subRole: 'lead' }));
    lead2 = await makeUser('Tara', 'staff', staffOf('sales', { subRole: 'lead' }));
  });

  describe('no proof, no change', () => {
    const refused = async (res, order) => {
      expect(res.status).toBe(400);
      const after = await reload(order);
      expect(after.salesUser).toBeNull();
      expect(after.salesAttribution || []).toHaveLength(0);
      expect(stored.size).toBe(0);
    };

    it('a form with neither note nor file', async () => {
      const order = await paidOrder();
      const res = await submit(admin, order._id, { to: lead.id });
      await refused(res, order);
      expect(res.body.message).toMatch(/Add proof/);
    });

    it('a direct JSON call without proof, as the old screen sent it', async () => {
      const order = await paidOrder();
      await refused(await admin.agent.put(`${BASE}/staff/attribution/orders/${order._id}`).set('X-XSRF-TOKEN', admin.csrf)
        .send({ salesUserId: lead.id, expectedSalesUserId: null, changeId: nextChange() }), order);
    });

    it('a call with proof but no changeId', async () => {
      const order = await paidOrder();
      await refused(await admin.agent.put(`${BASE}/staff/attribution/orders/${order._id}`).set('X-XSRF-TOKEN', admin.csrf)
        .send({ salesUserId: lead.id, expectedSalesUserId: null, note: NOTE }), order);
    });

    it.each([['too short', 'ok'], ['padding only', `a${' '.repeat(40)}b`]])('a note that is %s', async (_, note) => {
      const order = await paidOrder();
      await refused(await submit(admin, order._id, { to: lead.id, note }), order);
    });

    it('removing the credit needs proof too', async () => {
      const order = await paidOrder({ salesUser: lead.user._id });
      const res = await submit(admin, order._id, { seen: lead.id });
      expect(res.status).toBe(400);
      expect(String((await reload(order)).salesUser)).toBe(lead.id);
    });

    it('someone who may not change credit stores nothing, even with proof', async () => {
      const order = await paidOrder();
      const res = await submit(lead, order._id, { to: lead.id, files: [['a.png', PNG]] });
      expect(res.status).toBe(403);
      expect(stored.size).toBe(0);
    });

    it('choosing the same person is not a change', async () => {
      const order = await paidOrder({ salesUser: lead.user._id });
      expect((await submit(admin, order._id, { to: lead.id, seen: lead.id, note: NOTE })).status).toBe(400);
      expect((await reload(order)).salesAttribution || []).toHaveLength(0);
    });
  });

  describe('accepted proof', () => {
    it('a written note alone', async () => {
      const order = await paidOrder();
      const res = await submit(marketing, order._id, { to: lead.id, note: NOTE });
      expect(res.status).toBe(200);
      expect(res.body.order.history[0]).toMatchObject({ by: 'Mira', from: null, to: 'Sam', note: NOTE, proofRequired: true, files: [] });
    });

    it('several files of every allowed type, recorded without exposing where they are stored', async () => {
      const order = await paidOrder({ salesUser: lead.user._id });
      const res = await submit(admin, order._id, {
        to: lead2.id, seen: lead.id,
        files: [['a.png', PNG], ['b.pdf', PDF], ['c.docx', office('word/')], ['d.xlsx', office('xl/')], ['e.txt', Buffer.from('hello')], ['f.csv', Buffer.from('a,b')]],
      });
      expect(res.status).toBe(200);
      const [h] = res.body.order.history;
      expect(h.files.map((f) => f.name)).toEqual(['a.png', 'b.pdf', 'c.docx', 'd.xlsx', 'e.txt', 'f.csv']);
      expect(JSON.stringify(res.body)).not.toMatch(/publicId|order-credit-proof/);
      expect([...stored.keys()].every((k) => k.startsWith('order-credit-proof/'))).toBe(true);
      expect(stored.size).toBe(6);
      const after = await reload(order);
      expect(String(after.salesUser)).toBe(lead2.id);
      expect(after.totalAmount).toBe(18000);
      expect(after.paymentStatus).toBe('paid');
      expect(after.status).toBe('processing');
    });

    it('moving back to Website order with a file', async () => {
      const order = await paidOrder({ salesUser: lead.user._id });
      const res = await submit(admin, order._id, { seen: lead.id, files: [['a.png', PNG]] });
      expect(res.status).toBe(200);
      expect((await reload(order)).salesUser).toBeNull();
    });
  });

  describe('file checks', () => {
    it.each([
      ['a program renamed .pdf', 'x.pdf', EXE],
      ['a program renamed .png', 'x.png', EXE],
      ['a plain zip renamed .docx', 'x.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30, 65)])],
      ['a program renamed .txt', 'x.txt', EXE],
      ['a type not on the list', 'x.exe', EXE],
    ])('refuses %s, and stores nothing', async (_, name, buffer) => {
      const order = await paidOrder();
      const res = await submit(admin, order._id, { to: lead.id, note: NOTE, files: [['ok.png', PNG], [name, buffer]] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/is not a photo/);
      expect(stored.size).toBe(0);
      expect((await reload(order)).salesUser).toBeNull();
    });

    it('refuses more than 20 files', async () => {
      const order = await paidOrder();
      const res = await submit(admin, order._id, { to: lead.id, files: Array.from({ length: 21 }, (_, i) => [`${i}.png`, PNG]) });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/up to 20/);
    });

    it('refuses a file over 10 MB', async () => {
      const order = await paidOrder();
      const res = await submit(admin, order._id, { to: lead.id, files: [['big.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 97)]] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too large/);
    });

    it('if storage fails nothing changes and it can be tried again', async () => {
      const order = await paidOrder();
      storageDown = true;
      const changeId = nextChange();
      const res = await submit(admin, order._id, { to: lead.id, changeId, files: [['a.png', PNG]] });
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect((await reload(order)).salesUser).toBeNull();
      storageDown = false;
      expect((await submit(admin, order._id, { to: lead.id, changeId, files: [['a.png', PNG]] })).status).toBe(200);
      expect((await reload(order)).salesAttribution).toHaveLength(1);
    });
  });

  describe('retries and clashes', () => {
    it('a retry of the same submission gives the same answer and one record', async () => {
      const order = await paidOrder();
      const opts = { to: lead.id, changeId: nextChange(), files: [['a.png', PNG]] };
      const first = await submit(admin, order._id, opts);
      const again = await submit(admin, order._id, opts);
      expect(first.status).toBe(200);
      expect(again.status).toBe(200);
      expect(again.body.order).toEqual(first.body.order);
      expect((await reload(order)).salesAttribution).toHaveLength(1);
      expect(stored.size).toBe(1);
    });

    it('a double-click (both at once) gives one record and no stray files', async () => {
      const order = await paidOrder();
      const opts = { to: lead.id, changeId: nextChange(), files: [['a.png', PNG]] };
      const results = await Promise.all([submit(admin, order._id, opts), submit(admin, order._id, opts)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect((await reload(order)).salesAttribution).toHaveLength(1);
      expect(stored.size).toBe(1);
    });

    it('two staff at once: one wins, the other is told, and their file is removed', async () => {
      const order = await paidOrder();
      const results = await Promise.all([
        submit(admin, order._id, { to: lead.id, files: [['a.png', PNG]] }),
        submit(marketing, order._id, { to: lead2.id, files: [['b.png', PNG]] }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409).body.message).toMatch(/Someone else/);
      expect((await reload(order)).salesAttribution).toHaveLength(1);
      expect(stored.size).toBe(1);
    });

    it('an out-of-date screen gets a conflict', async () => {
      const order = await paidOrder({ salesUser: lead.user._id });
      const res = await submit(admin, order._id, { to: lead2.id, seen: null, files: [['a.png', PNG]] });
      expect(res.status).toBe(409);
      expect(stored.size).toBe(0);
    });

    it('an unpaid order still cannot change', async () => {
      const order = await paidOrder({ paymentStatus: 'pending', status: 'awaiting_payment' });
      expect((await submit(admin, order._id, { to: lead.id, note: NOTE })).status).toBe(409);
    });
  });

  describe('the permanent record', () => {
    const old = (i) => ({ at: new Date(2026, 0, 1 + i), byName: 'Old', fromName: '', toName: 'Sam', note: `old ${i}` });

    it('older changes are never trimmed, and show as made before proof was required', async () => {
      const order = await paidOrder({ salesAttribution: Array.from({ length: 60 }, (_, i) => old(i)) });
      const res = await submit(admin, order._id, { to: lead.id, note: NOTE });
      expect(res.status).toBe(200);
      expect(res.body.order.history).toHaveLength(61);
      expect(res.body.order.history[0].proofRequired).toBe(true);
      expect(res.body.order.history[60]).toMatchObject({ note: 'old 0', proofRequired: false, files: [] });
    });

    it("a salesman's order shows its record on the order page once it has been moved", async () => {
      const order = await paidOrder({ source: 'offline', salesUser: lead.user._id });
      const url = `${BASE}/staff/attribution/orders/${order._id}`;
      expect((await admin.agent.get(url)).body.order).toBeNull();
      await submit(admin, order._id, { to: lead2.id, seen: lead.id, note: NOTE });
      expect((await admin.agent.get(url)).body.order.history).toHaveLength(1);
    });

    it('at the ceiling the change is refused rather than deleting history', async () => {
      const order = await paidOrder({ salesAttribution: Array.from({ length: MAX_CHANGES }, (_, i) => old(i)) });
      expect((await submit(admin, order._id, { to: lead.id, note: NOTE })).status).toBe(409);
      expect((await reload(order)).salesAttribution).toHaveLength(MAX_CHANGES);
    });

    it('proof files open for admin and marketing only; documents download, never open in the page', async () => {
      const order = await paidOrder();
      const res = await submit(admin, order._id, { to: lead.id, files: [['a.png', PNG], ['n.txt', Buffer.from('<script>x</script>')]] });
      const [png, txt] = res.body.order.history[0].files;
      const url = (f) => `${BASE}/staff/attribution/orders/${order._id}/proof/${f.id}`;

      const img = await marketing.agent.get(url(png));
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toMatch(/image\/png/);
      expect(img.headers['content-disposition']).toMatch(/^inline/);
      expect(img.headers['cache-control']).toMatch(/no-store/);

      const doc = await admin.agent.get(url(txt));
      expect(doc.headers['content-disposition']).toMatch(/^attachment/);
      expect(doc.headers['x-content-type-options']).toBe('nosniff');

      expect((await lead.agent.get(url(png))).status).toBe(403);
      expect((await request(app).get(url(png))).status).toBe(401);
      expect((await admin.agent.get(`${BASE}/staff/attribution/orders/${order._id}/proof/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    });
  });
});
