/**
 * POST/PUT/DELETE /brands — the uploaded logo must follow STORAGE_PROVIDER.
 *
 * THE BUG THIS GUARDS
 * --------------------
 * This route posts the file to us and uploaded the buffer itself, calling
 * `uploadToCloudinary` unconditionally. So it kept writing to Cloudinary for
 * six weeks after the provider was flipped to r2 — the "Accurate" brand logo
 * that was still served from Cloudinary in October was created here, in
 * September, by an admin who had no way to know.
 *
 * The unit tests in publicUploads.test.js pin the helper. This file pins the
 * ROUTE: that the helper is actually reached, that what lands in Mongo is the
 * R2 url and the R2 key (both — `public_id` is the delete handle, and a
 * document holding an R2 url beside a Cloudinary id deletes from the wrong
 * store), and that replacing a logo deletes the old object from whichever
 * store holds it rather than assuming the current provider.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';

const R2_HOST = 'https://img.autobacsindia.com';

// ── Storage is mocked: no bucket, no Cloudinary account, no network. ────────
/*
  Implementations are (re)applied in beforeEach, not here: jest.config.js sets
  `resetMocks: true`, which strips the implementation off every mock before
  each test. Defining behaviour at construction time leaves the stubs returning
  undefined by the time a test runs.
*/
const putObject = jest.fn();
const uploadToCloudinary = jest.fn();
const deleteObjects = jest.fn();
const deleteObject = jest.fn();
const listKeys = jest.fn();
const deleteManyFromCloudinary = jest.fn();

/*
  Every export is stubbed, not just the two under test: a partial factory makes
  the module graph fail to link, because app.js reaches other members of this
  module through unrelated routes.
*/
const r2Stub = {
  putObject, deleteObjects,
  deleteObject, getObjectBuffer: jest.fn(), getObjectHead: jest.fn(),
  headObject: jest.fn(), listKeys, objectExists: jest.fn(),
  presignGet: jest.fn(), presignPut: jest.fn(), resetClient: jest.fn(),
};
jest.unstable_mockModule('../services/storage/r2Provider.js', () => ({
  ...r2Stub, default: r2Stub,
}));

const cldStub = {
  uploadToCloudinary, deleteManyFromCloudinary,
  buildOptimizedUrl: jest.fn((u) => u), deleteFromCloudinary: jest.fn(),
  generateUploadSignature: jest.fn(), uploadManyToCloudinary: jest.fn(),
  uploadRawToCloudinary: jest.fn(),
};
jest.unstable_mockModule('../utils/cloudinaryHelpers.js', () => ({
  ...cldStub, default: cldStub,
}));

// queue/queues.js is deliberately NOT mocked: the app imports several of its
// exports, and a partial mock breaks the module graph. Variant generation is
// best-effort and enqueues nothing reachable in the test environment.

const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Brand } = await import('../models/Brand.js');
const dbHandler = await import('./db-handler.js');

const BASE = '/api/v1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG magic bytes
const admin = { name: 'Brand Admin', email: 'brandadmin@example.com', password: 'SecurePass123!' };

let adminToken;
let prevProvider;
let prevBase;

beforeAll(async () => { await dbHandler.connect(); });

afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

