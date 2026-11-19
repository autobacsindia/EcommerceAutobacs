/**
 * Size class (shippingClass) + online-listed size (listedSize) through the real
 * routes: the product editor's save, the bulk setter, the per-class list and the
 * standard-box settings. Harness copied from productShippingSize.test.js.
 */

import { jest } from '@jest/globals';
import crypto from 'crypto';
import * as dbHandler from './db-handler.js';

// Deterministic IP/UA so the admin context-binding middleware (authMiddleware
// `admin`) has stable hashes to match. These must be sent on every admin
// request AND stored on the seeded admin user (see getAdminToken / asAdmin).
const ADMIN_IP = '198.51.100.23';
const ADMIN_UA = 'jest-admin/1.0';
const ADMIN_IP_HASH = crypto.createHash('sha256').update(ADMIN_IP).digest('hex');
const ADMIN_UA_HASH = crypto.createHash('sha256').update(ADMIN_UA).digest('hex');

/** Attach admin Bearer token + the IP/UA headers the context check expects. */
function asAdmin(req, token) {
  return req
    .set('Authorization', `Bearer ${token}`)
    .set('cf-connecting-ip', ADMIN_IP)
    .set('User-Agent', ADMIN_UA);
}

// Suppress console.error during tests - we expect errors in negative test cases
// This prevents "Simulated failure" logs from being treated as test failures
const originalConsoleError = console.error;
beforeAll(() => {
  // Mock console.error to suppress expected error logs during tests
  // Only suppress in this specific test file where we intentionally trigger errors
  console.error = jest.fn();
});

afterAll(() => {
  // Restore original console.error after tests complete
  console.error = originalConsoleError;
});

// ── Cloudinary mock (must happen before app/controller import) ────────────────

const mockUploadMany   = jest.fn();
const mockDeleteMany   = jest.fn();
const mockUploadSingle = jest.fn();
const mockDeleteSingle = jest.fn();
const mockUploadRaw    = jest.fn();

// Mock the WHOLE module — every export the app imports must be listed, else the
// import fails at link time. orderController (loaded via app.js) imports
// uploadRawToCloudinary + deleteFromCloudinary for the shipping-slip feature.
jest.unstable_mockModule('../utils/cloudinaryHelpers.js', () => ({
  uploadToCloudinary:       (...args) => mockUploadSingle(...args),
  uploadRawToCloudinary:    (...args) => mockUploadRaw(...args),
  uploadVideoToCloudinary:    (...args) => mockUploadRaw(...args),
  uploadManyToCloudinary:   (...args) => mockUploadMany(...args),
  deleteFromCloudinary:     (...args) => mockDeleteSingle(...args),
  deleteManyFromCloudinary: (...args) => mockDeleteMany(...args),
  buildOptimizedUrl:        (publicId) => `https://mock.cloudinary/${publicId}`,
  // Imported by routes/uploads.js (mounted in app.js) for direct-to-Cloudinary uploads.
  generateUploadSignature:  ({ folder = 'general' } = {}) => ({
    cloudName: 'test-cloud', apiKey: 'test-key', timestamp: 1700000000, folder, allowedFormats: 'jpg,jpeg,png,webp', signature: 'test-sig',
  }),
}));

// ── Dynamic imports AFTER mock registration ───────────────────────────────────

// eslint-disable-next-line import/first
const { app }    = await import('../app.js');
const request    = (await import('supertest')).default;
const Product    = (await import('../models/Product.js')).default;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await dbHandler.connect();
}, 120000);

afterAll(async () => {
  await dbHandler.closeDatabase();
});

afterEach(async () => {
  jest.clearAllMocks();
  await dbHandler.clearDatabase();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seed a real product with known images */
async function seedProduct(overrides = {}) {
  return Product.create({
    name:        'Test Product',
    description: 'A test product description',
    price:       999,
    stock:       'in',
    slug:        `test-product-${Date.now()}`,
    isActive:    true,
    images: [
      { url: 'https://cdn/old1.jpg', public_id: 'autobacs/old1', alt: 'old1', isPrimary: true  },
      { url: 'https://cdn/old2.jpg', public_id: 'autobacs/old2', alt: 'old2', isPrimary: false },
    ],
    ...overrides,
  });
}

/** Create a minimal admin JWT for protected routes */
async function getAdminToken() {
  const email    = `admin_${Date.now()}@test.com`;
  const password = 'AdminPass123!';

  const User    = (await import('../models/User.js')).default;
  const bcrypt  = (await import('bcryptjs')).default;
  const jwt     = (await import('jsonwebtoken')).default;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name: 'Admin Test',
    email,
    passwordHash,
    role: 'admin',
    isVerified: true,
    // The admin middleware binds each request to the IP/UA captured at login.
    // These tests sign tokens directly (no login), so seed the hashes to match
    // the ADMIN_IP/ADMIN_UA sent by asAdmin().
    lastAdminIPHash: ADMIN_IP_HASH,
    lastAdminUAHash: ADMIN_UA_HASH,
  });

  return jwt.sign(
    { id: user._id, role: 'admin' },
    process.env.JWT_SECRET || 'test_jwt_secret_for_testing',
    { expiresIn: '1h' }
  );
}

