/**
 * Autobacs Partner (procurement side) — supplier files are read from the store
 * that holds them. The supplier app stores through putPrivateAsset, which puts a
 * file on R2 or on Cloudinary (STORAGE_PROVIDER=cloudinary). Reading every file
 * as R2 broke documents, photos and approval for Cloudinary-stored files.
 */
import { jest } from '@jest/globals';
import { providerOf } from '../services/storage/privateAssetUrl.js';

const r2Reads = [];
const signed = [];
const privateMock = {
  // Same routing as the real helper: R2 by key, otherwise the caller's downloader.
  readPrivateAsset: async (ref, fetchUrl) => {
    if (providerOf(ref) === 'r2') { r2Reads.push(ref.publicId); return Buffer.from('r2'); }
    return fetchUrl(ref.url);
  },
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...privateMock, default: privateMock }));
jest.unstable_mockModule('../utils/supportAttachments.js', () => ({
  signedAttachmentUrl: async (key, resourceType, ref) => { signed.push({ key, resourceType, provider: ref.provider }); return `https://res.example/${key}`; },
}));

const { readSupplierFile } = await import('../services/procurementPartners/shared.js');

const realFetch = global.fetch;
let fetched;
beforeEach(() => {
  r2Reads.length = 0; signed.length = 0; fetched = [];
  global.fetch = async (url) => { fetched.push(url); return { ok: true, arrayBuffer: async () => new TextEncoder().encode('cdn').buffer }; };
});
afterAll(() => { global.fetch = realFetch; });

test('an R2 file is read by its key, nothing fetched', async () => {
  const buf = await readSupplierFile({ key: 'partner/photos/a.jpg', provider: 'r2', contentType: 'image/jpeg' });
  expect(buf.toString()).toBe('r2');
  expect(r2Reads).toEqual(['partner/photos/a.jpg']);
  expect(fetched).toEqual([]);
});

test('a Cloudinary file is signed and fetched (was read from R2 before the fix)', async () => {
  const buf = await readSupplierFile({ key: 'partner/docs/gst', provider: 'cloudinary', contentType: 'application/pdf' });
  expect(buf.toString()).toBe('cdn');
  expect(r2Reads).toEqual([]);
  expect(signed).toEqual([{ key: 'partner/docs/gst', resourceType: 'raw', provider: 'cloudinary' }]);
  expect(fetched).toEqual(['https://res.example/partner/docs/gst']);
});

test('no provider recorded = Cloudinary (older refs), images signed as image', async () => {
  await readSupplierFile({ key: 'partner/photos/b', contentType: 'image/png' });
  expect(signed[0]).toMatchObject({ resourceType: 'image' });
  expect(r2Reads).toEqual([]);
});

test('a failed download throws instead of returning an empty file', async () => {
  global.fetch = async () => ({ ok: false, status: 404 });
  await expect(readSupplierFile({ key: 'x', provider: 'cloudinary', contentType: 'image/jpeg' })).rejects.toThrow(/404/);
});