beforeEach(async () => {
  putObject.mockImplementation(async ({ key }) => ({
    key, bucket: 'autobacs-public', url: `${R2_HOST}/${key}`,
  }));
  uploadToCloudinary.mockImplementation(async () => ({
    secure_url: 'https://res.cloudinary.com/c/image/upload/v1/autobacs/brands/legacy.png',
    public_id: 'autobacs/brands/legacy',
  }));
  deleteObjects.mockImplementation(async () => ({ deleted: 0 }));
  deleteObject.mockImplementation(async () => {});
  // No generated variants in these fixtures.
  listKeys.mockImplementation(async () => []);
  deleteManyFromCloudinary.mockImplementation(async () => {});

  prevProvider = process.env.STORAGE_PROVIDER;
  prevBase = process.env.R2_PUBLIC_BASE_URL;
  process.env.R2_PUBLIC_BASE_URL = R2_HOST;

  const passwordHash = await bcrypt.hash(admin.password, await bcrypt.genSalt(10));
  await User.create({ name: admin.name, email: admin.email, passwordHash, role: 'admin' });

  const login = await request(app).post(`${BASE}/auth/login`)
    .send({ email: admin.email, password: admin.password });
  const cookie = (login.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  adminToken = cookie ? cookie.split(';')[0].slice('accessToken='.length) : login.body.accessToken;
});

afterEach(async () => {
  await dbHandler.clearDatabase();
  if (prevProvider === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = prevProvider;
  if (prevBase === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = prevBase;
});

const createBrand = (name) =>
  request(app).post(`${BASE}/brands`)
    .set('Authorization', `Bearer ${adminToken}`)
    .field('name', name)
    .attach('logo', PNG, { filename: 'logo.png', contentType: 'image/png' });

describe('STORAGE_PROVIDER=r2', () => {
  beforeEach(() => { process.env.STORAGE_PROVIDER = 'r2'; });

  test('a new logo is stored in R2 and NOT in Cloudinary', async () => {
    const res = await createBrand('Ironman 4x4');
    expect(res.status).toBe(201);

    expect(putObject).toHaveBeenCalledTimes(1);
    expect(uploadToCloudinary).not.toHaveBeenCalled();

    const saved = await Brand.findOne({ name: 'Ironman 4x4' });
    expect(saved.logo.url.startsWith(`${R2_HOST}/`)).toBe(true);
    // The delete handle must be the R2 KEY, not a Cloudinary-style id.
    expect(saved.logo.public_id).toMatch(/^autobacs\/brands\/[0-9a-f]{24}\.png$/);
    expect(saved.logo.url).toBe(`${R2_HOST}/${saved.logo.public_id}`);
  });

  test('replacing a legacy Cloudinary logo deletes from CLOUDINARY, not R2', async () => {
    // A brand whose logo predates the flip: Cloudinary url + Cloudinary id.
    const brand = await Brand.create({
      name: 'Bushranger',
      slug: 'bushranger',
      logo: {
        url: 'https://res.cloudinary.com/c/image/upload/v1/autobacs/brands/old.png',
        public_id: 'autobacs/brands/old',
      },
    });

    const res = await request(app).put(`${BASE}/brands/${brand._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Bushranger')
      .attach('logo', PNG, { filename: 'new.png', contentType: 'image/png' });
    expect(res.status).toBe(200);

    // New object written to R2…
    expect(putObject).toHaveBeenCalledTimes(1);
    // …and the OLD one removed from the store that actually holds it.
    expect(deleteManyFromCloudinary).toHaveBeenCalledWith(['autobacs/brands/old']);
    expect(deleteObjects).not.toHaveBeenCalled();

    const saved = await Brand.findById(brand._id);
    expect(saved.logo.url.startsWith(`${R2_HOST}/`)).toBe(true);
  });

  test('deleting a brand removes its R2 logo from R2', async () => {
    await createBrand('Lightforce');
    // Looked up by name rather than from the response body: the create
    // response shape is not what this test is pinning.
    const saved = await Brand.findOne({ name: 'Lightforce' });
    expect(saved.logo.public_id).toBeTruthy();
    putObject.mockClear(); deleteObject.mockClear(); deleteManyFromCloudinary.mockClear();

    const res = await request(app).delete(`${BASE}/brands/${saved._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // Originals are removed one key at a time (deleteObject); deleteObjects is
    // reserved for the generated variants, of which this fixture has none.
    expect(deleteObject).toHaveBeenCalledWith({ key: saved.logo.public_id, scope: 'public' });
    expect(deleteManyFromCloudinary).not.toHaveBeenCalled();
  });
});

describe('the old logo is deleted only AFTER the save commits', () => {
  beforeEach(() => { process.env.STORAGE_PROVIDER = 'r2'; });

  test('a failed save leaves the OLD logo intact', async () => {
    const brand = await Brand.create({
      name: 'Dobinsons',
      slug: 'dobinsons',
      logo: { url: `${R2_HOST}/autobacs/brands/old.png`, public_id: 'autobacs/brands/old.png' },
    });

    /*
      The save is made to fail directly. A duplicate-key collision would be
      more lifelike, but the route rejects those before it ever uploads, which
      is a different path from the one under test: this pins what happens when
      the write fails AFTER the new object is already in the bucket.
    */
    jest.spyOn(Brand.prototype, 'save').mockRejectedValueOnce(new Error('write failed'));

    const res = await request(app).put(`${BASE}/brands/${brand._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Dobinsons')
      .attach('logo', PNG, { filename: 'new.png', contentType: 'image/png' });

    expect(res.status).toBeGreaterThanOrEqual(400);

    // The new object was written (upload precedes the save) …
    expect(putObject).toHaveBeenCalledTimes(1);
    // … but the OLD one must survive, because the save never landed.
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteManyFromCloudinary).not.toHaveBeenCalled();

    const unchanged = await Brand.findById(brand._id);
    expect(unchanged.logo.public_id).toBe('autobacs/brands/old.png');
  });

  test('a successful save does delete the old logo', async () => {
    const brand = await Brand.create({
      name: 'Tough Dog',
      slug: 'tough-dog',
      logo: { url: `${R2_HOST}/autobacs/brands/old.png`, public_id: 'autobacs/brands/old.png' },
    });

    const res = await request(app).put(`${BASE}/brands/${brand._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Tough Dog')
      .attach('logo', PNG, { filename: 'new.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith({ key: 'autobacs/brands/old.png', scope: 'public' });
  });
});

describe('STORAGE_PROVIDER=cloudinary (rollback position)', () => {
  beforeEach(() => { process.env.STORAGE_PROVIDER = 'cloudinary'; });

  test('a new logo goes to Cloudinary and nothing reaches R2', async () => {
    const res = await createBrand('Profender');
    expect(res.status).toBe(201);

    expect(uploadToCloudinary).toHaveBeenCalledTimes(1);
    expect(putObject).not.toHaveBeenCalled();

    const saved = await Brand.findOne({ name: 'Profender' });
    expect(saved.logo.url).toContain('res.cloudinary.com');
    expect(saved.logo.public_id).toBe('autobacs/brands/legacy');
  });
});
