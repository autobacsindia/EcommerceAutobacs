/**
 * Unit tests — services/storage/publicImageDeletes.js
 *
 * PRODUCTION BUG (found 2026-09-03). Every product-image delete called
 * `deleteManyFromCloudinary(publicIds)` unconditionally. After the flip to R2 a
 * product image's public_id IS an R2 object key, so removing an image asked
 * Cloudinary to delete an R2 key: Cloudinary answered `not_found`, the call
 * reported success, and the object was orphaned permanently. Silent, and it
 * compounds on every edit.
 *
 * These tests fail against that code.
 */
import { jest } from '@jest/globals';

const deleteObject = jest.fn();
const deleteObjects = jest.fn();
const listKeys = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  deleteObject: (...a) => deleteObject(...a),
  deleteObjects: (...a) => deleteObjects(...a),
  listKeys: (...a) => listKeys(...a),
}));

const deleteManyFromCloudinary = jest.fn();
jest.unstable_mockModule('../../../utils/cloudinaryHelpers.js', () => ({
  deleteManyFromCloudinary: (...a) => deleteManyFromCloudinary(...a),
}));

const { isR2Image, deleteHostedImages } = await import('../../../services/storage/publicImageDeletes.js');
const { variantPrefixFor } = await import('../../../services/storage/variants.js');

const R2_BASE = 'https://img.autobacsindia.com';
const r2Ref = { public_id: 'autobacs/products/a/photo.png', url: `${R2_BASE}/autobacs/products/a/photo.png` };
const clRef = { public_id: 'autobacs/products/a/img-0', url: 'https://res.cloudinary.com/x/image/upload/v1/autobacs/products/a/img-0.jpg' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.R2_PUBLIC_BASE_URL = R2_BASE;
  deleteObject.mockResolvedValue(true);
  deleteObjects.mockResolvedValue({ deleted: 0, failed: [] });
  listKeys.mockResolvedValue([]);
  deleteManyFromCloudinary.mockResolvedValue({});
});

describe('isR2Image', () => {
  test('matches only our configured delivery host', () => {
    expect(isR2Image(`${R2_BASE}/autobacs/products/a.png`)).toBe(true);
    expect(isR2Image('https://res.cloudinary.com/x/image/upload/a.jpg')).toBe(false);
    expect(isR2Image('https://evil.example.com/autobacs/products/a.png')).toBe(false);
  });

  test('anything unrecognised is treated as Cloudinary — the pre-migration default', () => {
    expect(isR2Image('')).toBe(false);
    expect(isR2Image(undefined)).toBe(false);
    expect(isR2Image('not-a-url')).toBe(false);
  });

  test('is false when no R2 host is configured, rather than matching everything', () => {
    delete process.env.R2_PUBLIC_BASE_URL;
    expect(isR2Image(`${R2_BASE}/a.png`)).toBe(false);
  });
});

describe('deleteHostedImages', () => {
  /*
    The regression. Routing on the ID is impossible — a Cloudinary public_id and
    an R2 key are the same shape — so the URL is the only evidence.
  */
  test('an R2 image is deleted from R2, never from Cloudinary', async () => {
    await deleteHostedImages([r2Ref]);
    expect(deleteObject).toHaveBeenCalledWith({ key: r2Ref.public_id, scope: 'public' });
    expect(deleteManyFromCloudinary).not.toHaveBeenCalled();
  });

  test('a Cloudinary image is deleted from Cloudinary, never from R2', async () => {
    await deleteHostedImages([clRef]);
    expect(deleteManyFromCloudinary).toHaveBeenCalledWith([clRef.public_id]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  test('a mixed batch splits correctly — both stores hold live assets', async () => {
    const out = await deleteHostedImages([r2Ref, clRef]);
    expect(out).toMatchObject({ r2: 1, cloudinary: 1 });
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteManyFromCloudinary).toHaveBeenCalledWith([clRef.public_id]);
  });

  /*
    An R2 original has ~14 pre-generated variants. Deleting only the original
    strands every one of them — 14 orphans per removed image is how a bucket
    quietly fills with objects nothing will ever reference again.
  */
  test('deletes the derived variants along with the original', async () => {
    const prefix = variantPrefixFor(r2Ref.public_id);
    listKeys.mockResolvedValue([{ key: `${prefix}w640.avif` }, { key: `${prefix}full.webp` }]);
    deleteObjects.mockResolvedValue({ deleted: 2, failed: [] });

    const out = await deleteHostedImages([r2Ref]);

    expect(listKeys).toHaveBeenCalledWith({ prefix, scope: 'public' });
    expect(deleteObjects).toHaveBeenCalledWith(expect.objectContaining({ scope: 'public' }));
    expect(deleteObjects.mock.calls[0][0].keys).toEqual(
      expect.arrayContaining([`${prefix}w640.avif`, `${prefix}full.webp`]),
    );
    expect(out.variants).toBe(2);
  });

  test('variants go BEFORE the original, so a failure leaves them findable', async () => {
    const order = [];
    listKeys.mockResolvedValue([{ key: 'variants/x/w640.avif' }]);
    deleteObjects.mockImplementation(async () => { order.push('variants'); return { deleted: 1, failed: [] }; });
    deleteObject.mockImplementation(async () => { order.push('original'); return true; });
    await deleteHostedImages([r2Ref]);
    expect(order).toEqual(['variants', 'original']);
  });

  /*
    Every caller is on a cleanup path where the database is ALREADY consistent.
    Throwing here would unwind a successful save over a storage hiccup.
  */
  test('never throws — a storage failure must not unwind a saved product', async () => {
    deleteObject.mockRejectedValue(new Error('r2 down'));
    await expect(deleteHostedImages([r2Ref])).resolves.toBeDefined();
    deleteManyFromCloudinary.mockRejectedValue(new Error('cloudinary down'));
    await expect(deleteHostedImages([clRef])).resolves.toBeDefined();
  });

  test('accepts either ref spelling, and skips refs with no id', async () => {
    await deleteHostedImages([
      { publicId: 'autobacs/products/a/x.png', url: `${R2_BASE}/autobacs/products/a/x.png` },
      { url: `${R2_BASE}/no-id.png` },
      null,
    ]);
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  test.each([['empty', []], ['undefined', undefined], ['not an array', {}]])(
    'does nothing for %s', async (_l, refs) => {
      const out = await deleteHostedImages(refs);
      expect(out).toEqual({ r2: 0, cloudinary: 0, variants: 0 });
      expect(deleteObject).not.toHaveBeenCalled();
      expect(deleteManyFromCloudinary).not.toHaveBeenCalled();
    });
});
