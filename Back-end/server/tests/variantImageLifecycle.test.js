/**
 * Integration tests — productImageController, per-model image lifecycle
 *
 * Strategy:
 *   - mongodb-memory-server gives us a real Mongo with actual Product documents.
 *   - Cloudinary helpers are fully mocked — no real HTTP calls.
 *   - We test via the Express app (PUT /api/v1/products/:id) so the full
 *     middleware stack (auth, asyncHandler, error handling) is exercised.
 *
 * What is pinned here: a photo uploaded FOR a model dies with that model, and
 * nothing else does. Each test is one way a model can stop existing — the whole
 * point of implementing this as an invariant rather than a delete handler is
 * that every one of these paths is covered by the same rule.
 *
 *   1. a model is removed from the list          → its photo is destroyed
 *   2. an ordinary gallery photo                 → survives regardless
 *   3. a photo two models share                  → survives until the last one
 *   4. a model photo promoted to primary         → adopted, never destroyed
 *   5. variable → simple (wipes every model)     → all model photos destroyed
 *   6. a partial update that never mentions models → touches nothing
 *
 * Plus the escape hatch: "keep in gallery" (`adoptImages`) lets the admin save a
 * model photo WITHOUT having to promote it to the product's primary image.
 *
 * ESM note: jest.mock() is CJS-only. In ESM mode we must use
 * jest.unstable_mockModule() BEFORE any dynamic import() of the mocked module.
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

const R2 = 'https://img.autobacsindia.com/autobacs/products';

/** A gallery entry. `owned` marks it as uploaded from a model row. */
const img = (id, { primary = false, owned = false } = {}) => ({
  url: `${R2}/${id}.jpg`,
  public_id: id,
  alt: id,
  isPrimary: primary,
  variantOwned: owned,
});

