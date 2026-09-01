/**
 * Unit tests — src/lib/imageLoader.ts
 *
 * Two things are being protected here.
 *
 * 1. TOTALITY. The loader is a render leaf called for every image on the site.
 *    A throw does not blank one image, it unwinds the React tree and
 *    white-screens the page — a missing promo banner did exactly that once.
 *
 * 2. THE VARIANT CONTRACT. The ladder and key shape are duplicated from
 *    services/storage/variants.js because this file ships to the browser and
 *    cannot import server code. If the two drift, every image 404s in
 *    production while every unit test still passes, so the shapes are pinned
 *    literally here and from the other side in the backend's imageWorker test.
 */
import imageLoader, { pickWidth, isR2Url, toVariantUrl, LADDER, VARIANT_PREFIX } from './imageLoader';

const R2 = 'https://img.autobacsindia.com';
const ORIGINAL = `${R2}/autobacs/products/abc123.jpg`;

beforeEach(() => { process.env.NEXT_PUBLIC_IMAGE_BASE_URL = R2; });

describe('the ladder contract (must match services/storage/variants.js)', () => {
  test('is exactly the backend ladder', () => {
    expect([...LADDER]).toEqual([128, 256, 384, 640, 960, 1280, 1920]);
  });

  test('variant prefix matches the backend', () => {
    expect(VARIANT_PREFIX).toBe('variants');
  });
});

describe('pickWidth', () => {
  test('rounds UP to the covering rung, never down', () => {
    expect(pickWidth(700)).toBe(960);
    expect(pickWidth(129)).toBe(256);
  });

  test('maps each rung to itself', () => {
    LADDER.forEach((r) => expect(pickWidth(r)).toBe(r));
  });

  test('clamps beyond the ladder', () => {
    expect(pickWidth(4000)).toBe(1920);
  });

  test.each([0, -1, NaN, undefined as unknown as number])('falls back to the smallest rung for %p', (w) => {
    expect(pickWidth(w)).toBe(LADDER[0]);
  });
});

describe('isR2Url', () => {
  test('matches our delivery host', () => {
    expect(isR2Url(ORIGINAL)).toBe(true);
  });

  test('does not match Cloudinary or anything else', () => {
    expect(isR2Url('https://res.cloudinary.com/x/image/upload/v1/a.jpg')).toBe(false);
    expect(isR2Url('https://images.unsplash.com/photo-1')).toBe(false);
  });

  test('is false when the host env var is unset — never guess', () => {
    delete process.env.NEXT_PUBLIC_IMAGE_BASE_URL;
    expect(isR2Url(ORIGINAL)).toBe(false);
  });

  test.each(['', 'not a url', '/local/path.jpg'])('handles unparseable src %p', (s) => {
    expect(isR2Url(s)).toBe(false);
  });
});

describe('toVariantUrl', () => {
  test('builds the extensionless variant URL the Worker resolves', () => {
    expect(toVariantUrl(ORIGINAL, 640)).toBe(`${R2}/variants/autobacs/products/abc123/w640`);
  });

  test('snaps an off-ladder width to a real rung', () => {
    expect(toVariantUrl(ORIGINAL, 700)).toBe(`${R2}/variants/autobacs/products/abc123/w960`);
  });

  test('strips the original extension whatever it is', () => {
    expect(toVariantUrl(`${R2}/autobacs/products/abc.png`, 256))
      .toBe(`${R2}/variants/autobacs/products/abc/w256`);
  });

  test('does not double-wrap an URL that is already a variant', () => {
    expect(toVariantUrl(`${R2}/variants/autobacs/products/abc/w640`, 640)).toBe('');
  });

  test('keeps a percent-encoded space encoded', () => {
    // `autobacs/vehicle and makes` is a real prod folder; the Worker decodes it.
    expect(toVariantUrl(`${R2}/autobacs/vehicle%20and%20makes/thar.jpg`, 384))
      .toBe(`${R2}/variants/autobacs/vehicle%20and%20makes/thar/w384`);
  });

  test.each(['', 'nonsense', `${R2}/`])('returns "" for unusable src %p', (s) => {
    expect(toVariantUrl(s, 640)).toBe('');
  });
});

describe('imageLoader routing', () => {
  test('R2 originals become variant URLs', () => {
    expect(imageLoader({ src: ORIGINAL, width: 640 }))
      .toBe(`${R2}/variants/autobacs/products/abc123/w640`);
  });

  test('legacy Cloudinary URLs still get the on-the-fly transform', () => {
    // Must keep working: the URL rewrite runs one collection at a time, so a
    // half-migrated catalog has both kinds of URL live at once.
    const out = imageLoader({
      src: 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1/autobacs/products/x.jpg',
      width: 640,
    });
    expect(out).toContain('/image/upload/');
    expect(out).toContain('w_640');
    expect(out).toContain('f_auto');
  });

  test('unknown hosts pass through untouched', () => {
    const src = 'https://images.unsplash.com/photo-1?w=800';
    expect(imageLoader({ src, width: 640 })).toBe(src);
  });

  test('falls back to the original object when the URL cannot be rewritten', () => {
    // A correct-but-larger image beats a broken one.
    const already = `${R2}/variants/autobacs/products/abc/w640`;
    expect(imageLoader({ src: already, width: 640 })).toBe(already);
  });

  test.each([undefined, null, '', 0, {}, []])('NEVER throws on unusable src %p', (src) => {
    // A throw here white-screens the whole page, not just one image.
    expect(() => imageLoader({ src: src as unknown as string, width: 640 })).not.toThrow();
  });

  test('never throws on an unusable width', () => {
    expect(() => imageLoader({ src: ORIGINAL, width: NaN })).not.toThrow();
    expect(imageLoader({ src: ORIGINAL, width: NaN })).toContain('/w128');
  });
});
