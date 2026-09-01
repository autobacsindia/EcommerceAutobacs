/**
 * Unit tests — services/storage/variants.js
 *
 * The variant key is a contract between four things that never run together:
 * the backfill script that writes objects, the upload job that writes them
 * later, the frontend loader that emits URLs, and the Cloudflare Worker that
 * resolves them. A disagreement between any two shows up as a broken image in
 * production, not a failing build — so the scheme is pinned exactly here.
 */
import {
  LADDER, FORMATS, VARIANT_PREFIX,
  widthsFor, variantKey, negotiableKey, pickWidth, plannedVariants,
} from '../../../services/storage/variants.js';

describe('the ladder itself', () => {
  test('is ascending and free of duplicates', () => {
    expect([...LADDER].sort((a, b) => a - b)).toEqual(LADDER);
    expect(new Set(LADDER).size).toBe(LADDER.length);
  });

  test('lists AVIF before WebP — best format first', () => {
    expect(FORMATS[0]).toBe('avif');
  });
});

describe('variantKey', () => {
  test('builds the canonical key', () => {
    expect(variantKey('autobacs/products/abc.jpg', 640, 'avif'))
      .toBe('variants/autobacs/products/abc/w640.avif');
  });

  test('strips the ORIGINAL extension rather than stacking on it', () => {
    expect(variantKey('autobacs/products/abc.png', 256, 'webp'))
      .toBe('variants/autobacs/products/abc/w256.webp');
  });

  test('keeps a key with no extension intact', () => {
    expect(variantKey('autobacs/products/abc', 256, 'webp'))
      .toBe('variants/autobacs/products/abc/w256.webp');
  });

  test('preserves spaces (the real "vehicle and makes" folder)', () => {
    expect(variantKey('autobacs/vehicle and makes/thar.jpg', 384, 'avif'))
      .toBe('variants/autobacs/vehicle and makes/thar/w384.avif');
  });

  test('never collides with the originals namespace', () => {
    expect(variantKey('autobacs/products/abc.jpg', 640, 'avif')).toMatch(new RegExp(`^${VARIANT_PREFIX}/`));
  });

  test('rejects a width that is not a ladder rung', () => {
    // An off-ladder width would name an object nothing ever generates.
    expect(variantKey('autobacs/products/abc.jpg', 700, 'avif')).toBe('');
    expect(variantKey('autobacs/products/abc.jpg', 0, 'avif')).toBe('');
  });

  test('rejects an unsupported format', () => {
    expect(variantKey('autobacs/products/abc.jpg', 640, 'jpeg')).toBe('');
    expect(variantKey('autobacs/products/abc.jpg', 640, 'gif')).toBe('');
  });

  test.each([undefined, null, '', 42])('returns "" for unusable key %p', (k) => {
    expect(variantKey(k, 640, 'avif')).toBe('');
  });
});

describe('negotiableKey', () => {
  test('is the variant key without the extension', () => {
    expect(negotiableKey('autobacs/products/abc.jpg', 640)).toBe('variants/autobacs/products/abc/w640');
  });

  test('every format key is that prefix plus an extension — the Worker contract', () => {
    const base = negotiableKey('autobacs/products/abc.jpg', 640);
    FORMATS.forEach((f) => {
      expect(variantKey('autobacs/products/abc.jpg', 640, f)).toBe(`${base}.${f}`);
    });
  });

  test('rejects an off-ladder width', () => {
    expect(negotiableKey('autobacs/products/abc.jpg', 700)).toBe('');
  });
});

describe('widthsFor — never upscale', () => {
  test('omits rungs wider than the source', () => {
    // A 554px source (a real prod asset) must not get a 640+ variant.
    expect(widthsFor(554)).toEqual([128, 256, 384]);
  });

  test('includes a rung exactly equal to the source width', () => {
    expect(widthsFor(640)).toContain(640);
  });

  test('returns the whole ladder for a source wider than every rung', () => {
    expect(widthsFor(4000)).toEqual(LADDER);
  });

  test('still yields one rung for a source smaller than the smallest', () => {
    // Otherwise a 64px icon would get no variant at all and fall back to origin.
    expect(widthsFor(64)).toEqual([LADDER[0]]);
  });

  test.each([undefined, null, 0, -100, NaN, 'wide'])('falls back to the full ladder for %p', (w) => {
    expect(widthsFor(w)).toEqual(LADDER);
  });
});

describe('pickWidth — round UP, never down', () => {
  test('picks the smallest rung that covers the request', () => {
    // Rounding DOWN would hand a 700px slot a 640px image and let the browser
    // upscale it — the exact softness the quality work existed to remove.
    expect(pickWidth(700)).toBe(960);
    expect(pickWidth(640)).toBe(640);
    expect(pickWidth(1)).toBe(128);
  });

  test('clamps to the largest rung beyond the ladder', () => {
    expect(pickWidth(5000)).toBe(1920);
  });

  test.each([undefined, null, 0, -5, NaN])('falls back to the smallest rung for %p', (w) => {
    expect(pickWidth(w)).toBe(LADDER[0]);
  });

  test('every ladder rung maps to itself', () => {
    LADDER.forEach((rung) => expect(pickWidth(rung)).toBe(rung));
  });
});

describe('plannedVariants', () => {
  test('is widths x formats', () => {
    const plan = plannedVariants('autobacs/products/abc.jpg', 4000);
    expect(plan).toHaveLength(LADDER.length * FORMATS.length);
  });

  test('honours the no-upscale rule', () => {
    const plan = plannedVariants('autobacs/products/abc.jpg', 554);
    expect(plan).toHaveLength(3 * FORMATS.length);
    expect(plan.every((v) => v.width <= 554)).toBe(true);
  });

  test('every planned key is unique', () => {
    const plan = plannedVariants('autobacs/products/abc.jpg', 4000);
    expect(new Set(plan.map((v) => v.key)).size).toBe(plan.length);
  });

  test('drops entries whose key could not be built', () => {
    expect(plannedVariants('', 4000)).toEqual([]);
  });
});
