/**
 * Unit tests — services/storage/keys.js
 *
 * The Cloudinary→R2 migration is only safe if the key mapping is DETERMINISTIC
 * and REVERSIBLE: the copy script, the URL rewriter and the delete path each
 * derive the key independently, so any disagreement between them orphans bytes
 * in R2 that nothing can address or delete.
 *
 * These tests pin the three cases that actually differ in prod data:
 *   - image/video assets, where Cloudinary keeps `format` separate from public_id
 *   - `raw` assets, where the extension is already baked into the public_id
 *   - the real `autobacs/vehicle and makes` folder, which contains a SPACE
 */

import { r2KeyFor, publicIdFromR2Key, toObjectUrl } from '../../../services/storage/keys.js';

describe('r2KeyFor', () => {
  test('appends the format to an image public_id', () => {
    expect(r2KeyFor({ publicId: 'autobacs/products/abc123', format: 'jpg' }))
      .toBe('autobacs/products/abc123.jpg');
  });

  test('appends the format to a video public_id', () => {
    expect(r2KeyFor({ publicId: 'autobacs/careers/n0nce/answer1', format: 'mp4' }))
      .toBe('autobacs/careers/n0nce/answer1.mp4');
  });

  test('does NOT double-suffix a raw public_id that already carries the extension', () => {
    // uploadRawToCloudinary bakes `.pdf` into the public_id; appending again
    // would produce slip-AB12.pdf.pdf and the copy would never be found again.
    expect(r2KeyFor({ publicId: 'shipping-slips/slip-AB12.pdf', format: 'pdf' }))
      .toBe('shipping-slips/slip-AB12.pdf');
  });

  test('is case-insensitive when detecting an existing extension', () => {
    expect(r2KeyFor({ publicId: 'invoices/INV-001.PDF', format: 'pdf' }))
      .toBe('invoices/INV-001.PDF');
  });

  test('appends when the trailing dot segment is a different extension', () => {
    // A public_id may legitimately contain a dot that is not the format.
    expect(r2KeyFor({ publicId: 'autobacs/products/v1.2-bumper', format: 'jpg' }))
      .toBe('autobacs/products/v1.2-bumper.jpg');
  });

  test('preserves spaces verbatim (real folder: "vehicle and makes")', () => {
    expect(r2KeyFor({ publicId: 'autobacs/vehicle and makes/thar', format: 'jpg' }))
      .toBe('autobacs/vehicle and makes/thar.jpg');
  });

  test('returns the bare id when format metadata is missing', () => {
    expect(r2KeyFor({ publicId: 'autobacs/products/abc123' })).toBe('autobacs/products/abc123');
    expect(r2KeyFor({ publicId: 'autobacs/products/abc123', format: '' }))
      .toBe('autobacs/products/abc123');
  });

  test('strips leading and trailing slashes that would create empty segments', () => {
    expect(r2KeyFor({ publicId: '/autobacs/products/a/', format: 'jpg' }))
      .toBe('autobacs/products/a.jpg');
  });

  test('is idempotent — mapping an already-mapped key does not change it', () => {
    const once = r2KeyFor({ publicId: 'autobacs/products/abc123', format: 'jpg' });
    expect(r2KeyFor({ publicId: once, format: 'jpg' })).toBe(once);
  });

  test('treats a dotfile basename as having no extension', () => {
    expect(r2KeyFor({ publicId: 'autobacs/.gitkeep', format: 'txt' }))
      .toBe('autobacs/.gitkeep.txt');
  });

  // Total function: a render/delete path must never throw on bad input.
  test.each([
    [undefined, ''],
    [null, ''],
    ['', ''],
    ['   ', ''],
    ['///', ''],
  ])('returns "" for unusable publicId %p', (publicId, expected) => {
    expect(r2KeyFor({ publicId, format: 'jpg' })).toBe(expected);
  });

  test('returns "" when called with no argument at all', () => {
    expect(r2KeyFor()).toBe('');
  });
});

describe('publicIdFromR2Key', () => {
  test('round-trips an image key back to its public_id', () => {
    const publicId = 'autobacs/products/abc123';
    const key = r2KeyFor({ publicId, format: 'jpg' });
    expect(publicIdFromR2Key(key, 'image')).toBe(publicId);
  });

  test('round-trips a video key', () => {
    const publicId = 'autobacs/careers/n0nce/answer1';
    const key = r2KeyFor({ publicId, format: 'mp4' });
    expect(publicIdFromR2Key(key, 'video')).toBe(publicId);
  });

  test('keeps the extension for raw resources, where it IS part of the public_id', () => {
    expect(publicIdFromR2Key('shipping-slips/slip-AB12.pdf', 'raw'))
      .toBe('shipping-slips/slip-AB12.pdf');
  });

  test('leaves a key with no extension untouched', () => {
    expect(publicIdFromR2Key('autobacs/products/abc123', 'image'))
      .toBe('autobacs/products/abc123');
  });

  test.each([undefined, null, ''])('returns "" for unusable key %p', (key) => {
    expect(publicIdFromR2Key(key)).toBe('');
  });
});

describe('toObjectUrl', () => {
  const BASE = 'https://img.autobacsindia.com';

  test('joins base and key', () => {
    expect(toObjectUrl(BASE, 'autobacs/products/abc123.jpg'))
      .toBe('https://img.autobacsindia.com/autobacs/products/abc123.jpg');
  });

  test('tolerates a trailing slash on the base', () => {
    expect(toObjectUrl(`${BASE}/`, 'a/b.jpg')).toBe(`${BASE}/a/b.jpg`);
  });

  test('percent-encodes spaces but keeps slashes structural', () => {
    // The whole point: `autobacs/vehicle and makes/thar.jpg` must not break a
    // srcset, where an unescaped space is a candidate delimiter.
    expect(toObjectUrl(BASE, 'autobacs/vehicle and makes/thar.jpg'))
      .toBe(`${BASE}/autobacs/vehicle%20and%20makes/thar.jpg`);
  });

  test('encodes characters that are delimiters inside a srcset', () => {
    expect(toObjectUrl(BASE, 'autobacs/products/front,rear.jpg'))
      .toBe(`${BASE}/autobacs/products/front%2Crear.jpg`);
  });

  test.each([
    ['', 'a.jpg'],
    [BASE, ''],
    [null, 'a.jpg'],
    [BASE, null],
  ])('returns "" for unusable input (%p, %p)', (base, key) => {
    expect(toObjectUrl(base, key)).toBe('');
  });
});