const ShippingClassConfig = (await import('../models/ShippingClassConfig.js')).default;
const AuditLog = (await import('../models/AuditLog.js')).default;

const put = (id, token, body) => asAdmin(request(app).put(`/api/v1/products/${id}`), token).send(body);
const bulk = (token, body) => asAdmin(request(app).patch('/api/v1/products/shipping-class'), token).send(body);
const stored = async (id) => {
  const p = await Product.findById(id).lean();
  return { shippingClass: p.shippingClass ?? null, shippingClassSource: p.shippingClassSource ?? null };
};

// Bare product online: 0.8 kg, 25×10×10 → box 30×15×15 = 1.35 kg chargeable → small
const SMALL_LISTED = { weightKg: 0.8, lengthCm: 25, breadthCm: 10, heightCm: 10 };
// Packed box 25 kg, 60×50×40 (volumetric 24) → large
const LARGE_PACKED = { weightKg: 25, lengthCm: 60, breadthCm: 50, heightCm: 40 };

let token;
beforeEach(async () => {
  mockUploadMany.mockResolvedValue([]);
  token = await getAdminToken();
});

describe('PUT /products/:id — shippingClass', () => {
  test('a new product field defaults to not set', async () => {
    const p = await seedProduct();
    expect(await stored(p._id)).toEqual({ shippingClass: null, shippingClassSource: null });
  });

  test.each(['small', 'medium', 'large', 'xl', 'LARGE'])('saves an admin-chosen %s as manual', async (cls) => {
    const p = await seedProduct();
    const res = await put(p._id, token, { shippingClass: cls });
    expect(res.status).toBe(200);
    expect(await stored(p._id)).toEqual({ shippingClass: cls.toLowerCase(), shippingClassSource: 'manual' });
  });

  test.each(['huge', 'extra-large', '3'])('rejects %p with a 400 and keeps the stored class', async (bad) => {
    const p = await seedProduct({ shippingClass: 'medium', shippingClassSource: 'manual' });
    const res = await put(p._id, token, { shippingClass: bad });
    expect(res.status).toBe(400);
    expect(await stored(p._id)).toEqual({ shippingClass: 'medium', shippingClassSource: 'manual' });
  });

  test('the client cannot forge the source', async () => {
    const p = await seedProduct();
    await put(p._id, token, { shippingClass: 'small', shippingClassSource: 'auto' });
    expect((await stored(p._id)).shippingClassSource).toBe('manual');
  });

  test('Automatic + an online size → suggested class, marked auto', async () => {
    const p = await seedProduct();
    const res = await put(p._id, token, { shippingClass: '', listedSize: JSON.stringify(SMALL_LISTED) });
    expect(res.status).toBe(200);
    expect(await stored(p._id)).toEqual({ shippingClass: 'small', shippingClassSource: 'auto' });
  });

  test('a measured packed box beats the online size in the suggestion', async () => {
    const p = await seedProduct();
    await put(p._id, token, { listedSize: JSON.stringify(SMALL_LISTED), shippingSize: JSON.stringify(LARGE_PACKED) });
    expect(await stored(p._id)).toEqual({ shippingClass: 'large', shippingClassSource: 'auto' });
  });

  test('an auto class follows a later size change', async () => {
    const p = await seedProduct({ listedSize: SMALL_LISTED, shippingClass: 'small', shippingClassSource: 'auto' });
    await put(p._id, token, { shippingSize: JSON.stringify(LARGE_PACKED) });
    expect(await stored(p._id)).toEqual({ shippingClass: 'large', shippingClassSource: 'auto' });
  });

  test('an admin-chosen class wins over a later size change', async () => {
    const p = await seedProduct({ shippingClass: 'medium', shippingClassSource: 'manual' });
    await put(p._id, token, { shippingSize: JSON.stringify(LARGE_PACKED) });
    expect(await stored(p._id)).toEqual({ shippingClass: 'medium', shippingClassSource: 'manual' });
  });

  test('an edit that touches neither class nor size leaves the class alone', async () => {
    const p = await seedProduct({ listedSize: SMALL_LISTED, shippingClass: 'xl', shippingClassSource: 'auto' });
    await put(p._id, token, { name: 'Renamed product' });
    expect(await stored(p._id)).toEqual({ shippingClass: 'xl', shippingClassSource: 'auto' });
  });

  test('Automatic with no size → not set, never a guess', async () => {
    const p = await seedProduct({ shippingClass: 'large', shippingClassSource: 'manual' });
    await put(p._id, token, { shippingClass: 'auto' });
    expect(await stored(p._id)).toEqual({ shippingClass: null, shippingClassSource: null });
  });
});

