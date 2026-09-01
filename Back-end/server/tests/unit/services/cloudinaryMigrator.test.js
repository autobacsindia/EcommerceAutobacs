/**
 * Unit tests — services/storage/cloudinaryMigrator.js
 *
 * The properties that make this migration safe to point at production:
 *   - a dry run performs NO writes;
 *   - a second run is a no-op (idempotent / resumable after an interruption);
 *   - a truncated download is never written;
 *   - a checksum mismatch is a failure, not a success;
 *   - an unmapped asset is skipped and reported, never published;
 *   - one bad asset does not abort the run.
 */
import { jest } from '@jest/globals';
import {
  planAsset, copyAsset, migrateAll, summarise, contentTypeFor, md5, PUBLIC_CACHE_CONTROL,
} from '../../../services/storage/cloudinaryMigrator.js';
import { scopeFor, skipReason } from '../../../services/storage/assetScope.js';
import { r2KeyFor } from '../../../services/storage/keys.js';

const BODY = Buffer.from('image-bytes-here');

/** A Cloudinary Admin API resource. */
const res = (over = {}) => ({
  public_id: 'autobacs/products/abc123',
  format: 'jpg',
  bytes: BODY.length,
  resource_type: 'image',
  type: 'upload',
  ...over,
});

/** Dependency bundle with sensible happy-path defaults. */
const deps = (over = {}) => ({
  scopeFor,
  skipReason,
  r2KeyFor,
  download: jest.fn().mockResolvedValue(BODY),
  headObject: jest.fn().mockResolvedValue(null),      // absent by default
  putObject: jest.fn().mockResolvedValue({}),
  apply: true,
  ...over,
});

describe('planAsset', () => {
  test('maps a product image to the public bucket with an extension', () => {
    expect(planAsset(res(), { scopeFor, r2KeyFor })).toEqual({
      action: 'copy', key: 'autobacs/products/abc123.jpg', scope: 'public',
      publicId: 'autobacs/products/abc123',
    });
  });

  test('maps a careers video to the private bucket', () => {
    const p = planAsset(res({ public_id: 'autobacs/careers/n/answer1', format: 'mp4' }), { scopeFor, r2KeyFor });
    expect(p).toMatchObject({ action: 'copy', scope: 'private', key: 'autobacs/careers/n/answer1.mp4' });
  });

  test('skips an unmapped asset', () => {
    expect(planAsset(res({ public_id: 'mystery/thing' }), { scopeFor, skipReason, r2KeyFor }))
      .toMatchObject({ action: 'skip', reason: 'unmapped' });
  });

  test('distinguishes deliberate skips from ones a human still owes a decision on', () => {
    // Both are "not migrated", but only `unmapped` should reach the operator
    // warning — otherwise 78 lines of Cloudinary demo content bury the one
    // asset that actually needs classifying.
    const p = (id) => planAsset(res({ public_id: id }), { scopeFor, skipReason, r2KeyFor }).reason;
    expect(p('samples/breakfast')).toBe('excluded');              // excluded prefix
    expect(p('autobacs/brand-logos/ironman.png')).toBe('excluded'); // dead folder, by prefix
    expect(p('Roavion-Logo_xwqbx9')).toBe('orphaned');             // audited dead, exact id
    expect(p('genuinely/new/folder')).toBe('unmapped');            // owes a decision
  });
});

describe('dry run', () => {
  test('performs NO writes and no download', async () => {
    const d = deps({ apply: false });
    const row = await copyAsset(res(), d);
    expect(row.status).toBe('would-copy');
    expect(d.putObject).not.toHaveBeenCalled();
    expect(d.download).not.toHaveBeenCalled();
  });

  test('still reports an already-present object as skipped', async () => {
    const d = deps({ apply: false, headObject: jest.fn().mockResolvedValue({ bytes: BODY.length, etag: md5(BODY) }) });
    const row = await copyAsset(res(), d);
    expect(row).toMatchObject({ status: 'skipped', reason: 'already-present' });
    expect(d.putObject).not.toHaveBeenCalled();
  });

  test('flags an existing object of the WRONG size as needing a re-copy', async () => {
    const d = deps({ apply: false, headObject: jest.fn().mockResolvedValue({ bytes: 5, etag: 'x' }) });
    await expect(copyAsset(res(), d)).resolves.toMatchObject({ status: 'would-copy', reason: 'size-mismatch' });
  });
});

describe('idempotency / resumability', () => {
  test('a matching object already in R2 is skipped without downloading', async () => {
    const d = deps({ headObject: jest.fn().mockResolvedValue({ bytes: BODY.length, etag: md5(BODY) }) });
    const row = await copyAsset(res(), d);
    expect(row).toMatchObject({ status: 'skipped', reason: 'already-present' });
    expect(d.download).not.toHaveBeenCalled();
    expect(d.putObject).not.toHaveBeenCalled();
  });

  test('an undeterminable HEAD propagates instead of triggering a re-copy', async () => {
    // r2Provider throws when it cannot tell; treating that as "absent" would
    // re-download and re-upload the entire catalog during an R2 blip.
    const d = deps({ headObject: jest.fn().mockRejectedValue(new Error('R2 unavailable')) });
    await expect(copyAsset(res(), d)).rejects.toThrow('R2 unavailable');
    expect(d.putObject).not.toHaveBeenCalled();
  });
});

