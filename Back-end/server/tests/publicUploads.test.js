/**
 * services/storage/publicUploads.js — provider-aware server-side image upload.
 *
 * THE BUG THIS GUARDS
 * --------------------
 * Four screens (brand logo, vehicle photo, category image, customer avatar)
 * POST the file to us rather than using the signed direct-upload route, and
 * each called `uploadToCloudinary` unconditionally. They therefore kept writing
 * to Cloudinary for six weeks after `STORAGE_PROVIDER` was flipped to r2 — the
 * five stragglers still served from Cloudinary in October were created exactly
 * this way, every one of them from one of these four screens.
 *
 * So the contract under test is: the provider is read PER CALL, the return
 * shape is identical either way (`{ secure_url, public_id }` — what every call
 * site destructures), and nothing is written before the cheap failures have
 * been ruled out. That last part matters: bytes written under a key no document
 * ends up referencing are unreachable by any cleanup sweep, which is how the
 * careers path accumulated 1.68 GB of orphans.
 *
 * ESM note: jest.mock() is CJS-only; the module graph is mocked with
 * jest.unstable_mockModule() before any dynamic import().
 */

import { jest } from '@jest/globals';

const R2_HOST = 'https://img.autobacsindia.com';

const putObject = jest.fn();
const enqueueVariantGeneration = jest.fn();
const uploadToCloudinary = jest.fn();

jest.unstable_mockModule('../services/storage/r2Provider.js', () => ({
  putObject,
  // The module exports more, but only putObject is reachable from this unit.
  headObject: jest.fn(),
  deleteObject: jest.fn(),
  deleteObjects: jest.fn(),
  presignPut: jest.fn(),
  listKeys: jest.fn(),
}));

jest.unstable_mockModule('../queue/queues.js', () => ({
  enqueueVariantGeneration,
}));

jest.unstable_mockModule('../utils/cloudinaryHelpers.js', () => ({
  uploadToCloudinary,
  deleteFromCloudinary: jest.fn(),
  deleteManyFromCloudinary: jest.fn(),
  generateUploadSignature: jest.fn(),
  uploadRawToCloudinary: jest.fn(),
  uploadManyToCloudinary: jest.fn(),
}));

const { putPublicAsset } = await import('../services/storage/publicUploads.js');

const BUF = Buffer.from('fake-image-bytes');
let prevProvider;
let prevBase;

beforeEach(() => {
  jest.clearAllMocks();
  prevProvider = process.env.STORAGE_PROVIDER;
  prevBase = process.env.R2_PUBLIC_BASE_URL;
  process.env.R2_PUBLIC_BASE_URL = R2_HOST;
  putObject.mockImplementation(async ({ key }) => ({
    key, bucket: 'autobacs-public', url: `${R2_HOST}/${key}`,
  }));
  uploadToCloudinary.mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/c/image/upload/v1/autobacs/brands/x.png',
    public_id: 'autobacs/brands/x',
  });
});