/** A variable product with a real gallery and models pointing into it. */
async function seedVariable({ images, variants }) {
  return Product.create({
    name: 'Wrangler Style LED Tail Lights',
    description: 'A test product description',
    price: 11900,
    priceMin: 11900,
    priceMax: 12500,
    stock: 'in',
    slug: `tail-lights-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    isActive: true,
    productType: 'variable',
    images,
    variants,
  });
}

/** public_ids handed to storage deletion across all calls in this test. */
const deletedIds = () => mockDeleteMany.mock.calls.flatMap(([ids]) => ids || []);

/** Send a full variable-product update. */
const putVariable = (product, adminToken, variants, extra = {}) =>
  asAdmin(request(app).put(`/api/v1/products/${product._id}`), adminToken).send({
    name: product.name,
    description: product.description,
    price: product.price,
    stock: product.stock,
    productType: 'variable',
    variants,
    ...extra,
  });

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


// ── Tests: a model photo dies with its model ────────────────────────────────

describe('PUT /products/:id — a model photo dies with its model', () => {
  test('1. removing a model destroys the photo uploaded for it', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('smoked', { owned: true }), img('clear', { owned: true })],
      variants: [
        { label: 'smoked lights', price: 12500, imageKey: 'smoked' },
        { label: 'clear lights', price: 11900, imageKey: 'clear' },
      ],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await putVariable(product, adminToken, [
      { label: 'smoked lights', price: 12500, imageKey: 'smoked' },
    ]);

    expect(res.status).toBe(200);

    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'smoked']);
    expect(deletedIds()).toContain('clear');
  });

  test('2. an ordinary gallery photo survives a model being removed', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('lifestyle'), img('clear', { owned: true })],
      variants: [
        { label: 'smoked lights', price: 12500 },
        { label: 'clear lights', price: 11900, imageKey: 'clear' },
      ],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    await putVariable(product, adminToken, [{ label: 'smoked lights', price: 12500 }]);

    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'lifestyle']);
    expect(deletedIds()).toContain('clear');
    expect(deletedIds()).not.toContain('lifestyle');
    expect(deletedIds()).not.toContain('pack');
  });

  test('3. a photo two models share survives until the LAST one goes', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('shared', { owned: true })],
      variants: [
        { label: 'smoked lights', price: 12500, imageKey: 'shared' },
        { label: 'clear lights', price: 11900, imageKey: 'shared' },
      ],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    // First model goes — the other still needs the photo.
    await putVariable(product, adminToken, [
      { label: 'clear lights', price: 11900, imageKey: 'shared' },
    ]);
    let saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'shared']);
    expect(deletedIds()).not.toContain('shared');

    // The last one goes — now nothing can reach it.
    await putVariable(saved, adminToken, [{ label: 'plain', price: 11900 }]);
    saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack']);
    expect(deletedIds()).toContain('shared');
  });

  test('4. a model photo promoted to primary is ADOPTED, never destroyed', async () => {
    const product = await seedVariable({
      images: [img('smoked', { primary: true, owned: true }), img('pack')],
      variants: [{ label: 'smoked lights', price: 12500, imageKey: 'smoked' }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    await putVariable(product, adminToken, [{ label: 'plain', price: 12500 }]);

    const saved = await Product.findById(product._id);
    // Kept as the product's face...
    expect(saved.images.map((i) => i.public_id)).toContain('smoked');
    expect(deletedIds()).not.toContain('smoked');
    // ...and demoted to an ordinary photo so it is never reconsidered.
    expect(saved.images.find((i) => i.public_id === 'smoked').variantOwned).toBe(false);
  });

  test('5. switching variable → simple destroys every model photo at once', async () => {
    const product = await seedVariable({
      images: [
        img('pack', { primary: true }),
        img('a', { owned: true }),
        img('b', { owned: true }),
        img('c', { owned: true }),
      ],
      variants: [
        { label: 'a', price: 100, imageKey: 'a' },
        { label: 'b', price: 200, imageKey: 'b' },
        { label: 'c', price: 300, imageKey: 'c' },
      ],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    ).send({
      name: product.name,
      description: product.description,
      price: 999,
      stock: 'in',
      productType: 'simple',
    });
    expect(res.status).toBe(200);

    const saved = await Product.findById(product._id);
    expect(saved.variants).toHaveLength(0);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack']);
    expect(deletedIds()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  test('6. a partial update that never mentions models touches nothing', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('smoked', { owned: true })],
      variants: [{ label: 'smoked lights', price: 12500, imageKey: 'smoked' }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    // A price-only edit. `variants` is absent from the payload, so the product's
    // CURRENT models are what the gallery must be judged against — reading an
    // absent field as "no models" would delete every model photo on the product.
    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    ).send({ price: 13000 });

    expect(res.status).toBe(200);
    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'smoked']);
    expect(saved.variants[0].imageKey).toBe('smoked');
    expect(deletedIds()).toHaveLength(0);
  });
});

// ── Tests: pointer integrity ────────────────────────────────────────────────

describe('PUT /products/:id — model pointer integrity', () => {
  test('removing a gallery image clears every model pointer at it', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('lifestyle')],
      variants: [{ label: 'smoked lights', price: 12500, imageKey: 'lifestyle' }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    await putVariable(
      product,
      adminToken,
      [{ label: 'smoked lights', price: 12500, imageKey: 'lifestyle' }],
      { deletePublicIds: ['lifestyle'] },
    );

    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack']);
    // Pointer pruned rather than left dangling.
    expect(saved.variants[0].imageKey).toBeUndefined();
  });

  test('a pointer at an image that never existed is dropped, not stored', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true })],
      variants: [{ label: 'smoked lights', price: 12500 }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    await putVariable(product, adminToken, [
      { label: 'smoked lights', price: 12500, imageKey: 'never-uploaded' },
    ]);

    const saved = await Product.findById(product._id);
    expect(saved.variants[0].imageKey).toBeUndefined();
  });

  test('a model with no pointer stays without one', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true })],
      variants: [{ label: 'smoked lights', price: 12500 }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    await putVariable(product, adminToken, [{ label: 'smoked lights', price: 12500 }]);

    const saved = await Product.findById(product._id);
    expect(saved.variants[0].imageKey).toBeUndefined();
    expect(saved.images).toHaveLength(1);
  });
});

// ── Tests: "keep in gallery" (adoptImages) ──────────────────────────────────

describe('PUT /products/:id — "keep in gallery" escape hatch', () => {
  test('an adopted photo survives its model without becoming primary', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('smoked', { owned: true })],
      variants: [{ label: 'smoked lights', price: 12500, imageKey: 'smoked' }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    // The model goes, but the admin asked to keep its photo.
    await putVariable(
      product,
      adminToken,
      [{ label: 'plain', price: 12500 }],
      { adoptImages: ['smoked'] },
    );

    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'smoked']);
    expect(deletedIds()).not.toContain('smoked');

    const kept = saved.images.find((i) => i.public_id === 'smoked');
    expect(kept.variantOwned).toBe(false);   // now an ordinary product photo
    expect(kept.isPrimary).toBe(false);      // WITHOUT hijacking the hero image
    expect(saved.images.find((i) => i.public_id === 'pack').isPrimary).toBe(true);
  });

  test('adoption is permanent — a later model deletion cannot reclaim it', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('smoked', { owned: true }), img('clear', { owned: true })],
      variants: [
        { label: 'smoked lights', price: 12500, imageKey: 'smoked' },
        { label: 'clear lights', price: 11900, imageKey: 'clear' },
      ],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    // Adopt one photo while both models still exist.
    await putVariable(
      product,
      adminToken,
      [
        { label: 'smoked lights', price: 12500, imageKey: 'smoked' },
        { label: 'clear lights', price: 11900, imageKey: 'clear' },
      ],
      { adoptImages: ['smoked'] },
    );

    // Now delete BOTH models. The adopted one must still survive.
    const mid = await Product.findById(product._id);
    await putVariable(mid, adminToken, [{ label: 'plain', price: 12500 }]);

    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'smoked']);
    expect(deletedIds()).toContain('clear');
    expect(deletedIds()).not.toContain('smoked');
  });

  test('adopting can only PRESERVE — a forged key never deletes anything', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('smoked', { owned: true })],
      variants: [{ label: 'smoked lights', price: 12500, imageKey: 'smoked' }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await putVariable(
      product,
      adminToken,
      [{ label: 'smoked lights', price: 12500, imageKey: 'smoked' }],
      { adoptImages: ['not-a-real-key', '', 42, null, 'pack'] },
    );

    expect(res.status).toBe(200);
    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'smoked']);
    expect(deletedIds()).toHaveLength(0);
  });

  test('adopting an ordinary gallery photo is a harmless no-op', async () => {
    const product = await seedVariable({
      images: [img('pack', { primary: true }), img('lifestyle')],
      variants: [{ label: 'smoked lights', price: 12500 }],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    await putVariable(
      product,
      adminToken,
      [{ label: 'smoked lights', price: 12500 }],
      { adoptImages: ['lifestyle'] },
    );

    const saved = await Product.findById(product._id);
    expect(saved.images.map((i) => i.public_id)).toEqual(['pack', 'lifestyle']);
    expect(saved.images.find((i) => i.public_id === 'lifestyle').variantOwned).toBe(false);
  });
});
