/**
 * Unit tests — services/storage/careersAssetStore.js
 *
 * This module is the trust boundary for careers files: it decides whether a
 * client's claim about an upload is true, and it is the only thing that knows
 * where a given file physically lives. Two failure modes matter, and they fail
 * in opposite directions:
 *
 *   - verification too loose → arbitrary bytes land in a slot that should hold
 *     a PDF, or a client attaches someone else's asset;
 *   - deletion routed to the wrong store → the purge reports success (an S3
 *     delete of a missing key succeeds), stamps mediaPurgedAt, and leaves the
 *     applicant's CV in the bucket forever. That is a retention breach that
 *     looks exactly like a completed purge, so it gets the most tests.
 */
import { jest } from '@jest/globals';

const headObject = jest.fn();
const getObjectHead = jest.fn();
const deleteObject = jest.fn();
jest.unstable_mockModule('../../../services/storage/r2Provider.js', () => ({
  headObject: (...a) => headObject(...a),
  getObjectHead: (...a) => getObjectHead(...a),
  deleteObject: (...a) => deleteObject(...a),
  presignGet: jest.fn(async () => 'https://r2.example/signed'),
  presignPut: jest.fn(async ({ key }) => ({ url: 'https://r2.example/put', key, expiresIn: 900 })),
}));

const getCareersResource = jest.fn();
const deleteCareersAsset = jest.fn();
jest.unstable_mockModule('../../../utils/careersCloudinary.js', () => ({
  CAREERS_FOLDER_BASE: 'autobacs/careers',
  getCareersResource,
  deleteCareersAsset,
}));

const {
  REASON, SNIFF_BYTES, verifyCareersAsset, deleteCareersAssetAnywhere, inferCareersProvider,
} = await import('../../../services/storage/careersAssetStore.js');

const MB = 1024 * 1024;
const VIDEO_SLOT = { key: 'videoOne', label: 'Video answer 1', resourceType: 'video', max: 30 * MB, formats: ['mp4', 'mov', 'webm'] };
const PDF_SLOT   = { key: 'resume',   label: 'Resume',         resourceType: 'raw',   max: 10 * MB, formats: ['pdf'] };

const FOLDER = 'autobacs/careers/0123456789abcdef01234567';
const r2Key = (slot, ext) => `${FOLDER}/${slot}-0011223344556677.${ext}`;

// Real magic numbers — the whole point is that these are the actual bytes.
const MP4  = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]);
const PDF  = Buffer.from('%PDF-1.7\n');
const HTML = Buffer.from('<!DOCTYPE html><script>alert(1)</script>');

beforeEach(() => {
  jest.clearAllMocks();
  headObject.mockResolvedValue({ key: 'k', bytes: 1000, contentType: 'video/mp4', etag: 'e' });
  getObjectHead.mockResolvedValue(MP4);
  deleteObject.mockResolvedValue(true);
  getCareersResource.mockResolvedValue({ public_id: 'x', bytes: 1000, format: 'mp4' });
  deleteCareersAsset.mockResolvedValue(true);
});