afterEach(() => {
  if (prevProvider === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = prevProvider;
  if (prevBase === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = prevBase;
});

describe('STORAGE_PROVIDER routes the write', () => {
  test('r2 → writes to the public bucket, never to Cloudinary', async () => {
    process.env.STORAGE_PROVIDER = 'r2';

    const res = await putPublicAsset(BUF, {
      folder: 'autobacs/brands',
      contentType: 'image/png',
    });

    expect(uploadToCloudinary).not.toHaveBeenCalled();
    expect(putObject).toHaveBeenCalledTimes(1);
    const call = putObject.mock.calls[0][0];
    expect(call.scope).toBe('public');
    expect(call.body).toBe(BUF);
    expect(call.contentType).toBe('image/png');
    expect(call.cacheControl).toMatch(/immutable/);
    expect(call.key).toMatch(/^autobacs\/brands\/[0-9a-f]{24}\.png$/);

    expect(res.provider).toBe('r2');
    expect(res.public_id).toBe(call.key);
    expect(res.secure_url).toBe(`${R2_HOST}/${call.key}`);
  });

  test('cloudinary → the legacy helper, and R2 is untouched', async () => {
    process.env.STORAGE_PROVIDER = 'cloudinary';

    const res = await putPublicAsset(BUF, {
      folder: 'autobacs/brands',
      contentType: 'image/png',
    });

    expect(putObject).not.toHaveBeenCalled();
    expect(uploadToCloudinary).toHaveBeenCalledWith(BUF, { folder: 'autobacs/brands' });
    expect(res.provider).toBe('cloudinary');
    expect(res.public_id).toBe('autobacs/brands/x');
    expect(res.secure_url).toContain('res.cloudinary.com');
  });

  test('unset → cloudinary, matching config/storage.js', async () => {
    delete process.env.STORAGE_PROVIDER;
    await putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' });
    expect(uploadToCloudinary).toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  test('read PER CALL — a flip mid-process takes effect immediately', async () => {
    process.env.STORAGE_PROVIDER = 'cloudinary';
    await putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' });
    process.env.STORAGE_PROVIDER = 'r2';
    await putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' });

    expect(uploadToCloudinary).toHaveBeenCalledTimes(1);
    expect(putObject).toHaveBeenCalledTimes(1);
  });
});

describe('the same shape either way', () => {
  test('both providers return secure_url and public_id', async () => {
    process.env.STORAGE_PROVIDER = 'cloudinary';
    const c = await putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' });
    process.env.STORAGE_PROVIDER = 'r2';
    const r = await putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' });

    for (const res of [c, r]) {
      expect(typeof res.secure_url).toBe('string');
      expect(res.secure_url.length).toBeGreaterThan(0);
      expect(typeof res.public_id).toBe('string');
      expect(res.public_id.length).toBeGreaterThan(0);
    }
  });
});

describe('nothing is written until the cheap failures are ruled out', () => {
  beforeEach(() => { process.env.STORAGE_PROVIDER = 'r2'; });

  test('an unsupported content type is rejected BEFORE any write', async () => {
    await expect(
      putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/gif' }),
    ).rejects.toThrow(/Unsupported image type/i);
    expect(putObject).not.toHaveBeenCalled();
    expect(enqueueVariantGeneration).not.toHaveBeenCalled();
  });

  test('a missing delivery host is rejected BEFORE any write', async () => {
    delete process.env.R2_PUBLIC_BASE_URL;
    await expect(
      putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' }),
    ).rejects.toThrow(/R2_PUBLIC_BASE_URL/);
    expect(putObject).not.toHaveBeenCalled();
  });

  test('a missing folder is rejected BEFORE any write', async () => {
    await expect(
      putPublicAsset(BUF, { contentType: 'image/png' }),
    ).rejects.toThrow(/Unsupported image type|folder/i);
    expect(putObject).not.toHaveBeenCalled();
  });

  test('a storage failure propagates and queues no variant job', async () => {
    putObject.mockRejectedValueOnce(new Error('bucket unreachable'));
    await expect(
      putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' }),
    ).rejects.toThrow(/bucket unreachable/);
    expect(enqueueVariantGeneration).not.toHaveBeenCalled();
  });
});

describe('derivatives', () => {
  test('r2 queues variant generation for the key it just wrote', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    const res = await putPublicAsset(BUF, {
      folder: 'autobacs/vehicle and makes',
      contentType: 'image/jpeg',
    });
    expect(enqueueVariantGeneration).toHaveBeenCalledWith(res.public_id);
  });

  test('the cloudinary path queues nothing — it makes its own derivatives', async () => {
    process.env.STORAGE_PROVIDER = 'cloudinary';
    await putPublicAsset(BUF, { folder: 'autobacs/brands', contentType: 'image/png' });
    expect(enqueueVariantGeneration).not.toHaveBeenCalled();
  });

  test('a folder with spaces keeps them in the key, unencoded', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    const res = await putPublicAsset(BUF, {
      folder: 'autobacs/vehicle and makes',
      contentType: 'image/jpeg',
    });
    // The stored KEY has real spaces; percent-encoding belongs to the URL only.
    expect(res.public_id).toMatch(/^autobacs\/vehicle and makes\/[0-9a-f]{24}\.jpg$/);
  });
});
