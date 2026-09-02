/**
 * Integration tests — productImageController (Cloudinary deferred-delete path)
 *
 * Strategy:
 *   - mongodb-memory-server gives us a real Mongo with actual Product documents.
 *   - Cloudinary helpers are fully mocked — no real HTTP calls.
 *   - We test via the Express app (PUT /api/v1/products/:id) so the full
 *     middleware stack (auth, asyncHandler, error handling) is exercised.
 *
 * Key scenarios:
 *   1. deletePublicIds deferred-delete: DB saved first, Cloudinary cleanup after.
 *   2. replaceImages=true: old images deleted post-save, new ones kept.
 *   3. DB failure rollback: newly uploaded IDs deleted, old ones untouched.
 *   4. Invalid deletePublicIds values are filtered (non-strings ignored).
 *   5. POST /products create rollback: DB fail → uploaded IDs rolled back.
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

// ── Tests: PUT /products/:id — deferred deletePublicIds ──────────────────────

describe('PUT /products/:id — deletePublicIds deferred delete', () => {
  test('deletePublicIds → DB saved first, then deleteManyFromCloudinary called', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();

    // No new file uploads in this request
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:           product.name,
        description:    product.description,
        price:          product.price,
        stock:          product.stock,
        deletePublicIds: JSON.stringify(['autobacs/old1']),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // deleteMany must have been called with the staged ID
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.arrayContaining(['autobacs/old1'])
    );

    // And it must have been called AFTER save (product still exists in DB)
    const inDb = await Product.findById(product._id);
    expect(inDb).not.toBeNull();

    // REGRESSION: the DB gallery must lose the image too. This previously only
    // deleted the Cloudinary asset and left the URL on the product, so the
    // storefront rendered a dead image that came back on every form reload.
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old2']);
    // The removed image was primary — the survivor must be promoted, or the
    // product ends up with no thumbnail anywhere.
    expect(inDb.images.filter((i) => i.isPrimary)).toHaveLength(1);
    expect(inDb.images[0].isPrimary).toBe(true);
  });

  test('removing an image while ALSO uploading a new one still drops it from the DB', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        // Append mode used to rebuild the gallery from the DB copy, which still
        // contained the removed image — so the removal was silently discarded.
        deletePublicIds: JSON.stringify(['autobacs/old1']),
        uploadedImages:  JSON.stringify([
          { url: 'https://res.cloudinary.com/test-cloud/image/upload/new1.jpg', public_id: 'autobacs/new1' },
        ]),
      });

    expect(res.status).toBe(200);

    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old2', 'autobacs/new1']);
    expect(mockDeleteMany).toHaveBeenCalledWith(expect.arrayContaining(['autobacs/old1']));
    // The image that survived must NOT be swept up in the cleanup.
    expect(mockDeleteMany.mock.calls.flat(2)).not.toContain('autobacs/old2');
  });

  test('a public_id still present in the saved gallery is never deleted from Cloudinary', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    // A forged / stale payload asks us to delete an id belonging to another
    // product. Cleanup is derived from what actually persisted, so it can't
    // reach anything this product never referenced.
    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        deletePublicIds: JSON.stringify(['autobacs/someone-elses-asset']),
      });

    expect(res.status).toBe(200);

    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old1', 'autobacs/old2']);
    expect(mockDeleteMany.mock.calls.flat(2)).not.toContain('autobacs/someone-elses-asset');
  });

  test('a migrated image with no public_id can be removed by its URL', async () => {
    // WooCommerce-migrated rows carry no public_id, so they key off their URL.
    // Matching removals strictly on public_id left them un-removable: the tile
    // vanished from the form and came straight back on the next load.
    const product = await seedProduct({
      images: [
        { url: 'https://autobacsindia.com/wp-content/legacy.jpg', alt: 'legacy', isPrimary: true },
        { url: 'https://cdn/old2.jpg', public_id: 'autobacs/old2', alt: 'old2', isPrimary: false },
      ],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        deletePublicIds: JSON.stringify(['https://autobacsindia.com/wp-content/legacy.jpg']),
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.url)).toEqual(['https://cdn/old2.jpg']);
    // Nothing to clean up on Cloudinary — the legacy image was never ours.
    expect(mockDeleteMany.mock.calls.flat(2)).not.toContain('autobacs/old2');
  });

  test('a migrated image with no public_id can be sequenced by its URL', async () => {
    const product = await seedProduct({
      images: [
        { url: 'https://autobacsindia.com/wp-content/legacy.jpg', alt: 'legacy', isPrimary: true },
        { url: 'https://cdn/old2.jpg', public_id: 'autobacs/old2', alt: 'old2', isPrimary: false },
      ],
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:         product.name,
        description:  product.description,
        price:        product.price,
        stock:        product.stock,
        imageOrder:   JSON.stringify(['autobacs/old2', 'https://autobacsindia.com/wp-content/legacy.jpg']),
        primaryImage: 'autobacs/old2',
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.url))
      .toEqual(['https://cdn/old2.jpg', 'https://autobacsindia.com/wp-content/legacy.jpg']);
    expect(inDb.images.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['autobacs/old2']);
  });

  test('removing every image empties the gallery and cleans up all assets', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        deletePublicIds: JSON.stringify(['autobacs/old1', 'autobacs/old2']),
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images).toHaveLength(0);
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.arrayContaining(['autobacs/old1', 'autobacs/old2'])
    );
  });

  test('a malformed deletePublicIds payload is ignored, not fatal', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        deletePublicIds: '{"not":"an array"}',
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images).toHaveLength(2);
  });
});

// ── Tests: PUT /products/:id — gallery sequence + primary ────────────────────

describe('PUT /products/:id — imageOrder / primaryImage', () => {
  test('imageOrder rewrites the stored gallery sequence', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        imageOrder:  JSON.stringify(['autobacs/old2', 'autobacs/old1']),
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old2', 'autobacs/old1']);
  });

  test('newly uploaded images can be sequenced ahead of existing ones', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        uploadedImages: JSON.stringify([
          { url: 'https://res.cloudinary.com/test-cloud/image/upload/new1.jpg', public_id: 'autobacs/new1' },
        ]),
        imageOrder: JSON.stringify(['autobacs/new1', 'autobacs/old1', 'autobacs/old2']),
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.public_id))
      .toEqual(['autobacs/new1', 'autobacs/old1', 'autobacs/old2']);
  });

  test('primaryImage marks exactly one image, regardless of position', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:         product.name,
        description:  product.description,
        price:        product.price,
        stock:        product.stock,
        primaryImage: 'autobacs/old2',
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    // Order untouched, but the star moved to the second tile.
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old1', 'autobacs/old2']);
    expect(inDb.images.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['autobacs/old2']);
  });

  test('an order omitting an image appends it rather than dropping it', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:        product.name,
        description: product.description,
        price:       product.price,
        stock:       product.stock,
        // Stale order from a tab that never saw old2. Sequencing must not
        // double as deletion — that channel is deletePublicIds alone.
        imageOrder:  JSON.stringify(['autobacs/old1']),
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old1', 'autobacs/old2']);
    expect(mockDeleteMany.mock.calls.flat(2)).not.toContain('autobacs/old2');
  });

  test('an unknown key in imageOrder or primaryImage is ignored', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:         product.name,
        description:  product.description,
        price:        product.price,
        stock:        product.stock,
        imageOrder:   JSON.stringify(['autobacs/ghost', 'autobacs/old2']),
        primaryImage: 'autobacs/ghost',
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old2', 'autobacs/old1']);
    // Primary fell back to the first surviving image, never left unset.
    expect(inDb.images.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['autobacs/old2']);
  });

  test('a partial update that never mentions images leaves the gallery intact', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({ name: 'Renamed Product', price: 1499 });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.name).toBe('Renamed Product');
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/old1', 'autobacs/old2']);
    expect(inDb.images.filter((i) => i.isPrimary)).toHaveLength(1);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  test('replaceImages with NO new images leaves the gallery and assets alone', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:          product.name,
        description:   product.description,
        price:         product.price,
        stock:         product.stock,
        replaceImages: 'true',
      });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    // Wiping here would strand the product with no images AND delete both
    // assets — the gallery must survive a replace that replaces nothing.
    expect(inDb.images).toHaveLength(2);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  test('non-string values in deletePublicIds are filtered out', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .send({
        name:           product.name,
        description:    product.description,
        price:          product.price,
        stock:          product.stock,
        // Mix of valid string and invalid types
        deletePublicIds: JSON.stringify([null, 123, '', 'valid/id']),
      });

    expect(res.status).toBe(200);

    if (mockDeleteMany.mock.calls.length > 0) {
      // Only 'valid/id' should reach Cloudinary
      const calledWith = mockDeleteMany.mock.calls[0][0];
      expect(calledWith).toContain('valid/id');
      expect(calledWith).not.toContain(null);
      expect(calledWith).not.toContain(123);
      // Empty string is also filtered
      expect(calledWith.filter((v) => v === '')).toHaveLength(0);
    }
  });
});

// ── Tests: PUT /products/:id — replaceImages ──────────────────────────────────

describe('PUT /products/:id — replaceImages=true', () => {
  test('old public_ids deleted, new ones NOT deleted', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();

    // Mock upload of 1 new image
    mockUploadMany.mockResolvedValue([
      { secure_url: 'https://cdn/new1.jpg', public_id: 'autobacs/new1' },
    ]);
    mockDeleteMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .attach('images', Buffer.from([0xFF, 0xD8, 0xFF, 0x00, 0x01, 0x02, 0x03, 0x04,
                                     0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C,
                                     0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12]), 'new.jpg')
      .field('name',          product.name)
      .field('description',   product.description)
      .field('price',         String(product.price))
      .field('stock',         String(product.stock))
      .field('replaceImages', 'true');

    expect(res.status).toBe(200);

    // deleteManyFromCloudinary must have been called with the OLD ids
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.arrayContaining(['autobacs/old1', 'autobacs/old2'])
    );

    // The new image must still be in the product's images
    const updated = await Product.findById(product._id);
    expect(updated.images.map((i) => i.public_id)).toContain('autobacs/new1');
    // Old images should be gone from DB
    expect(updated.images.map((i) => i.public_id)).not.toContain('autobacs/old1');
  });
});

// ── Tests: PUT /products/:id — DB failure rollback ───────────────────────────

describe('PUT /products/:id — DB failure rolls back new uploads', () => {
  test('if DB save throws, newly uploaded IDs are deleted (rollback), old ones are NOT', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();

    // New upload succeeds
    mockUploadMany.mockResolvedValue([
      { secure_url: 'https://cdn/newX.jpg', public_id: 'autobacs/newX' },
    ]);
    mockDeleteMany.mockResolvedValue([]);

    // Force findByIdAndUpdate to throw — mock returns a thenable with .populate()
    // that rejects, mirroring the Mongoose Query chain (.findByIdAndUpdate().populate()).
    const findByIdAndUpdateSpy = jest
      .spyOn(Product, 'findByIdAndUpdate')
      .mockReturnValueOnce({
        populate: () => Promise.reject(new Error('Simulated DB failure')),
      });

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    )
      .attach('images', Buffer.from([0xFF, 0xD8, 0xFF, 0x00, 0x01, 0x02, 0x03, 0x04,
                                     0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C,
                                     0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12]), 'img.jpg')
      .field('name',        product.name)
      .field('description', product.description)
      .field('price',       String(product.price))
      .field('stock',       String(product.stock));

    // Should fail (DB threw)
    expect(res.status).toBeGreaterThanOrEqual(500);

    // Rollback: newly uploaded public_id must be deleted
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.arrayContaining(['autobacs/newX'])
    );

    // Old images must NOT have been touched during rollback
    const rollbackCall = mockDeleteMany.mock.calls[0][0];
    expect(rollbackCall).not.toContain('autobacs/old1');
    expect(rollbackCall).not.toContain('autobacs/old2');

    findByIdAndUpdateSpy.mockRestore();
  });
});

// ── Tests: POST /products — create rollback ───────────────────────────────────

describe('POST /products — gallery sequence + primary', () => {
  test('upload order is preserved and primaryImage picks the thumbnail', async () => {
    const adminToken = await getAdminToken();
    const Category = (await import('../models/Category.js')).default;
    const category = await Category.create({ name: 'Test Cat', slug: `test-cat-${Date.now()}` });
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).post('/api/v1/products'), adminToken).send({
      name:        'Gallery Product',
      description: 'A product with an arranged gallery',
      price:       499,
      stock:       'in',
      categories:  JSON.stringify([String(category._id)]),
      uploadedImages: JSON.stringify([
        { url: 'https://res.cloudinary.com/test-cloud/image/upload/a.jpg', public_id: 'autobacs/a' },
        { url: 'https://res.cloudinary.com/test-cloud/image/upload/b.jpg', public_id: 'autobacs/b' },
        { url: 'https://res.cloudinary.com/test-cloud/image/upload/c.jpg', public_id: 'autobacs/c' },
      ]),
      primaryImage: 'autobacs/b',
    });

    expect(res.status).toBe(201);
    const inDb = await Product.findById(res.body.product._id);
    expect(inDb.images.map((i) => i.public_id)).toEqual(['autobacs/a', 'autobacs/b', 'autobacs/c']);
    // The starred image is primary even though it is not first.
    expect(inDb.images.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['autobacs/b']);
  });

  test('with no primaryImage the first image is primary', async () => {
    const adminToken = await getAdminToken();
    const Category = (await import('../models/Category.js')).default;
    const category = await Category.create({ name: 'Test Cat', slug: `test-cat-${Date.now()}` });
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(request(app).post('/api/v1/products'), adminToken).send({
      name:        'Default Primary Product',
      description: 'A product with no explicit primary',
      price:       499,
      stock:       'in',
      categories:  JSON.stringify([String(category._id)]),
      uploadedImages: JSON.stringify([
        { url: 'https://res.cloudinary.com/test-cloud/image/upload/a.jpg', public_id: 'autobacs/a' },
        { url: 'https://res.cloudinary.com/test-cloud/image/upload/b.jpg', public_id: 'autobacs/b' },
      ]),
    });

    expect(res.status).toBe(201);
    const inDb = await Product.findById(res.body.product._id);
    expect(inDb.images.filter((i) => i.isPrimary).map((i) => i.public_id)).toEqual(['autobacs/a']);
  });
});

describe('POST /products — atomic rollback on DB failure', () => {
  test('if DB save fails after upload, uploaded public_ids are deleted', async () => {
    const adminToken = await getAdminToken();

    // Uploads succeed
    mockUploadMany.mockResolvedValue([
      { secure_url: 'https://cdn/rollback1.jpg', public_id: 'autobacs/rollback1' },
    ]);
    mockDeleteMany.mockResolvedValue([]);

    // Force Product.save to throw on the new instance
    const saveSpy = jest
      .spyOn(Product.prototype, 'save')
      .mockRejectedValueOnce(new Error('Simulated create failure'));

    const res = await asAdmin(
      request(app).post('/api/v1/products'),
      adminToken,
    )
      .attach('images', Buffer.from([0xFF, 0xD8, 0xFF, 0x00, 0x01, 0x02, 0x03, 0x04,
                                     0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C,
                                     0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12]), 'img.jpg')
      .field('name',        'Rollback Product')
      .field('description', 'Product that should roll back')
      .field('price',       '500')
      .field('stock',       'low')
      .field('categories',  JSON.stringify(['507f1f77bcf86cd799439011']))
      .field('slug',        `rollback-${Date.now()}`);

    expect(res.status).toBeGreaterThanOrEqual(500);

    // Rollback: the uploaded public_id must be cleaned up
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.arrayContaining(['autobacs/rollback1'])
    );

    saveSpy.mockRestore();
  });
});

// ── Tests: variable-product variants (parseProductFields aggregate path) ──────
// The update path uses findByIdAndUpdate (bypasses the model's pre('validate')
// hook), so parseProductFields must derive priceMin/priceMax + parent price/stock
// itself. These exercise that branch end-to-end.
describe('PUT /products/:id — variable product variants', () => {
  test('persists variants and derives priceMin/priceMax, parent price=min, stock', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    ).send({
      name:        product.name,
      description: product.description,
      productType: 'variable',
      variants: [
        { label: 'Model A', price: 7299,  stock: 'in',  attributes: [{ name: 'models', option: 'Model A' }] },
        { label: 'Model B', price: 10499, stock: 'out', attributes: [{ name: 'models', option: 'Model B' }] },
      ],
    });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.productType).toBe('variable');
    expect(inDb.variants).toHaveLength(2);
    expect(inDb.priceMin).toBe(7299);
    expect(inDb.priceMax).toBe(10499);
    expect(inDb.price).toBe(7299);   // parent mirrors the cheapest variant
    expect(inDb.stock).toBe('in');   // Model A is in stock → parent in stock
    expect(inDb.variants[0]._id).toBeDefined();
  });

  test('blank-label variants are dropped', async () => {
    const product = await seedProduct();
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    ).send({
      name:        product.name,
      description: product.description,
      productType: 'variable',
      variants: [
        { label: 'Good', price: 100, stock: 'in' },
        { label: '',     price: 200, stock: 'in' }, // dropped
      ],
    });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.variants).toHaveLength(1);
    expect(inDb.variants[0].label).toBe('Good');
  });

  test('switching variable → simple clears variants and collapses the range', async () => {
    const product = await seedProduct({
      productType: 'variable',
      variants: [{ label: 'M', price: 500, stock: 'in', attributes: [] }],
      priceMin: 500, priceMax: 500, price: 500,
    });
    const adminToken = await getAdminToken();
    mockUploadMany.mockResolvedValue([]);

    const res = await asAdmin(
      request(app).put(`/api/v1/products/${product._id}`),
      adminToken,
    ).send({
      name:        product.name,
      description: product.description,
      productType: 'simple',
      price:       1499,
      stock:       'in',
    });

    expect(res.status).toBe(200);
    const inDb = await Product.findById(product._id);
    expect(inDb.productType).toBe('simple');
    expect(inDb.variants).toHaveLength(0);
    expect(inDb.priceMin).toBe(1499);
    expect(inDb.priceMax).toBe(1499);
  });

  // ── Storage migration: R2 refs must be accepted ─────────────────────────────
  /*
    PRODUCTION REGRESSION (2026-09-02). normalizePreUploaded hard-matched
    `https://res.cloudinary.com/`, so the moment STORAGE_PROVIDER flipped to r2
    every uploaded image ref was dropped. The bytes were safely in the bucket and
    the product saved with a 200, so the admin was told "product updated
    successfully" and no image ever appeared. These tests fail against that code.
  */
  describe('pre-uploaded image refs across both storage providers', () => {
    const R2_BASE = 'https://img.autobacsindia.com';
    let prevBase;
    let prevCloud;
    beforeEach(() => {
      prevBase = process.env.R2_PUBLIC_BASE_URL;
      process.env.R2_PUBLIC_BASE_URL = R2_BASE;
      /*
        The suite does not otherwise set a cloud name, and the tenant check is
        skipped when it is absent — so without this the "another tenant" case
        below passes vacuously. Production always has it set.
      */
      prevCloud = process.env.CLOUDINARY_CLOUD_NAME;
      process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    });
    afterEach(() => {
      if (prevBase === undefined) delete process.env.R2_PUBLIC_BASE_URL;
      else process.env.R2_PUBLIC_BASE_URL = prevBase;
      if (prevCloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
      else process.env.CLOUDINARY_CLOUD_NAME = prevCloud;
    });

    const put = async (product, token, uploadedImages) => asAdmin(
      request(app).put(`/api/v1/products/${product._id}`), token,
    ).send({
      name: product.name,
      description: product.description,
      price: product.price,
      stock: product.stock,
      uploadedImages: JSON.stringify(uploadedImages),
    });

    test('an R2 ref is attached to the product', async () => {
      const product = await seedProduct();
      const token = await getAdminToken();
      mockUploadMany.mockResolvedValue([]);

      const res = await put(product, token, [
        { url: `${R2_BASE}/autobacs/products/abc123.jpg`, public_id: 'autobacs/products/abc123.jpg' },
      ]);

      expect(res.status).toBe(200);
      const inDb = await Product.findById(product._id);
      expect(inDb.images.map((i) => i.public_id)).toContain('autobacs/products/abc123.jpg');
    });

    test('a Cloudinary ref still works — both stores hold live assets', async () => {
      const product = await seedProduct();
      const token = await getAdminToken();
      mockUploadMany.mockResolvedValue([]);

      const res = await put(product, token, [
        { url: 'https://res.cloudinary.com/test-cloud/image/upload/new9.jpg', public_id: 'autobacs/new9' },
      ]);

      expect(res.status).toBe(200);
      const inDb = await Product.findById(product._id);
      expect(inDb.images.map((i) => i.public_id)).toContain('autobacs/new9');
    });

    test('a mixed batch attaches both', async () => {
      const product = await seedProduct();
      const token = await getAdminToken();
      mockUploadMany.mockResolvedValue([]);

      const res = await put(product, token, [
        { url: `${R2_BASE}/autobacs/products/r2one.jpg`, public_id: 'autobacs/products/r2one.jpg' },
        { url: 'https://res.cloudinary.com/test-cloud/image/upload/cl.jpg', public_id: 'autobacs/cl' },
      ]);

      expect(res.status).toBe(200);
      const inDb = await Product.findById(product._id);
      const ids = inDb.images.map((i) => i.public_id);
      expect(ids).toEqual(expect.arrayContaining(['autobacs/products/r2one.jpg', 'autobacs/cl']));
    });

    /*
      The silent-drop behaviour is what made the original bug invisible. A ref we
      refuse must FAIL the request: the bytes are already in a bucket, and
      reporting success loses the admin's intent with nothing to show for it.
    */
    test('a foreign host is REJECTED with a 4xx, not silently dropped', async () => {
      const product = await seedProduct();
      const token = await getAdminToken();
      mockUploadMany.mockResolvedValue([]);
      const before = (await Product.findById(product._id)).images.length;

      const res = await put(product, token, [
        { url: 'https://evil.example.com/autobacs/products/x.jpg', public_id: 'autobacs/products/x.jpg' },
      ]);

      expect(res.status).toBe(400);
      const inDb = await Product.findById(product._id);
      expect(inDb.images).toHaveLength(before);
    });

    test('another tenant\'s Cloudinary cloud is REJECTED', async () => {
      const product = await seedProduct();
      const token = await getAdminToken();
      mockUploadMany.mockResolvedValue([]);

      // res.cloudinary.com serves every tenant, so the host alone proves nothing.
      const res = await put(product, token, [
        { url: 'https://res.cloudinary.com/someone-else/image/upload/x.jpg', public_id: 'autobacs/x' },
      ]);

      expect(res.status).toBe(400);
    });

    /*
      With no delivery host configured the upload target's url is '', which is
      how a misconfigured deploy reproduces the same silent loss by another route.
    */
    test('an R2 ref is REJECTED when R2_PUBLIC_BASE_URL is unset', async () => {
      delete process.env.R2_PUBLIC_BASE_URL;
      const product = await seedProduct();
      const token = await getAdminToken();
      mockUploadMany.mockResolvedValue([]);

      const res = await put(product, token, [
        { url: `${R2_BASE}/autobacs/products/abc123.jpg`, public_id: 'autobacs/products/abc123.jpg' },
      ]);

      expect(res.status).toBe(400);
    });
  });

});