describe('verifyCareersAsset — R2', () => {
  const ref = (publicId) => ({ publicId, provider: 'r2' });

  test('accepts a well-formed video and reports the size FROM THE STORE', async () => {
    headObject.mockResolvedValue({ bytes: 12345 });
    const out = await verifyCareersAsset({ ref: ref(r2Key('videoOne', 'mp4')), slot: VIDEO_SLOT });
    expect(out).toEqual({ ok: true, bytes: 12345, provider: 'r2' });
  });

  test('accepts a real PDF in a document slot', async () => {
    getObjectHead.mockResolvedValue(PDF);
    const out = await verifyCareersAsset({ ref: ref(r2Key('resume', 'pdf')), slot: PDF_SLOT });
    expect(out.ok).toBe(true);
  });

  /*
    The replacement for Cloudinary's decode. A .pdf extension and a signed
    application/pdf Content-Type both say "PDF"; only the bytes are evidence,
    and R2 enforces neither of the other two.
  */
  test('REJECTS HTML wearing a .pdf extension', async () => {
    getObjectHead.mockResolvedValue(HTML);
    const out = await verifyCareersAsset({ ref: ref(r2Key('resume', 'pdf')), slot: PDF_SLOT });
    expect(out).toEqual({ ok: false, reason: REASON.WRONG_TYPE });
  });

  test('REJECTS a PDF submitted into a video slot', async () => {
    getObjectHead.mockResolvedValue(PDF);
    const out = await verifyCareersAsset({ ref: ref(r2Key('videoOne', 'mp4')), slot: VIDEO_SLOT });
    expect(out.reason).toBe(REASON.WRONG_TYPE);
  });

  test('sniffs with a RANGED read — never downloads the whole video', async () => {
    await verifyCareersAsset({ ref: ref(r2Key('videoOne', 'mp4')), slot: VIDEO_SLOT });
    expect(getObjectHead).toHaveBeenCalledWith(expect.objectContaining({ bytes: SNIFF_BYTES, scope: 'private' }));
    expect(SNIFF_BYTES).toBeLessThanOrEqual(4096);
  });

  test('reads only from the PRIVATE bucket', async () => {
    await verifyCareersAsset({ ref: ref(r2Key('resume', 'pdf')), slot: PDF_SLOT });
    expect(headObject).toHaveBeenCalledWith(expect.objectContaining({ scope: 'private' }));
  });

  test('rejects an object that was never uploaded', async () => {
    headObject.mockResolvedValue(null);
    const out = await verifyCareersAsset({ ref: ref(r2Key('resume', 'pdf')), slot: PDF_SLOT });
    expect(out.reason).toBe(REASON.MISSING);
    expect(getObjectHead).not.toHaveBeenCalled();   // no read for an absent object
  });

  test('rejects a zero-byte object — an abandoned PUT', async () => {
    headObject.mockResolvedValue({ bytes: 0 });
    const out = await verifyCareersAsset({ ref: ref(r2Key('resume', 'pdf')), slot: PDF_SLOT });
    expect(out.reason).toBe(REASON.MISSING);
  });

  test('enforces the size cap against the STORE, not the payload', async () => {
    headObject.mockResolvedValue({ bytes: 31 * MB });
    const out = await verifyCareersAsset({ ref: ref(r2Key('videoOne', 'mp4')), slot: VIDEO_SLOT });
    expect(out.reason).toBe(REASON.TOO_LARGE);
    expect(getObjectHead).not.toHaveBeenCalled();
  });

  /*
    The key-shape check subsumes the prefix, traversal and slot-swap guards, so
    each of them is asserted through it — and every one must fail BEFORE any
    network call, or an attacker can use this endpoint to probe our buckets.
  */
  test.each([
    ["another applicant's slot",  `${FOLDER}/resume-0011223344556677.pdf`, VIDEO_SLOT],
    ['a product image',           'autobacs/products/abc/photo.jpg',       VIDEO_SLOT],
    ['a traversal attempt',       `${FOLDER}/../../products/x-0011223344556677.mp4`, VIDEO_SLOT],
    ['a bare careers prefix',     'autobacs/careers',                      VIDEO_SLOT],
    ['a legacy Cloudinary id',    `${FOLDER}/kj3h4kj23h4`,                 VIDEO_SLOT],
    ['an empty id',               '',                                      VIDEO_SLOT],
  ])('rejects %s without touching the bucket', async (_l, id, slot) => {
    const out = await verifyCareersAsset({ ref: ref(id), slot });
    expect(out).toEqual({ ok: false, reason: REASON.INVALID_REF });
    expect(headObject).not.toHaveBeenCalled();
    expect(getObjectHead).not.toHaveBeenCalled();
  });
});

