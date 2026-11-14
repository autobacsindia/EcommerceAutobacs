/**
 * Supplier price enquiries (routes/supplierEnquiries.js, services/supplierEnquiryService.js)
 * and suppliers saved without payment details (services/supplierService.js).
 *
 * What must hold:
 *   - procurement and the admin only; accounts, other teams and signed-out get nothing
 *   - money is whole paise, rounded once from what was typed (no float drift)
 *   - a double-click / retried create saves ONE enquiry
 *   - "sent" is stamped once; a reply implies sent and moves the status to replied
 *   - the best quote is the lowest price incl. GST among suppliers that have it
 *   - an edit is compare-and-set: a stale editor is refused, never overwrites
 *   - a closed enquiry takes no quotes until reopened
 *   - the list is keyset-paged: no row repeated or skipped
 *   - a supplier saved with no payment details cannot be paid until details are added,
 *     and adding them the first time is not a "bank details changed" warning
 */

import bcrypt from 'bcryptjs';
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
const { default: Supplier } = await import('../models/Supplier.js');
const { default: SupplierEnquiry } = await import('../models/SupplierEnquiry.js');
const { default: Product } = await import('../models/Product.js');
const svc = await import('../services/supplierEnquiryService.js');
const suppliers = await import('../services/supplierService.js');

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
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
    photos: (url, files) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const f of files) r = r.attach('photo', f.buffer, { filename: f.name, contentType: f.type });
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
const staff = (team) => ({ team, isHead: false, active: true });

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const photo = (name = 'part.jpg') => ({ buffer: JPEG, name, type: 'image/jpeg' });

const ITEMS = [
  { name: '3M Car Wax Polish 500 ml', brand: '3M', partNo: '39030', fitment: '', qty: 10, unit: 'pcs', target: '450' },
  { name: 'Rear parking sensor kit', qty: 4, unit: 'sets', note: 'black finish preferred' },
];