describe('PUT /products/:id — listedSize', () => {
  test('saves the online size, link and estimated flag', async () => {
    const p = await seedProduct();
    const res = await put(p._id, token, {
      listedSize: JSON.stringify({ ...SMALL_LISTED, weightKg: '0.8', sourceUrl: ' https://www.amazon.in/dp/X1 ', estimated: 'true' }),
    });
    expect(res.status).toBe(200);
    expect((await Product.findById(p._id).lean()).listedSize)
      .toEqual({ ...SMALL_LISTED, sourceUrl: 'https://www.amazon.in/dp/X1', estimated: true });
  });

  test.each([
    ['a non-http link', { sourceUrl: 'javascript:alert(1)' }],
    ['a weight above the cap', { weightKg: 9999 }],
    ['text for a number', { lengthCm: 'forty' }],
  ])('rejects %s with a 400', async (_l, bad) => {
    const p = await seedProduct({ listedSize: SMALL_LISTED });
    const res = await put(p._id, token, { listedSize: JSON.stringify({ ...SMALL_LISTED, ...bad }) });
    expect(res.status).toBe(400);
    expect((await Product.findById(p._id).lean()).listedSize).toMatchObject(SMALL_LISTED);
  });

  test('the online size is kept apart from the packed parcel size', async () => {
    const p = await seedProduct();
    await put(p._id, token, { listedSize: JSON.stringify(SMALL_LISTED) });
    const doc = await Product.findById(p._id).lean();
    expect(doc.shippingSize).toEqual({ weightKg: null, lengthCm: null, breadthCm: null, heightCm: null });
  });
});

describe('PATCH /products/shipping-class — bulk set', () => {
  test('sets one class on many products, manual, and audits it', async () => {
    const a = await seedProduct({ slug: 'bulk-a' });
    const b = await seedProduct({ slug: 'bulk-b', shippingClass: 'small', shippingClassSource: 'auto' });
    const res = await bulk(token, { productIds: [String(a._id), String(b._id)], shippingClass: 'medium' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requested: 2, updated: 2, unchanged: 0, notFound: [] });
    expect(await stored(a._id)).toEqual({ shippingClass: 'medium', shippingClassSource: 'manual' });
    expect(await stored(b._id)).toEqual({ shippingClass: 'medium', shippingClassSource: 'manual' });
    expect(await AuditLog.countDocuments({ action: 'SHIPPING_CLASS_SET' })).toBe(1);
  });

  test('a repeat click is a no-op (nothing written, nothing audited)', async () => {
    const a = await seedProduct({ slug: 'bulk-c', shippingClass: 'large', shippingClassSource: 'manual' });
    const res = await bulk(token, { productIds: [String(a._id)], shippingClass: 'large' });
    expect(res.body).toMatchObject({ updated: 0, unchanged: 1 });
    expect(await AuditLog.countDocuments({ action: 'SHIPPING_CLASS_SET' })).toBe(0);
  });

  test('Automatic puts each product on its own suggestion', async () => {
    const a = await seedProduct({ slug: 'bulk-d', listedSize: SMALL_LISTED, shippingClass: 'xl', shippingClassSource: 'manual' });
    const b = await seedProduct({ slug: 'bulk-e', shippingSize: LARGE_PACKED });
    const c = await seedProduct({ slug: 'bulk-f', shippingClass: 'medium', shippingClassSource: 'manual' });
    const res = await bulk(token, { productIds: [a._id, b._id, c._id].map(String), shippingClass: 'auto' });
    expect(res.body).toMatchObject({ updated: 3 });
    expect(await stored(a._id)).toEqual({ shippingClass: 'small', shippingClassSource: 'auto' });
    expect(await stored(b._id)).toEqual({ shippingClass: 'large', shippingClassSource: 'auto' });
    expect(await stored(c._id)).toEqual({ shippingClass: null, shippingClassSource: null });
  });

  test('unknown and deleted products are reported, not written', async () => {
    const gone = await seedProduct({ slug: 'bulk-g', deletedAt: new Date() });
    const missing = '64b000000000000000000000';
    const res = await bulk(token, { productIds: [String(gone._id), missing], shippingClass: 'small' });
    expect(res.body).toMatchObject({ updated: 0, notFound: [String(gone._id), missing] });
    // Product.find hides soft-deleted rows, so read the raw collection.
    expect((await Product.collection.findOne({ _id: gone._id })).shippingClass ?? null).toBeNull();
  });

  test.each([
    ['an unknown class', { productIds: ['64b000000000000000000000'], shippingClass: 'huge' }],
    ['no products', { productIds: [], shippingClass: 'small' }],
    ['a bad id', { productIds: ['nope'], shippingClass: 'small' }],
    ['too many products', { productIds: Array.from({ length: 201 }, (_, i) => `64b${String(i).padStart(21, '0')}`), shippingClass: 'small' }],
  ])('rejects %s with a 400', async (_l, body) => {
    expect((await bulk(token, body)).status).toBe(400);
  });

  test('needs a signed-in admin', async () => {
    const res = await request(app).patch('/api/v1/products/shipping-class').send({ productIds: ['64b000000000000000000000'], shippingClass: 'small' });
    // 401 (no token) or 403 (CSRF, checked first on a mutation) — never a 2xx.
    expect([401, 403]).toContain(res.status);
  });
});

