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
  LADDER, FORMATS, VARIANT_PREFIX, FULL_RUNG,
  widthsFor, variantKey, negotiableKey, pickWidth, plannedVariants,
  fullVariantKey, variantPrefixFor,
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
    // Three rungs fit under 554 (128/256/384), each in every format, plus the
    // full rung at the source's own width — which is still not an upscale.
    expect(plan.filter((v) => !v.full)).toHaveLength(3 * FORMATS.length);
    expect(plan.filter((v) => v.full)).toHaveLength(FORMATS.length);
    // The property that actually matters, and the one the rule is named for.
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

// ── The full-resolution rung ────────────────────────────────────────────────
/*
  The ladder never upscales, so a source narrower than a rung has nothing at that
  rung — but next/image emits a srcset across EVERY rung regardless of the
  source, and the browser picks a large candidate. Measured on the live PDP: a
  533px image was requested at w128 through w1920 and everything above w384 fell
  through to the raw PNG. `full` is the source at its own width, so the Worker
  can answer those requests with the same pixels in a modern codec.
*/
describe('fullVariantKey', () => {
  test('sits beside the numbered rungs, under the same prefix', () => {
    const k = 'autobacs/products/a/photo.png';
    expect(fullVariantKey(k, 'avif')).toBe('variants/autobacs/products/a/photo/full.avif');
    expect(fullVariantKey(k, 'avif').startsWith(variantPrefixFor(k))).toBe(true);
  });

  test('rejects a format we do not generate', () => {
    expect(fullVariantKey('autobacs/products/a/photo.png', 'jpeg')).toBe('');
    expect(fullVariantKey('autobacs/products/a/photo.png', 'gif')).toBe('');
  });

  test('rejects an empty key', () => {
    expect(fullVariantKey('', 'avif')).toBe('');
    expect(fullVariantKey(null, 'avif')).toBe('');
  });
});

describe('plannedVariants — the full rung', () => {
  const K = 'autobacs/products/a/photo.png';
  const names = (w) => plannedVariants(K, w).map((v) => v.key.split('/').pop());

  test('a source narrower than the top rung gets a full variant per format', () => {
    const out = names(533);
    expect(out).toEqual(expect.arrayContaining(['full.avif', 'full.webp']));
    // and still gets every rung it can actually fill
    expect(out).toEqual(expect.arrayContaining(['w128.avif', 'w256.avif', 'w384.avif']));
    // …and none it cannot
    expect(out).not.toEqual(expect.arrayContaining(['w640.avif']));
  });

  test('records the SOURCE width for the full rung, so it is never upscaled', () => {
    const full = plannedVariants(K, 533).filter((v) => v.full);
    expect(full).toHaveLength(2);
    full.forEach((v) => expect(v.width).toBe(533));
  });

  /*
    A source at or above the top rung needs no full variant: pickWidth caps
    requests at 1920, so the exact rung always exists and the fallback is
    unreachable. Generating one anyway would duplicate w1920 for every large
    image — pure storage waste.
  */
  test('a source at or above the top rung gets NO full variant', () => {
    expect(names(1920)).not.toEqual(expect.arrayContaining(['full.avif']));
    expect(names(4000)).not.toEqual(expect.arrayContaining(['full.avif']));
  });

  test('an unknown source width plans rungs but no full variant', () => {
    expect(names(0)).not.toEqual(expect.arrayContaining(['full.avif']));
    expect(names(undefined)).not.toEqual(expect.arrayContaining(['full.avif']));
  });

  test('every planned key is unique — nothing is encoded twice', () => {
    const keys = plannedVariants(K, 533).map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