describe('Supplier enquiries', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, accounts, procurement, ops, ravi, tyre;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    ops = await makeUser('Omar', 'staff', staff('operations'));
    // Saved the enquiry way: name + WhatsApp number, payment details later.
    const a = await procurement.session.post('/suppliers', { name: 'Ravi Motors', phone: '98000 00001', payment: { method: 'none' } });
    expect(a.status).toBe(201);
    ravi = a.body.supplier;
    const b = await procurement.session.post('/suppliers', { name: 'Tyre World', phone: '9800000002', payment: { method: 'upi', upiId: 'tyre@okaxis' } });
    tyre = b.body.supplier;
  });

  const create = (s = procurement.session, over = {}) => s.post('/supplier-enquiries', {
    items: ITEMS, supplierIds: [ravi.id, tyre.id], neededBy: '2026-11-20', deliverTo: 'Kochi, Kerala', notes: 'Quote GST separately', ...over,
  });

  describe('who may use it', () => {
    it('procurement and the admin; nobody else', async () => {
      expect((await create()).status).toBe(201);
      expect((await create(admin.session)).status).toBe(201);
      expect((await create(accounts.session)).status).toBe(403);
      expect((await create(ops.session)).status).toBe(403);
      expect((await accounts.session.get('/supplier-enquiries')).status).toBe(403);
      expect((await ops.session.get('/supplier-enquiries/products?q=wax')).status).toBe(403);
      expect((await request(app).get(`${BASE}/supplier-enquiries`)).status).toBe(401);
    });

    it('an inactive procurement member is refused', async () => {
      await User.updateOne({ _id: procurement.user._id }, { $set: { 'staff.active': false } });
      const res = await procurement.session.get('/supplier-enquiries');
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('creating', () => {
    it('saves items, snapshots suppliers, numbers it ENQ-YYMM-0001 and stores paise', async () => {
      const res = await create();
      expect(res.status).toBe(201);
      const e = res.body.enquiry;
      expect(e.ref).toMatch(/^ENQ-\d{4}-0001$/);
      expect(e.status).toBe('sent');
      expect(e.items[0]).toMatchObject({ name: '3M Car Wax Polish 500 ml', brand: '3M', partNo: '39030', qty: 10, targetPaise: 45000 });
      expect(e.items[1]).toMatchObject({ unit: 'sets', targetPaise: null, note: 'black finish preferred' });
      expect(e.suppliers.map((s) => [s.name, s.phone, s.sentAt])).toEqual([['Ravi Motors', '98000 00001', null], ['Tyre World', '9800000002', null]]);
      expect(e.contactName).toBe('Priya');
      expect(e.showTargetPrice).toBe(false);
      expect((await create()).body.enquiry.ref).toMatch(/-0002$/);
      // A later supplier edit does not rewrite who it went to.
      await Supplier.updateOne({ _id: ravi.id }, { $set: { name: 'Ravi Motors (Kochi)' } });
      expect((await procurement.session.get(`/supplier-enquiries/${e.id}`)).body.enquiry.suppliers[0].name).toBe('Ravi Motors');
    });

    it('refuses nonsense, with a message the panel can show', async () => {
      const bad = async (over) => (await create(procurement.session, over)).body.message;
      expect(await bad({ items: [] })).toMatch(/at least one item/);
      expect(await bad({ supplierIds: [] })).toMatch(/at least one supplier/);
      expect(await bad({ supplierIds: ['nope'] })).toMatch(/not found/);
      expect(await bad({ items: [{ name: 'x', qty: 1 }] })).toMatch(/what you need/);
      expect(await bad({ items: [{ name: 'Wax', qty: 0 }] })).toMatch(/quantity/);
      expect(await bad({ items: [{ name: 'Wax', qty: 1.5 }] })).toMatch(/quantity/);
      expect(await bad({ items: [{ name: 'Wax', qty: 1, target: '12.345' }] })).toMatch(/rupees/);
      expect(await bad({ items: [{ name: 'Wax', qty: 1, target: '-5' }] })).toMatch(/rupees/);
      expect(await bad({ neededBy: '2026-02-31' })).toMatch(/valid date/);
      expect(await bad({ items: Array.from({ length: 31 }, () => ({ name: 'Wax', qty: 1 })) })).toMatch(/At most 30/);
      await Supplier.updateOne({ _id: tyre.id }, { $set: { active: false } });
      const res = await create();
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Tyre World is marked inactive/);
      expect(await SupplierEnquiry.countDocuments()).toBe(0);
    });

    it('a double-click (same form key, at once) saves one enquiry', async () => {
      const key = 'form_abcdef12345';
      const [a, b] = await Promise.all([create(procurement.session, { formKey: key }), create(procurement.session, { formKey: key })]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.enquiry.id).toBe(b.body.enquiry.id);
      expect(await SupplierEnquiry.countDocuments()).toBe(1);
      // A retry later is the same enquiry too.
      expect((await create(procurement.session, { formKey: key })).body.enquiry.id).toBe(a.body.enquiry.id);
    });
  });

  describe('sending and quotes', () => {
    let e;
    beforeEach(async () => { e = (await create()).body.enquiry; });
    const quote = (rowId, body, s = procurement.session) => s.put(`/supplier-enquiries/${e.id}/suppliers/${rowId}/quote`, body);

    it('"sent" is stamped once, however many times WhatsApp is opened', async () => {
      const row = e.suppliers[0].id;
      const first = (await procurement.session.post(`/supplier-enquiries/${e.id}/suppliers/${row}/sent`)).body.enquiry.suppliers[0].sentAt;
      expect(first).toBeTruthy();
      await new Promise((r) => { setTimeout(r, 5); });
      const again = (await procurement.session.post(`/supplier-enquiries/${e.id}/suppliers/${row}/sent`)).body.enquiry;
      expect(again.suppliers[0].sentAt).toBe(first);
      expect(again.suppliers[1].sentAt).toBeNull();
      expect((await procurement.session.post(`/supplier-enquiries/${e.id}/suppliers/507f1f77bcf86cd799439011/sent`)).status).toBe(404);
    });

    it('records a reply, marks replied, and picks the cheapest incl. GST per item', async () => {
      const [wax, sensor] = e.items.map((i) => i.id);
      const [r1, r2] = e.suppliers.map((s) => s.id);
      // Ravi: wax ₹400 + 18% = ₹472; sensor ₹2,000 incl GST but none in stock.
      let res = await quote(r1, { quotes: [
        { itemId: wax, unitPrice: '400', gstRate: 18, available: 'yes', dispatchDays: 2 },
        { itemId: sensor, unitPrice: '2000', gstRate: 18, gstIncluded: true, available: 'no' },
      ], note: 'Prices valid this week' });
      expect(res.status).toBe(200);
      expect(res.body.enquiry.status).toBe('replied');
      expect(res.body.enquiry.suppliers[0].sentAt).toBeTruthy(); // replying implies it was sent
      expect(res.body.enquiry.best).toEqual({ [wax]: r1 }); // sensor: the only quote is "not available"
      // Tyre World: wax ₹470 incl GST (cheaper than 472), sensor ₹2,500 + 18%.
      res = await quote(r2, { quotes: [
        { itemId: wax, unitPrice: '470', gstRate: 18, gstIncluded: true, available: 'yes' },
        { itemId: sensor, unitPrice: '2500', gstRate: 18, available: 'partial' },
        { itemId: '507f1f77bcf86cd799439011', unitPrice: '1' }, // not on this enquiry: ignored
      ] });
      expect(res.body.enquiry.best).toEqual({ [wax]: r2, [sensor]: r2 });
      expect(res.body.enquiry.suppliers[1].quotes).toHaveLength(2);
      expect(res.body.enquiry.suppliers[1].quotes[0]).toMatchObject({ unitPaise: 47000, gstIncluded: true });
    });

    it('refuses a GST rate that does not exist, and saves nothing', async () => {
      const res = await quote(e.suppliers[0].id, { quotes: [{ itemId: e.items[0].id, unitPrice: '400', gstRate: 15 }] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/0, 5, 12, 18 or 28/);
      expect((await SupplierEnquiry.findById(e.id).lean()).status).toBe('sent');
    });

    it('a closed enquiry takes no quotes; reopening brings back the right status', async () => {
      await quote(e.suppliers[0].id, { quotes: [{ itemId: e.items[0].id, unitPrice: '400' }] });
      const closed = (await procurement.session.post(`/supplier-enquiries/${e.id}/close`, { note: 'Ordered from Ravi', chosenRowId: e.suppliers[0].id })).body.enquiry;
      expect(closed).toMatchObject({ status: 'closed', closedByName: 'Priya', closeNote: 'Ordered from Ravi', chosenSupplierRow: e.suppliers[0].id });
      expect((await quote(e.suppliers[1].id, { quotes: [{ itemId: e.items[0].id, unitPrice: '300' }] })).status).toBe(409);
      expect((await procurement.session.put(`/supplier-enquiries/${e.id}`, { ...e, items: ITEMS, supplierIds: [ravi.id] })).status).toBe(409);
      const back = (await procurement.session.post(`/supplier-enquiries/${e.id}/reopen`)).body.enquiry;
      expect(back).toMatchObject({ status: 'replied', closedAt: null, chosenSupplierRow: null });
    });
  });

  describe('editing', () => {
    it('keeps quotes for kept items and history for kept suppliers; a stale editor is refused', async () => {
      const e = (await create()).body.enquiry;
      const [wax, sensor] = e.items;
      await procurement.session.put(`/supplier-enquiries/${e.id}/suppliers/${e.suppliers[0].id}/quote`, { quotes: [
        { itemId: wax.id, unitPrice: '400' }, { itemId: sensor.id, unitPrice: '2000' },
      ] });
      const loaded = (await procurement.session.get(`/supplier-enquiries/${e.id}`)).body.enquiry;
      const body = {
        items: [{ ...wax, target: '420' }, { name: 'Wiper blade 22"', qty: 6 }], // sensor removed
        supplierIds: [ravi.id], // Tyre World removed
        neededBy: '', deliverTo: 'Kochi', notes: '', updatedAt: loaded.updatedAt,
      };
      const res = await procurement.session.put(`/supplier-enquiries/${e.id}`, body);
      expect(res.status).toBe(200);
      const after = res.body.enquiry;
      expect(after.items.map((i) => i.name)).toEqual(['3M Car Wax Polish 500 ml', 'Wiper blade 22"']);
      expect(after.items[0]).toMatchObject({ id: wax.id, targetPaise: 42000 });
      expect(after.suppliers).toHaveLength(1);
      expect(after.suppliers[0].quotes.map((q) => q.itemId)).toEqual([wax.id]);
      expect(after.suppliers[0].repliedAt).toBeTruthy();
      expect(after.status).toBe('replied');
      // The same body again carries the old updatedAt: refused, not overwritten.
      const stale = await procurement.session.put(`/supplier-enquiries/${e.id}`, { ...body, items: [{ name: 'Something else', qty: 1 }] });
      expect(stale.status).toBe(409);
      expect(stale.body.message).toMatch(/reload/);
      expect((await SupplierEnquiry.findById(e.id).lean()).items).toHaveLength(2);
    });
  });

  describe('the list', () => {
    it('newest first, keyset-paged with no repeats; filters by status and search', async () => {
      const made = [];
      for (let i = 0; i < 33; i += 1) {
        made.push((await create(procurement.session, { items: [{ name: i === 5 ? 'Bosch wiper blade' : `Part ${i}`, qty: 1 }] })).body.enquiry);
      }
      const p1 = (await procurement.session.get('/supplier-enquiries')).body;
      expect(p1.enquiries).toHaveLength(30);
      expect(p1.summary).toEqual({ count: 33, capped: false });
      expect(p1.enquiries[0].ref).toBe(made[32].ref);
      const p2 = (await procurement.session.get(`/supplier-enquiries?after=${p1.nextAfter}`)).body;
      expect(p2.enquiries).toHaveLength(3);
      expect(p2.nextAfter).toBeNull();
      const ids = [...p1.enquiries, ...p2.enquiries].map((x) => x.id);
      expect(new Set(ids).size).toBe(33);
      expect(p1.enquiries[0]).toMatchObject({ itemCount: 1, supplierCount: 2, sentCount: 0, repliedCount: 0 });

      expect((await procurement.session.get('/supplier-enquiries?q=bosch wiper')).body.enquiries.map((x) => x.ref)).toEqual([made[5].ref]);
      expect((await procurement.session.get(`/supplier-enquiries?q=${made[7].ref.toLowerCase()}`)).body.enquiries).toHaveLength(1);
      expect((await procurement.session.get('/supplier-enquiries?q=ravi')).body.enquiries).toHaveLength(30);
      expect((await procurement.session.get('/supplier-enquiries?q=.*')).body.enquiries).toHaveLength(0); // regex-escaped
      await procurement.session.post(`/supplier-enquiries/${made[0].id}/close`, {});
      expect((await procurement.session.get('/supplier-enquiries?status=closed')).body.enquiries.map((x) => x.id)).toEqual([made[0].id]);
      expect((await procurement.session.get('/supplier-enquiries?status=open')).body.summary.count).toBe(32);
    });

    it('the product search answers procurement (short words return nothing)', async () => {
      const res = await procurement.session.get('/supplier-enquiries/products?q=a');
      expect(res.status).toBe(200);
      expect(res.body.products).toEqual([]);
    });
  });

  describe('a supplier saved without payment details', () => {
    it('cannot be paid until bank or UPI is added; adding it first is not a bank-change warning', async () => {
      await expect(suppliers.payeeFor(ravi.id)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Add how we pay Ravi Motors/) });
      const res = await procurement.session.put(`/suppliers/${ravi.id}`, {
        name: 'Ravi Motors', phone: '9800000001',
        payment: { method: 'bank', accountName: 'Ravi Motors', accountNumber: '123456789012', ifsc: 'HDFC0001234' },
      });
      expect(res.status).toBe(200);
      expect(res.body.supplier.bankChangedAt).toBeNull();
      const { payee, bankNotice } = await suppliers.payeeFor(ravi.id);
      expect(payee).toMatchObject({ method: 'bank', accountNumber: '123456789012' });
      expect(bankNotice).toBeNull();
      // A real change after that still warns.
      await procurement.session.put(`/suppliers/${ravi.id}`, {
        name: 'Ravi Motors', payment: { method: 'bank', accountName: 'Ravi Motors', accountNumber: '999988887777', ifsc: 'HDFC0001234' },
      });
      expect((await suppliers.payeeFor(ravi.id)).bankNotice).toMatchObject({ byName: 'Priya' });
    });

    it('the directory filters to "payment details not added"', async () => {
      const res = await procurement.session.get('/suppliers?method=none');
      expect(res.body.suppliers.map((s) => s.name)).toEqual(['Ravi Motors']);
      expect(res.body.suppliers[0].payment.method).toBe('none');
    });
  });

  describe('photos', () => {
    it('the catalogue image is looked up by the server, never taken from the client', async () => {
      const { insertedId } = await Product.collection.insertOne({ name: 'Wax', images: [{ url: 'https://cdn.test/wax.jpg' }] });
      const res = await create(procurement.session, {
        items: [{ productId: String(insertedId), name: 'Wax', qty: 2, image: 'https://evil.test/x.jpg' }, { name: 'Free text', qty: 1, image: 'https://evil.test/y.jpg' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.enquiry.items.map((i) => i.image)).toEqual(['https://cdn.test/wax.jpg', '']);
    });

    it('adds up to 3 per item, streams them privately, and removes them', async () => {
      stored.clear();
      const e = (await create()).body.enquiry;
      const item = e.items[0];
      const url = `/supplier-enquiries/${e.id}/items/${item.id}/photos`;
      const a = await procurement.session.photos(url, [photo('a.jpg'), photo('b.jpg')]);
      expect(a.status).toBe(201);
      expect(a.body.enquiry.items[0].photos.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg']);
      expect(a.body.enquiry.items[1].photos).toEqual([]);
      // Stored under the private prefix, never a public URL in the response.
      expect([...stored.keys()].every((k) => k.startsWith(`supplier-enquiries/${e.id}/`))).toBe(true);
      expect(JSON.stringify(a.body)).not.toMatch(/publicId/);

      // Over the limit: refused, nothing stored.
      const over = await procurement.session.photos(url, [photo('c.jpg'), photo('d.jpg')]);
      expect(over.status).toBe(400);
      expect(over.body.message).toMatch(/1 more/);
      expect(stored.size).toBe(2);
      expect((await procurement.session.photos(url, [photo('c.jpg')])).status).toBe(201);
      expect((await procurement.session.photos(url, [photo('d.jpg')])).status).toBe(400);

      const pid = a.body.enquiry.items[0].photos[0].id;
      const got = await procurement.session.get(`/supplier-enquiries/${e.id}/photos/${pid}`);
      expect(got.status).toBe(200);
      expect(got.headers['content-type']).toMatch(/image\/jpeg/);
      expect(got.headers['x-content-type-options']).toBe('nosniff');
      expect(got.headers['cache-control']).toMatch(/no-store/);
      expect((await accounts.session.get(`/supplier-enquiries/${e.id}/photos/${pid}`)).status).toBe(403);

      const del = await procurement.session.del(`/supplier-enquiries/${e.id}/photos/${pid}`);
      expect(del.status).toBe(200);
      expect(del.body.enquiry.items[0].photos.map((p) => p.name)).toEqual(['b.jpg', 'c.jpg']);
      expect(stored.size).toBe(2);
      expect((await procurement.session.get(`/supplier-enquiries/${e.id}/photos/${pid}`)).status).toBe(404);
    });

    it('refuses a PDF, an empty upload, an unknown item, and a closed enquiry', async () => {
      const e = (await create()).body.enquiry;
      const url = `/supplier-enquiries/${e.id}/items/${e.items[0].id}/photos`;
      expect((await procurement.session.photos(url, [{ buffer: PDF, name: 'x.pdf', type: 'application/pdf' }])).status).toBe(400);
      expect((await procurement.session.photos(url, [])).status).toBe(400);
      expect((await procurement.session.photos(`/supplier-enquiries/${e.id}/items/${e.suppliers[0].id}/photos`, [photo()])).status).toBe(404);
      expect((await procurement.session.post(`/supplier-enquiries/${e.id}/close`, {})).status).toBe(200);
      expect((await procurement.session.photos(url, [photo()])).status).toBe(409);
    });

    it('an edit keeps the photos of kept items and deletes those of removed items', async () => {
      stored.clear();
      const e = (await create()).body.enquiry;
      await procurement.session.photos(`/supplier-enquiries/${e.id}/items/${e.items[0].id}/photos`, [photo('keep.jpg')]);
      const r = await procurement.session.photos(`/supplier-enquiries/${e.id}/items/${e.items[1].id}/photos`, [photo('gone.jpg')]);
      expect(stored.size).toBe(2);
      const now = r.body.enquiry;
      const res = await procurement.session.put(`/supplier-enquiries/${e.id}`, {
        items: [{ ...ITEMS[0], id: now.items[0].id }],
        supplierIds: [ravi.id, tyre.id], updatedAt: now.updatedAt,
      });
      expect(res.status).toBe(200);
      expect(res.body.enquiry.items[0].photos.map((p) => p.name)).toEqual(['keep.jpg']);
      expect(stored.size).toBe(1);
      expect([...stored.keys()][0]).toMatch(/supplier-enquiries\//);
    });
  });
});

describe('supplier enquiry helpers', () => {
  it('toPaise: rupees as typed → exact paise, never float drift', () => {
    expect(svc.toPaise('0.29', 'x')).toBe(29);
    expect(svc.toPaise(0.29, 'x')).toBe(29);
    expect(svc.toPaise('1,250.5', 'x')).toBe(125050);
    expect(svc.toPaise('₹ 4,499.99', 'x')).toBe(449999);
    expect(svc.toPaise('', 'x')).toBeNull();
    expect(svc.toPaise(null, 'x')).toBeNull();
    expect(() => svc.toPaise('0', 'x')).toThrow(/more than/);
    expect(() => svc.toPaise('1e5', 'x')).toThrow(/rupees/);
    expect(() => svc.toPaise('100000001', 'x')).toThrow(/too large/);
  });

  it('refFor: the month in India time, padded series', () => {
    // 31 Oct 2026 20:00 UTC is already 1 Nov in India.
    expect(svc.refFor(7, new Date('2026-10-31T20:00:00Z'))).toBe('ENQ-2611-0007');
    expect(svc.refFor(12345, new Date('2026-10-31T18:00:00Z'))).toBe('ENQ-2610-12345');
  });

  it('quoteUnitWithGst rounds the GST to the paisa', () => {
    expect(svc.quoteUnitWithGst({ unitPaise: 99999, gstRate: 18 })).toBe(117999); // 17999.82 → 18000
    expect(svc.quoteUnitWithGst({ unitPaise: 101, gstRate: 5 })).toBe(106); // 5.05 → 5
    expect(svc.quoteUnitWithGst({ unitPaise: 1000, gstRate: 28, gstIncluded: true })).toBe(1000);
    expect(svc.quoteUnitWithGst({ unitPaise: 1000, gstRate: null })).toBe(1000);
    expect(svc.quoteUnitWithGst({ unitPaise: null })).toBeNull();
  });
});