describe('GET /products/admin/shipping-class — per-class list', () => {
  test('lists one class, keyset-paged, and "none" includes products saved before the field', async () => {
    for (let i = 0; i < 3; i++) await seedProduct({ slug: `list-s${i}`, shippingClass: 'small', shippingClassSource: 'manual' });
    await seedProduct({ slug: 'list-m', shippingClass: 'medium', shippingClassSource: 'manual' });
    const legacy = await seedProduct({ slug: 'list-legacy' });
    await Product.collection.updateOne({ _id: legacy._id }, { $unset: { shippingClass: '', shippingClassSource: '' } });

    const first = await asAdmin(request(app).get('/api/v1/products/admin/shipping-class?class=small&limit=2'), token);
    expect(first.status).toBe(200);
    expect(first.body.products).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await asAdmin(request(app).get(`/api/v1/products/admin/shipping-class?class=small&limit=2&cursor=${first.body.nextCursor}`), token);
    expect(second.body.products).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const seen = [...first.body.products, ...second.body.products].map((p) => p._id);
    expect(new Set(seen).size).toBe(3);

    const none = await asAdmin(request(app).get('/api/v1/products/admin/shipping-class?class=none'), token);
    expect(none.body.products.map((p) => p.slug)).toEqual(['list-legacy']);
  });

  test.each(['huge', ''])('rejects class=%p', async (cls) => {
    const res = await asAdmin(request(app).get(`/api/v1/products/admin/shipping-class?class=${cls}`), token);
    expect(res.status).toBe(400);
  });
});

describe('standard boxes per class', () => {
  const URL = '/api/v1/products/admin/shipping-class-boxes';
  const BOXES = {
    small: { weightKg: 1, lengthCm: 30, breadthCm: 20, heightCm: 15 },
    medium: { weightKg: 6, lengthCm: 55, breadthCm: 40, heightCm: 30 },
    large: { weightKg: 20, lengthCm: 120, breadthCm: 60, heightCm: 40 },
  };

  test('reads the starting defaults without creating a document', async () => {
    const res = await asAdmin(request(app).get(URL), token);
    expect(res.status).toBe(200);
    expect(res.body.boxes.medium).toEqual({ weightKg: 5, lengthCm: 50, breadthCm: 40, heightCm: 30 });
    expect(res.body.boxes.xl).toBeUndefined();
    expect(await ShippingClassConfig.countDocuments()).toBe(0);
  });

  test('saves edited boxes (numeric strings accepted) and reads them back', async () => {
    const res = await asAdmin(request(app).put(URL), token).send({ boxes: { ...BOXES, medium: { ...BOXES.medium, weightKg: '6' } } });
    expect(res.status).toBe(200);
    expect(res.body.boxes).toEqual(BOXES);
    expect((await asAdmin(request(app).get(URL), token)).body.boxes).toEqual(BOXES);
    expect(await AuditLog.countDocuments({ action: 'SHIPPING_CLASS_BOXES' })).toBe(1);
  });

  test.each([
    ['a missing box', { small: BOXES.small, medium: BOXES.medium }],
    ['a zero weight', { ...BOXES, small: { ...BOXES.small, weightKg: 0 } }],
    ['text for a size', { ...BOXES, large: { ...BOXES.large, heightCm: 'tall' } }],
  ])('rejects %s and keeps what was saved', async (_l, boxes) => {
    await asAdmin(request(app).put(URL), token).send({ boxes: BOXES });
    const res = await asAdmin(request(app).put(URL), token).send({ boxes });
    expect(res.status).toBe(400);
    expect((await asAdmin(request(app).get(URL), token)).body.boxes).toEqual(BOXES);
  });
});
