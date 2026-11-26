/**
 * Autobacs Partner — procurement's side (routes/procurementPartners.js,
 * services/procurementPartners/*).
 *
 * What must hold:
 *   - active procurement staff and the admin only: signed-out 401, a supplier
 *     token 401, a customer / another team / an inactive procurement member 403
 *   - approval names the listing rev it reviewed; a supplier edit since → 409
 *   - a price below the supplier's cost is always refused; below the floor
 *     margin needs an explicit override with a reason
 *   - approve-as-new makes ONE active product (double-click safe) carrying no
 *     cost anywhere — not in the Product document, not in the public product API
 *   - approve-by-link attaches to an existing product, optionally re-pricing it
 *   - every product write purges the cache (Redis tags + Next.js tags)
 *   - price reviews: apply moves Product.price once; keep leaves it; both obey cost/floor
 *   - account decisions are CAS: a repeat is a no-op, a conflicting one is 409;
 *     reject and suspend sign the supplier out (sessionVersion bumped)
 *   - lists are keyset-paged: no row repeated or skipped across a page boundary
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const privateReads = [];
const privateMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async () => ({ publicId: 'x', provider: 'r2', bytes: 1, resourceType: 'image', url: '' }),
  deletePrivateAsset: async () => true,
  readPrivateAsset: async (ref) => { privateReads.push(ref.publicId); return JPEG; },
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...privateMock, default: privateMock }));

let uploadSeq = 0;
// Plain functions, not jest.fn(impl): jest.config resets mock implementations between tests.
const publicPuts = [];
const putPublicAsset = async () => {
  publicPuts.push(uploadSeq);
  uploadSeq += 1;
  return { secure_url: `https://res.cloudinary.com/test/image/upload/autobacs/products/p${uploadSeq}.jpg`, public_id: `autobacs/products/p${uploadSeq}`, provider: 'cloudinary' };
};
jest.unstable_mockModule('../services/storage/publicUploads.js', () => ({ putPublicAsset, PUBLIC_CACHE_CONTROL: '', default: { putPublicAsset } }));
const deletedImages = [];
const deleteHostedImages = async (refs) => { deletedImages.push(...refs); };
jest.unstable_mockModule('../services/storage/publicImageDeletes.js', () => ({ deleteHostedImages, default: { deleteHostedImages } }));
const revalidateFrontendTags = jest.fn();
jest.unstable_mockModule('../services/frontendRevalidator.js', () => ({ revalidateFrontendTags, default: { revalidateFrontendTags } }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Supplier } = await import('../models/Supplier.js');
const { default: Product } = await import('../models/Product.js');
const { default: Category } = await import('../models/Category.js');
const { default: SupplierAccount } = await import('../models/SupplierAccount.js');
const { default: SupplierListing } = await import('../models/SupplierListing.js');
const { default: SupplierPriceReview } = await import('../models/SupplierPriceReview.js');
const { default: cacheService } = await import('../services/cacheService.js');
const { signSupplierToken } = await import('../middleware/supplierAuth.js');
const { isEncrypted } = await import('../utils/fieldEncryption.js');

const BASE = '/api/v1';
const P = '/procurement/partners';
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
    get: (url) => agent.get(`${BASE}${P}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${P}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${P}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${P}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return signIn(email);
};
const team = (t, active = true) => ({ team: t, isHead: false, active });

const makeAccount = (over = {}) => {
  n += 1;
  return SupplierAccount.create({
    email: `acme${n}@example.com`, emailKey: `acme${n}@example.com`, passwordHash: 'x'.repeat(60),
    companyName: `Acme Parts ${n}`, contactName: 'Ravi', phone: '9876543210', city: 'Kochi', address: 'MG Road',
    gstin: '32ABCDE1234F1Z5', pan: 'ABCDE1234F',
    gstCertificate: { key: 'supplier-partner/acc/gst.pdf', contentType: 'application/pdf' },
    bank: { accountName: 'Acme Parts', accountNumber: '123456789012', accountLast4: '9012', ifsc: 'HDFC0001234' },
    status: 'in_review', submittedAt: new Date(Date.now() - 60000), ...over,
  });
};
const makeListing = (account, over = {}) => SupplierListing.create({
  supplierAccount: account._id, supplierId: account.supplierId, status: 'submitted', rev: 3,
  title: 'Bosch Aerotwin wiper blade 24"', brand: 'Bosch', partNumber: 'AP24U', description: 'Flat blade, fits most hooks.',
  images: [{ key: 'supplier-partner/l/1.jpg', contentType: 'image/jpeg' }, { key: 'supplier-partner/l/2.jpg', contentType: 'image/jpeg' }],
  costPaise: 180000, gstPct: 18, availability: 'low', submittedAt: new Date(), ...over,
});
const productForm = (category) => ({
  name: 'Bosch Aerotwin Wiper Blade 24 inch', description: 'Flat wiper blade with a universal adapter. Quiet, streak-free.',
  categories: [String(category._id)], brand: 'Bosch', specifications: [{ key: 'Length', value: '24 in' }],
});

describe('procurement partners', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); jest.clearAllMocks(); privateReads.length = 0; publicPuts.length = 0; deletedImages.length = 0; });

  let proc, admin, category;
  beforeEach(async () => {
    proc = await makeUser('Priya', 'staff', team('procurement'));
    admin = await makeUser('Owner', 'admin');
    category = await Category.create({ name: 'Wipers', slug: `wipers-${n}` });
  });

  async function approvedAccount() {
    const supplier = await Supplier.create({ name: `Acme Supplier ${n}`, nameKey: `acme supplier ${n}`, payment: { method: 'none' } });
    return makeAccount({ status: 'approved', supplierId: supplier._id });
  }

  // ── Access ────────────────────────────────────────────────────────────────
  describe('access', () => {
    test('signed out → 401; supplier token → 401; customer, other team, inactive procurement → 403', async () => {
      expect((await request(app).get(`${BASE}${P}/counts`)).status).toBe(401);
      const acc = await makeAccount({ status: 'approved' });
      const sup = await request(app).get(`${BASE}${P}/counts`).set('Authorization', `Bearer ${signSupplierToken(acc)}`);
      expect(sup.status).toBe(401);
      for (const s of [await makeUser('Cust', 'customer'), await makeUser('Acc', 'staff', team('accounts')), await makeUser('Old', 'staff', team('procurement', false))]) {
        const r = await s.get('/counts');
        expect(r.status).toBe(403);
        expect(r.body.success).toBe(false);
      }
    });

    test('procurement and admin get counts, never cached', async () => {
      const acc = await makeAccount();
      await makeListing(acc);
      for (const s of [proc, admin]) {
        const r = await s.get('/counts');
        expect(r.status).toBe(200);
        expect(r.headers['cache-control']).toContain('no-store');
        expect(r.body.counts).toMatchObject({ accounts: 1, listings: 1, priceReviews: 0, total: 2 });
      }
    });
  });

  // ── Supplier accounts ─────────────────────────────────────────────────────
  describe('accounts', () => {
    test('detail shows documents and bank; document streams privately', async () => {
      const acc = await makeAccount();
      const d = await proc.get(`/accounts/${acc._id}`);
      expect(d.status).toBe(200);
      expect(d.body.account.bank.accountNumber).toBe('123456789012');
      expect(d.body.account.documents.gstCertificate).toBeTruthy();
      const f = await proc.get(`/accounts/${acc._id}/documents/gst-certificate`);
      expect(f.status).toBe(200);
      expect(f.headers['x-content-type-options']).toBe('nosniff');
      expect(f.headers['cache-control']).toContain('no-store');
      expect(privateReads).toEqual(['supplier-partner/acc/gst.pdf']);
      expect((await proc.get(`/accounts/${acc._id}/documents/cancelled-cheque`)).status).toBe(404);
      expect((await proc.get(`/accounts/${acc._id}/documents/passwd`)).status).toBe(404);
    });

    test('approve as new supplier: one Supplier, bank encrypted, repeat is a no-op', async () => {
      const acc = await makeAccount();
      const r = await proc.post(`/accounts/${acc._id}/approve`, { mode: 'new' });
      expect(r.status).toBe(201);
      expect(r.body.account.status).toBe('approved');
      const again = await proc.post(`/accounts/${acc._id}/approve`, { mode: 'new' });
      expect(again.status).toBe(200);
      expect(await Supplier.countDocuments()).toBe(1);
      const s = await Supplier.findOne().select('+payment.accountNumber').lean();
      expect(String(s._id)).toBe(r.body.account.supplierId);
      expect(s.payment.method).toBe('bank');
      expect(isEncrypted(s.payment.accountNumber)).toBe(true);
      expect(s.gstin).toBe('32ABCDE1234F1Z5');
    });

    test('approve by linking, copying bank → bankChangedAt warning; linking a supplier with a login → 409', async () => {
      const existing = await Supplier.create({
        name: 'Acme Old', nameKey: 'acme old', payment: { method: 'bank', accountName: 'Acme', accountNumber: '999988887777', accountLast4: '7777', ifsc: 'SBIN0000001' },
      });
      const acc = await makeAccount();
      const r = await proc.post(`/accounts/${acc._id}/approve`, { mode: 'link', supplierId: String(existing._id), copyBank: true });
      expect(r.status).toBe(200);
      expect(r.body.bankChanged).toBe(true);
      const s = await Supplier.findById(existing._id).lean();
      expect(s.bankChangedAt).toBeTruthy();
      expect(s.payment.accountLast4).toBe('9012');

      const second = await makeAccount();
      const clash = await proc.post(`/accounts/${second._id}/approve`, { mode: 'link', supplierId: String(existing._id) });
      expect(clash.status).toBe(409);
      expect((await SupplierAccount.findById(second._id).lean()).status).toBe('in_review');
    });

    test('a failed new-supplier create puts the account back in the queue', async () => {
      const acc = await makeAccount();
      await Supplier.create({ name: acc.companyName, nameKey: acc.companyName.toLowerCase(), payment: { method: 'none' } });
      const r = await proc.post(`/accounts/${acc._id}/approve`, { mode: 'new' });
      expect(r.status).toBe(409);
      const now = await SupplierAccount.findById(acc._id).lean();
      expect(now.status).toBe('in_review');
      expect(now.supplierId).toBeNull();
    });

    test('request changes / reject / suspend / unsuspend: CAS, notes, session bumps', async () => {
      const acc = await makeAccount();
      expect((await proc.post(`/accounts/${acc._id}/request-changes`, { note: '' })).status).toBe(400);
      const ch = await proc.post(`/accounts/${acc._id}/request-changes`, { note: 'GST certificate is blurry' });
      expect(ch.body.account.status).toBe('changes_requested');
      expect(ch.body.account.reviewNote).toBe('GST certificate is blurry');

      const rj = await proc.post(`/accounts/${acc._id}/reject`, { note: 'Not a parts dealer' });
      expect(rj.body.account.status).toBe('rejected');
      const again = await proc.post(`/accounts/${acc._id}/reject`, { note: 'Not a parts dealer' });
      expect(again.status).toBe(200);
      expect((await SupplierAccount.findById(acc._id).lean()).sessionVersion).toBe(1); // bumped once
      expect((await proc.post(`/accounts/${acc._id}/approve`, { mode: 'new' })).status).toBe(409);

      const live = await approvedAccount();
      const sp = await proc.post(`/accounts/${live._id}/suspend`, { note: 'Fake stock twice' });
      expect(sp.body.account.status).toBe('suspended');
      const un = await proc.post(`/accounts/${live._id}/unsuspend`);
      expect(un.body.account.status).toBe('approved');
      expect((await SupplierAccount.findById(live._id).lean()).sessionVersion).toBe(2);
    });

    test('list is keyset-paged without repeats', async () => {
      for (let i = 0; i < 32; i += 1) await makeAccount({ submittedAt: new Date(Date.now() - (i % 3) * 1000) });
      const p1 = await proc.get('/accounts');
      expect(p1.body.items).toHaveLength(30);
      const p2 = await proc.get(`/accounts?after=${p1.body.nextCursor}`);
      expect(p2.body.items).toHaveLength(2);
      expect(p2.body.nextCursor).toBeNull();
      const ids = [...p1.body.items, ...p2.body.items].map((a) => a.id);
      expect(new Set(ids).size).toBe(32);
    });
  });

  // ── Listings ──────────────────────────────────────────────────────────────
  describe('listings', () => {
    test('detail shows cost, GST, suggested price (₹3,035 at 30%) and the photos', async () => {
      const acc = await approvedAccount();
      const l = await makeListing(acc);
      const d = await proc.get(`/listings/${l._id}`);
      expect(d.status).toBe(200);
      expect(d.body.listing.pricing).toMatchObject({ costPaise: 180000, gstPct: 18, suggestedPrice: 3035, rule: { targetBp: 3000, floorBp: 1000 } });
      expect(d.body.listing.images).toHaveLength(2);
      const img = await proc.get(`/listings/${l._id}/images/1`);
      expect(img.status).toBe(200);
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      expect((await proc.get(`/listings/${l._id}/images/7`)).status).toBe(404);
    });

    test('possible duplicates include a product whose SKU is the part number', async () => {
      const acc = await approvedAccount();
      const l = await makeListing(acc);
      const p = await Product.create({ name: 'Wiper blade 24', slug: 'wb-24', description: 'An existing wiper blade', price: 2999, sku: 'AP24U', categories: [category._id] });
      const d = await proc.get(`/listings/${l._id}`);
      expect(d.body.listing.duplicates.map((x) => x.id)).toContain(String(p._id));
    });

    test('approval with an old rev → 409 LISTING_CHANGED, nothing created', async () => {
      const l = await makeListing(await approvedAccount());
      const r = await proc.post(`/listings/${l._id}/approve-new`, { rev: 2, product: productForm(category), price: 3035 });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('LISTING_CHANGED');
      expect(await Product.countDocuments()).toBe(0);
      expect((await proc.post(`/listings/${l._id}/approve-new`, { product: productForm(category), price: 3035 })).status).toBe(400);
    });

    test('below cost is always refused; below floor needs override + reason', async () => {
      const l = await makeListing(await approvedAccount());
      const cost = await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: productForm(category), price: 2000, override: true, overrideReason: 'clearance' });
      expect(cost.status).toBe(422);
      expect(cost.body.code).toBe('BELOW_COST');
      const floor = await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: productForm(category), price: 2200 });
      expect(floor.status).toBe(422);
      expect(floor.body.code).toBe('BELOW_FLOOR');
      const noReason = await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: productForm(category), price: 2200, override: true });
      expect(noReason.status).toBe(422);
      expect(await Product.countDocuments()).toBe(0);
      const ok = await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: productForm(category), price: 2200, override: true, overrideReason: 'Match competitor price' });
      expect(ok.status).toBe(201);
      expect((await SupplierListing.findById(l._id).lean()).reviewNote).toContain('Match competitor price');
    });

    test('approve as new: ONE active product, stock from supplier, photos copied, no cost anywhere, cache purged', async () => {
      const invalidateTags = jest.spyOn(cacheService, 'invalidateTags');
      const acc = await approvedAccount();
      const l = await makeListing(acc);
      const body = { rev: 3, product: productForm(category), price: 3035 };
      const [a, b] = await Promise.all([proc.post(`/listings/${l._id}/approve-new`, body), proc.post(`/listings/${l._id}/approve-new`, body)]);
      expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([201]));
      expect(await Product.countDocuments()).toBe(1);
      const third = await proc.post(`/listings/${l._id}/approve-new`, body);
      expect(third.status).toBe(200);
      expect(await Product.countDocuments()).toBe(1);

      const product = await Product.findOne().lean();
      expect(product).toMatchObject({ name: 'Bosch Aerotwin Wiper Blade 24 inch', price: 3035, isActive: true, stock: 'low', brand: 'Bosch' });
      expect(product.slug).toBeTruthy();
      expect(product.images).toHaveLength(2);
      expect(product.images[0].isPrimary).toBe(true);
      const json = JSON.stringify(product);
      expect(json).not.toMatch(/cost|margin|180000|supplier/i);

      const listing = await SupplierListing.findById(l._id).lean();
      expect(listing).toMatchObject({ status: 'live', drivesStock: true });
      expect(String(listing.productId)).toBe(String(product._id));
      expect(String(listing.supplierId)).toBe(String(acc.supplierId));

      expect(revalidateFrontendTags).toHaveBeenCalledWith(expect.arrayContaining([`product:${product.slug}`]));
      expect(invalidateTags).toHaveBeenCalledWith('products');

      const pub = await request(app).get(`${BASE}/products/slug/${product.slug}`);
      expect(pub.status).toBe(200);
      expect(JSON.stringify(pub.body)).not.toMatch(/cost|margin|180000|1800\b/i);
      invalidateTags.mockRestore();
    });

    test('approve but keep hidden → isActive false; only chosen photos copied', async () => {
      const l = await makeListing(await approvedAccount());
      const r = await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: productForm(category), price: 3035, keepHidden: true, imageIndexes: [1] });
      expect(r.status).toBe(201);
      const product = await Product.findOne().lean();
      expect(product.isActive).toBe(false);
      expect(product.images).toHaveLength(1);
      expect(privateReads).toEqual(['supplier-partner/l/2.jpg']);
    });

    test('a failed product save puts the listing back and deletes copied photos', async () => {
      const l = await makeListing(await approvedAccount());
      await Product.create({ name: 'Other', slug: 'other', description: 'something else entirely', price: 100, sku: 'TAKEN', categories: [category._id] });
      const r = await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: { ...productForm(category), sku: 'TAKEN' }, price: 3035 });
      expect(r.status).toBe(409);
      expect(deletedImages).toHaveLength(2);
      expect((await SupplierListing.findById(l._id).lean()).status).toBe('submitted');
      expect(await Product.countDocuments()).toBe(1);
    });

    test('approve by linking: sets price + stock on the existing product; second supplier does not drive stock', async () => {
      const existing = await Product.create({ name: 'Wiper 24', slug: 'wiper-24', description: 'An existing wiper blade', price: 4000, stock: 'out', categories: [category._id], isActive: true });
      const l = await makeListing(await approvedAccount(), { availability: 'in' });
      const r = await proc.post(`/listings/${l._id}/approve-link`, { rev: 3, productId: String(existing._id), setPrice: true, price: 3500 });
      expect(r.status).toBe(200);
      const p = await Product.findById(existing._id).lean();
      expect(p).toMatchObject({ price: 3500, stock: 'in' });
      expect(JSON.stringify(p)).not.toMatch(/cost|180000/i);
      expect((await SupplierListing.findById(l._id).lean()).drivesStock).toBe(true);
      expect(revalidateFrontendTags).toHaveBeenCalledWith(expect.arrayContaining(['product:wiper-24']));

      const l2 = await makeListing(await approvedAccount(), { availability: 'out' });
      const r2 = await proc.post(`/listings/${l2._id}/approve-link`, { rev: 3, productId: String(existing._id) });
      expect(r2.status).toBe(200);
      expect((await SupplierListing.findById(l2._id).lean()).drivesStock).toBe(false);
      expect((await Product.findById(existing._id).lean()).stock).toBe('in');
      const forced = await makeListing(await approvedAccount());
      expect((await proc.post(`/listings/${forced._id}/approve-link`, { rev: 3, productId: String(existing._id), drivesStock: true })).status).toBe(409);
    });

    test('linking to a product priced below the new cost is refused unless re-priced', async () => {
      const cheap = await Product.create({ name: 'Cheap', slug: 'cheap', description: 'priced too low now', price: 1500, categories: [category._id] });
      const l = await makeListing(await approvedAccount());
      const r = await proc.post(`/listings/${l._id}/approve-link`, { rev: 3, productId: String(cheap._id) });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('BELOW_COST');
      expect((await SupplierListing.findById(l._id).lean()).status).toBe('submitted');
    });

    test('a suspended supplier\'s listing cannot be approved', async () => {
      const acc = await approvedAccount();
      const l = await makeListing(acc);
      await SupplierAccount.updateOne({ _id: acc._id }, { status: 'suspended' });
      expect((await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: productForm(category), price: 3035 })).status).toBe(409);
    });

    test('request changes and reject', async () => {
      const l = await makeListing(await approvedAccount());
      const ch = await proc.post(`/listings/${l._id}/request-changes`, { note: 'Add a photo of the box' });
      expect(ch.body.listing.status).toBe('changes_requested');
      expect((await proc.post(`/listings/${l._id}/approve-new`, { rev: 3, product: productForm(category), price: 3035 })).status).toBe(409);
      const rj = await proc.post(`/listings/${l._id}/reject`, { note: 'We do not sell these' });
      expect(rj.body.listing.status).toBe('rejected');
    });

    test('queue is keyset-paged without repeats', async () => {
      const acc = await approvedAccount();
      const t = Date.now();
      for (let i = 0; i < 31; i += 1) await makeListing(acc, { submittedAt: new Date(t - (i % 2) * 1000) });
      const p1 = await proc.get('/listings');
      expect(p1.body.items).toHaveLength(30);
      expect(p1.body.items[0].companyName).toBe(acc.companyName);
      const p2 = await proc.get(`/listings?after=${p1.body.nextCursor}`);
      expect(p2.body.items).toHaveLength(1);
      expect(new Set([...p1.body.items, ...p2.body.items].map((x) => x.id)).size).toBe(31);
    });
  });

  // ── Price reviews ─────────────────────────────────────────────────────────
  describe('price reviews', () => {
    async function liveWithReview({ price = 3035, newCost = 200000 } = {}) {
      const acc = await approvedAccount();
      const product = await Product.create({ name: 'Live wiper', slug: `live-${n}`, description: 'A live wiper blade', price, categories: [category._id] });
      const l = await makeListing(acc, { status: 'live', productId: product._id, costPaise: newCost });
      const review = await SupplierPriceReview.create({
        listing: l._id, product: product._id, supplierAccount: acc._id, oldCostPaise: 180000, newCostPaise: newCost,
        gstPct: 18, priceAtRaise: price, suggestedPrice: 3372, marginBp: 3000,
      });
      return { product, review };
    }

    test('apply sets the price once and purges; repeat is a no-op', async () => {
      const { product, review } = await liveWithReview();
      const list = await proc.get('/price-reviews');
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ productName: 'Live wiper', currentPrice: 3035, newCostPaise: 200000 });
      const r = await proc.post(`/price-reviews/${review._id}/apply`, { price: 3400 });
      expect(r.status).toBe(200);
      expect(r.body.review.status).toBe('applied');
      expect((await Product.findById(product._id).lean()).price).toBe(3400);
      expect(revalidateFrontendTags).toHaveBeenCalled();
      const again = await proc.post(`/price-reviews/${review._id}/apply`, { price: 3400 });
      expect(again.status).toBe(200);
      expect((await proc.post(`/price-reviews/${review._id}/apply`, { price: 3500 })).status).toBe(409);
      const hist = await proc.get(`/price-reviews/product/${product._id}`);
      expect(hist.body.items).toHaveLength(1);
    });

    test('apply below cost refused; below floor needs override', async () => {
      const { review } = await liveWithReview();
      expect((await proc.post(`/price-reviews/${review._id}/apply`, { price: 2300 })).body.code).toBe('BELOW_COST');
      expect((await proc.post(`/price-reviews/${review._id}/apply`, { price: 2500 })).body.code).toBe('BELOW_FLOOR');
      const ok = await proc.post(`/price-reviews/${review._id}/apply`, { price: 2500, override: true, overrideReason: 'festival offer' });
      expect(ok.status).toBe(200);
    });

    test('keep leaves the price, but not when the new cost is above it', async () => {
      const { product, review } = await liveWithReview();
      const r = await proc.post(`/price-reviews/${review._id}/keep`, {});
      expect(r.body.review.status).toBe('kept');
      expect((await Product.findById(product._id).lean()).price).toBe(3035);

      const loss = await liveWithReview({ price: 2000, newCost: 200000 });
      const k = await proc.post(`/price-reviews/${loss.review._id}/keep`, {});
      expect(k.status).toBe(422);
      expect(k.body.code).toBe('BELOW_COST');
    });
  });

  // ── Margin rules ──────────────────────────────────────────────────────────
  describe('margin rules', () => {
    test('default and per-category; target must be ≥ floor and ≤ 90%; category rule drives the suggestion', async () => {
      const empty = await proc.get('/margin-rules');
      expect(empty.body.rules).toMatchObject({ builtIn: { targetBp: 3000, floorBp: 1000 }, default: null, categories: [] });
      expect((await proc.put('/margin-rules', { targetPct: 20, floorPct: 25 })).status).toBe(400);
      expect((await proc.put('/margin-rules', { targetPct: 95, floorPct: 5 })).status).toBe(400);
      const d = await proc.put('/margin-rules', { targetPct: '27.5', floorPct: 8 });
      expect(d.body.rules.default).toMatchObject({ targetBp: 2750, floorBp: 800 });
      const c = await admin.put('/margin-rules', { categoryId: String(category._id), targetPct: 40, floorPct: 15 });
      expect(c.body.rules.categories[0]).toMatchObject({ categoryName: 'Wipers', targetBp: 4000, floorBp: 1500 });

      const l = await makeListing(await approvedAccount());
      const q = await proc.post(`/listings/${l._id}/quote`, { categories: [String(category._id)], price: 3035 });
      expect(q.body.pricing.rule).toMatchObject({ targetBp: 4000, floorBp: 1500, source: `category:${category._id}` });
      expect(q.body.pricing.currentMarginBp).toBeGreaterThan(2999);

      const del = await proc.del(`/margin-rules/${category._id}`);
      expect(del.body.rules.categories).toHaveLength(0);
    });
  });
});
