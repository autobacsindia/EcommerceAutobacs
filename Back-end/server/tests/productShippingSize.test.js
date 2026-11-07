/**
 * Product parcel size (shippingSize) — the boxed weight + size Shiprocket quotes on.
 * Through the real PUT/POST /products routes so parsing, normalisation and the
 * schema limits are exercised together. Harness copied from productImageController.test.js.
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


const SIZE = { weightKg: 2.5, lengthCm: 40, breadthCm: 30, heightCm: 20 };

describe('PUT /products/:id — shippingSize', () => {
  test('saves a size sent as a JSON string (multipart form) and coerces numeric strings', async () => {
    const product = await seedProduct();
    const token = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).put(`/api/v1/products/${product._id}`), token)
      .send({ shippingSize: JSON.stringify({ weightKg: '2.5', lengthCm: 40, breadthCm: '30', heightCm: 20 }) });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id).lean();
    expect(inDb.shippingSize).toEqual(SIZE);
  });

  test('an update that does not mention shippingSize leaves the stored size alone', async () => {
    const product = await seedProduct({ shippingSize: SIZE });
    const token = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).put(`/api/v1/products/${product._id}`), token)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect((await Product.findById(product._id).lean()).shippingSize).toEqual(SIZE);
  });

  test('blank fields clear to null ("not measured yet"), never to a guessed 0', async () => {
    const product = await seedProduct({ shippingSize: SIZE });
    const token = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).put(`/api/v1/products/${product._id}`), token)
      .send({ shippingSize: JSON.stringify({ weightKg: 3, lengthCm: '', breadthCm: null }) });

    expect(res.status).toBe(200);
    expect((await Product.findById(product._id).lean()).shippingSize)
      .toEqual({ weightKg: 3, lengthCm: null, breadthCm: null, heightCm: null });
  });

  test.each([
    ['weight above the 500 kg cap (grams typed as kg)', { weightKg: 2500 }],
    ['zero weight', { weightKg: 0 }],
    ['negative length', { lengthCm: -5 }],
    ['non-numeric text', { heightCm: 'twenty' }],
  ])('rejects %s with a 400 and keeps the stored size', async (_label, bad) => {
    const product = await seedProduct({ shippingSize: SIZE });
    const token = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).put(`/api/v1/products/${product._id}`), token)
      .send({ shippingSize: JSON.stringify({ ...SIZE, ...bad }) });

    expect(res.status).toBe(400);
    expect((await Product.findById(product._id).lean()).shippingSize).toEqual(SIZE);
  });

  test('unknown keys are dropped', async () => {
    const product = await seedProduct();
    const token = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).put(`/api/v1/products/${product._id}`), token)
      .send({ shippingSize: JSON.stringify({ ...SIZE, volumetricKg: 99, $where: 'x' }) });

    expect(res.status).toBe(200);
    expect((await Product.findById(product._id).lean()).shippingSize).toEqual(SIZE);
  });

  test('the admin fetch returns the size so the editor can show it', async () => {
    const product = await seedProduct({ shippingSize: SIZE });
    const token = await getAdminToken();

    const res = await asAdmin(request(app).get(`/api/v1/products/${product._id}/admin-fetch`), token);

    expect(res.status).toBe(200);
    const body = res.body.product || res.body.data || res.body;
    expect(body.shippingSize).toEqual(SIZE);
  });
});

describe('POST /products — shippingSize', () => {
  test('a new product is created with its size', async () => {
    const token = await getAdminToken();
    const Category = (await import('../models/Category.js')).default;
    const category = await Category.create({ name: 'Roof boxes', slug: `roof-boxes-${Date.now()}` });
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).post('/api/v1/products'), token)
      .send({
        name: 'Roof box', description: 'A large car roof box', price: 15000, stock: 'in',
        categories: JSON.stringify([String(category._id)]),
        uploadedImages: JSON.stringify([{ url: 'https://res.cloudinary.com/test-cloud/image/upload/r.jpg', public_id: 'autobacs/r' }]),
        shippingSize: JSON.stringify({ weightKg: 18, lengthCm: 190, breadthCm: 80, heightCm: 40 }),
      });

    expect(res.status).toBe(201);
    const inDb = await Product.findOne({ name: 'Roof box' }).lean();
    expect(inDb.shippingSize).toEqual({ weightKg: 18, lengthCm: 190, breadthCm: 80, heightCm: 40 });
  });

  test('a product created without a size has every field null', async () => {
    const created = await seedProduct();
    expect(created.toObject().shippingSize)
      .toEqual({ weightKg: null, lengthCm: null, breadthCm: null, heightCm: null });
  });
});