describe('integrity', () => {
  test('writes the object and reports its checksum on the happy path', async () => {
    const d = deps({
      headObject: jest.fn()
        .mockResolvedValueOnce(null)                                        // pre-check: absent
        .mockResolvedValueOnce({ bytes: BODY.length, etag: md5(BODY) }),    // post-write verify
    });
    const row = await copyAsset(res(), d);
    expect(row).toMatchObject({ status: 'copied', bytes: BODY.length, md5: md5(BODY) });
    expect(d.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: 'autobacs/products/abc123.jpg',
      scope: 'public',
      contentType: 'image/jpeg',
      cacheControl: PUBLIC_CACHE_CONTROL,
    }));
  });

  test('a TRUNCATED download is never written', async () => {
    const d = deps({ download: jest.fn().mockResolvedValue(Buffer.from('short')) });
    const row = await copyAsset(res(), d);
    expect(row.status).toBe('failed');
    expect(row.reason).toMatch(/size-mismatch/);
    expect(d.putObject).not.toHaveBeenCalled();
  });

  test('a checksum mismatch after write is a FAILURE, not a success', async () => {
    const d = deps({
      headObject: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ bytes: BODY.length, etag: 'deadbeef' }),
    });
    await expect(copyAsset(res(), d)).resolves.toMatchObject({
      status: 'failed', reason: expect.stringMatching(/checksum mismatch/),
    });
  });

  test('an object that vanishes immediately after write is a failure', async () => {
    const d = deps({ headObject: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null) });
    await expect(copyAsset(res(), d)).resolves.toMatchObject({
      status: 'failed', reason: /missing immediately after write/,
    });
  });

  test('skips the source-size check when Cloudinary reports no byte count', async () => {
    const d = deps({
      headObject: jest.fn().mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ bytes: BODY.length, etag: md5(BODY) }),
    });
    await expect(copyAsset(res({ bytes: 0 }), d)).resolves.toMatchObject({ status: 'copied' });
  });
});

describe('private routing', () => {
  test('a private object is written with no-store, never the public cache header', async () => {
    const d = deps({
      headObject: jest.fn().mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ bytes: BODY.length, etag: md5(BODY) }),
    });
    await copyAsset(res({ public_id: 'autobacs/careers/n/cv', format: 'pdf' }), d);
    expect(d.putObject).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'private', cacheControl: 'private, no-store', contentType: 'application/pdf',
    }));
  });

  test('an unmapped asset is never uploaded', async () => {
    const d = deps();
    const row = await copyAsset(res({ public_id: 'mystery/thing' }), d);
    expect(row).toMatchObject({ status: 'skipped', reason: 'unmapped' });
    expect(d.putObject).not.toHaveBeenCalled();
    expect(d.download).not.toHaveBeenCalled();
  });
});

describe('migrateAll', () => {
  test('one failing asset does not abort the run', async () => {
    const d = deps({
      headObject: jest.fn().mockResolvedValue(null),
      download: jest.fn()
        .mockResolvedValueOnce(BODY)
        .mockRejectedValueOnce(new Error('404 from Cloudinary'))
        .mockResolvedValueOnce(BODY),
      putObject: jest.fn().mockResolvedValue({}),
    });
    // headObject is called pre- and post-write; return a valid verify each time.
    d.headObject = jest.fn().mockImplementation(({ key }) =>
      d.putObject.mock.calls.some((c) => c[0].key === key)
        ? Promise.resolve({ bytes: BODY.length, etag: md5(BODY) })
        : Promise.resolve(null));

    const rows = await migrateAll(
      [res({ public_id: 'autobacs/products/a' }),
       res({ public_id: 'autobacs/products/b' }),
       res({ public_id: 'autobacs/products/c' })],
      d, { concurrency: 1 },
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'copied')).toHaveLength(2);
  });

  test('handles an empty resource list', async () => {
    await expect(migrateAll([], deps(), { concurrency: 4 })).resolves.toEqual([]);
  });

  test('processes every asset exactly once under concurrency', async () => {
    const seen = [];
    const d = deps({
      headObject: jest.fn().mockResolvedValue({ bytes: BODY.length, etag: md5(BODY) }),
    });
    const list = Array.from({ length: 25 }, (_, i) => res({ public_id: `autobacs/products/p${i}` }));
    const rows = await migrateAll(list, d, { concurrency: 8, onResult: (r) => seen.push(r.publicId) });
    expect(rows).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});

describe('summarise', () => {
  test('tallies rows and collects unmapped ids for the operator', () => {
    const s = summarise([
      { status: 'copied', bytes: 10 },
      { status: 'copied', bytes: 5 },
      { status: 'skipped', reason: 'already-present' },
      { status: 'skipped', reason: 'unmapped', publicId: 'mystery/x' },
      { status: 'would-copy' },
      { status: 'failed' },
    ]);
    expect(s).toEqual({
      copied: 2, skipped: 2, wouldCopy: 1, failed: 1, bytes: 15,
      unmapped: ['mystery/x'], deliberatelySkipped: 0,
    });
  });

  test('counts deliberate skips separately and keeps them OUT of the operator warning', () => {
    const s = summarise([
      { status: 'skipped', reason: 'excluded', publicId: 'samples/breakfast' },
      { status: 'skipped', reason: 'orphaned', publicId: 'cld-sample' },
      { status: 'skipped', reason: 'unmapped', publicId: 'needs/a/decision' },
    ]);
    expect(s.unmapped).toEqual(['needs/a/decision']);
    expect(s.deliberatelySkipped).toBe(2);
    expect(s.skipped).toBe(3);
  });
});

describe('contentTypeFor', () => {
  test.each([
    ['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
    ['mp4', 'video/mp4'], ['pdf', 'application/pdf'],
    ['JPG', 'image/jpeg'],
  ])('%s → %s', (fmt, expected) => expect(contentTypeFor(fmt)).toBe(expected));

  test.each([undefined, null, '', 'weird'])('unknown %p → octet-stream', (fmt) =>
    expect(contentTypeFor(fmt)).toBe('application/octet-stream'));
});
