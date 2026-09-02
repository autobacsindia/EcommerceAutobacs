/**
 * Unit tests — infra/cloudflare/image-worker/src/worker.js (pure functions).
 *
 * The Worker is the only thing that turns the extensionless URLs the loader
 * emits into a real object key, so its format negotiation is a silent
 * single-point-of-failure: get it wrong and every browser either gets a format
 * it cannot decode or quietly loses AVIF and the bandwidth win with it.
 *
 * The fetch handler itself needs the Workers runtime (caches.default, R2
 * bindings) and is exercised by `wrangler dev`; these cover the decision logic,
 * which is where the bugs actually live.
 */
import {
  chooseFormat, isNegotiableVariant, resolveKey, safeContentType,
} from '../../../../../infra/cloudflare/image-worker/src/worker.js';
import { FORMATS, negotiableKey, variantKey } from '../../../services/storage/variants.js';

describe('chooseFormat', () => {
  test('prefers AVIF when the browser accepts it', () => {
    expect(chooseFormat('image/avif,image/webp,image/*,*/*;q=0.8').ext).toBe('avif');
  });

  test('falls back to WebP when AVIF is not accepted', () => {
    expect(chooseFormat('image/webp,image/*,*/*;q=0.8').ext).toBe('webp');
  });

  test('is case-insensitive', () => {
    expect(chooseFormat('IMAGE/AVIF').ext).toBe('avif');
  });

  test.each([
    ['image/*', 'webp'],
    ['*/*', 'webp'],
    ['text/html', 'webp'],
    ['', 'webp'],
  ])('serves a decodable fallback for Accept %p', (accept, expected) => {
    // Never 406 — a WebP an old client did not ask for beats no image at all.
    expect(chooseFormat(accept).ext).toBe(expected);
  });

  test.each([undefined, null])('handles a missing Accept header (%p)', (accept) => {
    expect(chooseFormat(accept).ext).toBe('webp');
  });

  test('only ever returns a format the generator actually produces', () => {
    // A drift guard: the Worker and the generator must agree on the format set.
    ['image/avif', 'image/webp', 'image/*', ''].forEach((a) => {
      expect(FORMATS).toContain(chooseFormat(a).ext);
    });
  });
});

describe('isNegotiableVariant', () => {
  test('recognises an extensionless variant path', () => {
    expect(isNegotiableVariant('/variants/autobacs/products/abc/w640')).toBe(true);
  });

  test('leaves an already-explicit variant alone', () => {
    // Otherwise `.avif` would become `.avif.avif`.
    expect(isNegotiableVariant('/variants/autobacs/products/abc/w640.avif')).toBe(false);
    expect(isNegotiableVariant('/variants/autobacs/products/abc/w640.webp')).toBe(false);
  });

  test.each([
    '/autobacs/products/abc.jpg',
    '/',
    '/variants/',
    '/other/path/w640',
  ])('does not treat %p as negotiable', (p) => {
    expect(isNegotiableVariant(p)).toBe(false);
  });
});

describe('resolveKey', () => {
  test('appends the negotiated extension', () => {
    expect(resolveKey('/variants/autobacs/products/abc/w640', 'image/avif'))
      .toMatchObject({ key: 'variants/autobacs/products/abc/w640.avif' });
    expect(resolveKey('/variants/autobacs/products/abc/w640', 'image/webp'))
      .toMatchObject({ key: 'variants/autobacs/products/abc/w640.webp' });
  });

  test('passes a non-variant path through verbatim', () => {
    const r = resolveKey('/autobacs/products/abc.jpg', 'image/avif');
    expect(r).toEqual({ key: 'autobacs/products/abc.jpg', format: null });
  });

  test('decodes percent-escapes back to the real key', () => {
    // `autobacs/vehicle and makes` is a real prod folder containing a space;
    // the loader encodes it, so the Worker must decode it to match the object.
    expect(resolveKey('/variants/autobacs/vehicle%20and%20makes/thar/w384', 'image/avif').key)
      .toBe('variants/autobacs/vehicle and makes/thar/w384.avif');
  });

  test('END-TO-END: the loader key + Accept resolves to the generator key', () => {
    /*
      The contract that spans three modules which never run together. If this
      drifts, every image 404s in production while every unit test still passes.
    */
    const original = 'autobacs/products/abc.jpg';
    const emitted = negotiableKey(original, 640);          // what the loader puts in the srcset
    FORMATS.forEach((fmt) => {
      const accept = `image/${fmt}`;
      const resolved = resolveKey(`/${emitted}`, accept);  // what the Worker fetches
      expect(resolved.key).toBe(variantKey(original, 640, fmt)); // what the generator wrote
    });
  });

  test('END-TO-END holds for a key containing a space', () => {
    const original = 'autobacs/vehicle and makes/thar.jpg';
    const emitted = negotiableKey(original, 384);
    const encoded = emitted.split('/').map(encodeURIComponent).join('/');
    expect(resolveKey(`/${encoded}`, 'image/avif').key)
      .toBe(variantKey(original, 384, 'avif'));
  });
});

describe('safeContentType — the delivery-side XSS boundary', () => {
  /*
    R2 does not enforce the Content-Type a presigned PUT was signed with. Verified
    against the live bucket: a URL signed for `image/png` accepted `text/html`
    bytes, and R2 served them back as `text/html`. Since this host is a subdomain
    of the apex, HTML executing here reaches parent-domain cookies.

    So the served type is decided from an allowlist rather than trusted from
    object metadata. These tests pin that, because the upload-side signing looks
    like it protects us and does not.
  */
  test('passes through the image types we actually store', () => {
    ['image/avif', 'image/webp', 'image/jpeg', 'image/png', 'image/gif']
      .forEach((t) => expect(safeContentType(t)).toBe(t));
  });

  test('DEGRADES anything executable to a non-executable type', () => {
    ['text/html', 'image/svg+xml', 'application/javascript', 'text/javascript',
      'application/xhtml+xml', 'text/xml']
      .forEach((t) => expect(safeContentType(t)).toBe('application/octet-stream'));
  });

  test('is case- and parameter-insensitive', () => {
    expect(safeContentType('IMAGE/PNG')).toBe('image/png');
    expect(safeContentType('image/png; charset=utf-8')).toBe('image/png');
    // …and the same normalisation cannot be used to smuggle html through.
    expect(safeContentType('TEXT/HTML; charset=utf-8')).toBe('application/octet-stream');
  });

  test.each([undefined, null, '', '   ', 42, {}])('degrades unusable input %p', (t) => {
    expect(safeContentType(t)).toBe('application/octet-stream');
  });

  test('image/svg+xml is NOT servable — it executes script', () => {
    // Worth its own case: it is an image type, which makes it the one most
    // likely to be added to the allowlist by mistake.
    expect(safeContentType('image/svg+xml')).toBe('application/octet-stream');
  });
});