describe('verifyCareersAsset — Cloudinary', () => {
  const ref = (publicId) => ({ publicId });   // no provider ⇒ Cloudinary

  test('a ref with no provider is verified against Cloudinary', async () => {
    const out = await verifyCareersAsset({ ref: ref('autobacs/careers/abc/vid'), slot: VIDEO_SLOT });
    expect(out).toEqual({ ok: true, bytes: 1000, provider: 'cloudinary' });
    expect(getCareersResource).toHaveBeenCalled();
    expect(headObject).not.toHaveBeenCalled();
  });

  test('derives a raw format from the id suffix when Cloudinary reports none', async () => {
    getCareersResource.mockResolvedValue({ bytes: 500, format: undefined });
    const ok  = await verifyCareersAsset({ ref: ref('autobacs/careers/abc/cv.pdf'), slot: PDF_SLOT });
    const bad = await verifyCareersAsset({ ref: ref('autobacs/careers/abc/cv.html'), slot: PDF_SLOT });
    expect(ok.ok).toBe(true);
    expect(bad.reason).toBe(REASON.WRONG_TYPE);
  });

  test('still requires the careers folder', async () => {
    const out = await verifyCareersAsset({ ref: ref('autobacs/products/x'), slot: VIDEO_SLOT });
    expect(out.reason).toBe(REASON.INVALID_REF);
    expect(getCareersResource).not.toHaveBeenCalled();
  });

  test('rejects a missing or oversized asset', async () => {
    getCareersResource.mockResolvedValueOnce(null);
    expect((await verifyCareersAsset({ ref: ref('autobacs/careers/a/v'), slot: VIDEO_SLOT })).reason).toBe(REASON.MISSING);
    getCareersResource.mockResolvedValueOnce({ bytes: 31 * MB, format: 'mp4' });
    expect((await verifyCareersAsset({ ref: ref('autobacs/careers/a/v'), slot: VIDEO_SLOT })).reason).toBe(REASON.TOO_LARGE);
  });

  /*
    A client that claims 'cloudinary' for a file it PUT into R2 cannot get a
    pass: it only sends the lookup to a store that does not hold it.
  */
  test('a lie about the provider fails verification rather than bypassing it', async () => {
    getCareersResource.mockResolvedValue(null);
    const out = await verifyCareersAsset({ ref: { publicId: r2Key('resume', 'pdf') }, slot: PDF_SLOT });
    expect(out.ok).toBe(false);
    expect(headObject).not.toHaveBeenCalled();
  });
});

describe('deleteCareersAssetAnywhere', () => {
  test('an r2 ref deletes from the PRIVATE bucket and never touches Cloudinary', async () => {
    const key = r2Key('resume', 'pdf');
    await expect(deleteCareersAssetAnywhere({ publicId: key, provider: 'r2' })).resolves.toBe(true);
    expect(deleteObject).toHaveBeenCalledWith({ key, scope: 'private' });
    expect(deleteCareersAsset).not.toHaveBeenCalled();
  });

  test('a ref with no provider deletes from Cloudinary', async () => {
    await deleteCareersAssetAnywhere({ publicId: 'autobacs/careers/a/cv.pdf', resourceType: 'raw' });
    expect(deleteCareersAsset).toHaveBeenCalledWith('autobacs/careers/a/cv.pdf', 'raw');
    expect(deleteObject).not.toHaveBeenCalled();
  });

  /*
    The single most consequential assertion here. A delete reported as done when
    it was not lets the retention sweep stamp mediaPurgedAt over files that are
    still in the bucket — PII retained indefinitely, with a record saying it was
    removed.
  */
  test('a failed r2 delete is reported as NOT deleted', async () => {
    deleteObject.mockResolvedValue(false);
    await expect(deleteCareersAssetAnywhere({ publicId: r2Key('resume', 'pdf'), provider: 'r2' })).resolves.toBe(false);
  });

  test('refuses to delete outside the careers tree', async () => {
    await expect(deleteCareersAssetAnywhere({ publicId: 'autobacs/products/hero.jpg', provider: 'r2' })).resolves.toBe(false);
    await expect(deleteCareersAssetAnywhere({ publicId: '', provider: 'r2' })).resolves.toBe(false);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe('inferCareersProvider', () => {
  test('recognises a key we minted', () => {
    expect(inferCareersProvider(r2Key('videoOne', 'mp4'))).toBe('r2');
  });

  /*
    Anything else must fall to Cloudinary. Guessing 'r2' for a Cloudinary id
    would send the orphan cleanup to R2, where the delete SUCCEEDS for a key that
    was never there — reporting a cleanup that never happened.
  */
  test.each([
    ['a Cloudinary public_id', 'autobacs/careers/abc123/kj3h4kj23h4'],
    ['a raw Cloudinary PDF',   'autobacs/careers/abc123/cv.pdf'],
    ['an empty string',        ''],
    ['undefined',              undefined],
  ])('falls back to Cloudinary for %s', (_l, id) => {
    expect(inferCareersProvider(id)).toBe('cloudinary');
  });
});
