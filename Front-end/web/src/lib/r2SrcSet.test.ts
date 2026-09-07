/**
 * Unit tests — src/lib/r2SrcSet.ts
 *
 * The regression being locked down: `Img.tsx` built its srcSet with
 * `cloudinarySrcSet()` only. That helper returns `undefined` for an R2 URL, so
 * after the Cloudinary → R2 move EVERY plain-<img> in the redesign silently
 * shipped its raw original — the nav logo sent a 254 KB PNG into a 125x48 box
 * and became the home page's LCP element. "No srcSet" is indistinguishable from
 * "not applicable" at the call site, which is why it went unnoticed; these tests
 * assert the R2 branch produces real candidates.
 */
import { r2SrcSet } from './r2SrcSet';
import { LADDER } from './imageLoader';

const R2 = 'https://img.autobacsindia.com';
const ORIGINAL = `${R2}/autobacs/site/roavion-primary-trimmed.png`;

beforeEach(() => { process.env.NEXT_PUBLIC_IMAGE_BASE_URL = R2; });

describe('r2SrcSet', () => {
  test('emits one extensionless variant candidate per ladder rung', () => {
    const out = r2SrcSet(ORIGINAL);
    expect(out).toBeDefined();
    const parts = out!.split(', ');
    expect(parts).toHaveLength(LADDER.length);
    LADDER.forEach((w, i) => {
      expect(parts[i]).toBe(
        `${R2}/variants/autobacs/site/roavion-primary-trimmed/w${w} ${w}w`,
      );
    });
  });

  test('drops the source extension so the Worker can negotiate AVIF/WebP', () => {
    // An extension here would defeat content negotiation and 404 the object.
    expect(r2SrcSet(ORIGINAL)).not.toMatch(/\.png\s/);
    expect(r2SrcSet(ORIGINAL)).not.toMatch(/\.(avif|webp|jpg)\s/);
  });

  test('honours an explicit width subset', () => {
    expect(r2SrcSet(ORIGINAL, [128, 256])).toBe(
      `${R2}/variants/autobacs/site/roavion-primary-trimmed/w128 128w, ` +
      `${R2}/variants/autobacs/site/roavion-primary-trimmed/w256 256w`,
    );
  });

  test('returns undefined for a non-R2 host so the caller omits srcSet', () => {
    expect(r2SrcSet('https://res.cloudinary.com/demo/image/upload/v1/a.jpg')).toBeUndefined();
    expect(r2SrcSet('https://images.unsplash.com/photo-1?w=800')).toBeUndefined();
  });

  test('returns undefined for a URL that is ALREADY a variant', () => {
    // Re-entrant call — rewriting a variant would nest the prefix and 404.
    expect(r2SrcSet(`${R2}/variants/autobacs/site/logo/w128`)).toBeUndefined();
  });

  test('is total: no input can make it throw', () => {
    // This runs during render; a throw white-screens the page rather than
    // blanking one image. Same totality rule as imageLoader.
    const bad = [undefined, null, '', 0, {}, [], 'not-a-url', '://', NaN];
    for (const v of bad) {
      expect(() => r2SrcSet(v as unknown as string)).not.toThrow();
      expect(r2SrcSet(v as unknown as string)).toBeUndefined();
    }
  });

  test('yields no srcSet when the image host is not configured', () => {
    delete process.env.NEXT_PUBLIC_IMAGE_BASE_URL;
    expect(r2SrcSet(ORIGINAL)).toBeUndefined();
  });
});
