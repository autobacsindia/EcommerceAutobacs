/**
 * img.autobacsindia.com — serves pre-generated image variants from R2, choosing
 * AVIF or WebP per request.
 *
 * This Worker exists for exactly one reason: a static object cannot
 * content-negotiate. The catalog is pre-rendered into AVIF *and* WebP at each
 * ladder width (see services/storage/variants.js), and something has to read
 * the browser's Accept header and pick. Doing it here keeps ONE url per
 * (image, width) in the srcset — the shape next/image already emits — instead
 * of rewriting every image component to use <picture>.
 *
 * It does NO image processing. It is a key rewrite plus a cache lookup, so it
 * costs ~1ms and stays inside the Workers free tier at current volume
 * (~1.07M requests/month ≈ 36k/day against a 100k/day allowance).
 *
 *   GET /variants/autobacs/products/abc/w640
 *        → variants/autobacs/products/abc/w640.avif   (Accept: image/avif)
 *        → variants/autobacs/products/abc/w640.webp   (otherwise)
 *
 * Any other path is served from R2 verbatim, so originals and non-image assets
 * still resolve.
 *
 * ── Why the cache key carries the format ────────────────────────────────────
 * The response for one URL differs by Accept, so a cache keyed on URL alone
 * would serve a cached AVIF to a browser that cannot decode it — a broken image
 * for that user, cached and repeated. `Vary: Accept` is the HTTP answer but is
 * unreliable across intermediaries (and Cloudflare ignores Vary on most plans),
 * so the chosen format is folded into the cache key instead. Vary is still sent
 * for correctness with any downstream cache that does honour it.
 */

const VARIANT_PREFIX = 'variants/';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Content types this host is allowed to serve.
 *
 * ⚠ SECURITY BOUNDARY, not a tidiness rule. R2 does NOT enforce the Content-Type
 * that a presigned PUT was signed with — verified against the live bucket: a URL
 * signed for `image/png` accepted `text/html` bytes and R2 then served them back
 * as `text/html`. Because this host is a subdomain of the apex, HTML executing
 * here is stored XSS with access to parent-domain cookies.
 *
 * So the served type is decided HERE from an allowlist rather than trusted from
 * object metadata. Anything unrecognised degrades to a non-executable type. This
 * holds no matter how the object got into the bucket, which is the property that
 * matters — upload-side checks can be bypassed or added to later.
 */
const SERVABLE_TYPES = new Set([
  'image/avif', 'image/webp', 'image/jpeg', 'image/png', 'image/gif',
]);
const FALLBACK_TYPE = 'application/octet-stream';

/** Clamp a stored content type to something safe to serve from this host. */
export function safeContentType(stored) {
  const t = String(stored || '').split(';')[0].trim().toLowerCase();
  return SERVABLE_TYPES.has(t) ? t : FALLBACK_TYPE;
}

/** Formats we pre-generate, best first. Must match FORMATS in variants.js. */
const CANDIDATES = [
  { ext: 'avif', mime: 'image/avif', token: 'image/avif' },
  { ext: 'webp', mime: 'image/webp', token: 'image/webp' },
];

/**
 * Pick an output format from Accept.
 *
 * WebP is the fallback rather than "reject": every browser that reaches a
 * modern storefront supports it, and serving a WebP to a client that did not
 * explicitly ask beats serving nothing. A client that asks for neither still
 * gets a decodable image.
 */
export function chooseFormat(accept) {
  const header = (accept || '').toLowerCase();
  for (const c of CANDIDATES) {
    if (header.includes(c.token)) return c;
  }
  // `image/*` or a missing header — take the safe, widely-decodable option.
  return CANDIDATES[CANDIDATES.length - 1];
}

/** True when this path is an extensionless variant request. */
export function isNegotiableVariant(pathname) {
  if (!pathname.startsWith(`/${VARIANT_PREFIX}`)) return false;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  // `w640` yes; `w640.avif` no (already explicit); empty no.
  return last.length > 0 && !last.includes('.');
}

/** Map a request path to the R2 object key to fetch. */
export function resolveKey(pathname, accept) {
  const raw = decodeURIComponent(pathname.replace(/^\/+/, ''));
  if (!isNegotiableVariant(pathname)) return { key: raw, format: null };
  const format = chooseFormat(accept);
  return { key: `${raw}.${format.ext}`, format };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
    const accept = request.headers.get('Accept');
    const { key, format } = resolveKey(url.pathname, accept);

    if (!key) return new Response('Not Found', { status: 404 });

    /*
      Fold the chosen format into the cache key. Two browsers hitting the same
      URL with different Accept headers must not share an entry — see header.
    */
    const cacheUrl = new URL(request.url);
    if (format) cacheUrl.searchParams.set('__fmt', format.ext);
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const object = await env.BUCKET.get(key);
    if (!object) {
      /*
        A missing variant means the generator has not caught up with this image
        yet. Fall back to the ORIGINAL rather than 404ing: a correct but larger
        image is a far better failure than a hole in the product grid. The
        fallback is NOT cached long, so it stops as soon as the variant lands.
      */
      const originalKey = key
        .replace(new RegExp(`^${VARIANT_PREFIX}`), '')
        .replace(/\/w\d+\.(avif|webp)$/, '');
      const original = await findOriginal(env.BUCKET, originalKey);
      if (!original) return new Response('Not Found', { status: 404 });

      return new Response(original.body, {
        headers: {
          'Content-Type': safeContentType(original.httpMetadata?.contentType),
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'X-Variant-Fallback': 'original',
        },
      });
    }

    const headers = new Headers();
    /*
      For a negotiated variant the type is ours by construction (we chose .avif
      or .webp); for a pass-through original it comes from object metadata and is
      therefore untrusted — see SERVABLE_TYPES.
    */
    headers.set('Content-Type', format ? format.mime : safeContentType(object.httpMetadata?.contentType));
    headers.set('Cache-Control', object.httpMetadata?.cacheControl || IMMUTABLE);
    // Belt to the allowlist's braces: stops a browser from sniffing its way to
    // a different type than the one we declared.
    headers.set('X-Content-Type-Options', 'nosniff');
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    if (format) headers.set('Vary', 'Accept');

    const response = new Response(object.body, { headers });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};

/**
 * Originals keep their source extension, which the variant key has thrown away.
 * Try the ones we accept on upload rather than storing a lookup table.
 */
async function findOriginal(bucket, baseKey) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const found = await bucket.get(`${baseKey}.${ext}`);
    if (found) return found;
  }
  return bucket.get(baseKey);
}
