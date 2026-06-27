/**
 * Canonical public origin of the frontend, normalized once so no call site has to
 * defend against a malformed `NEXT_PUBLIC_APP_URL`.
 *
 * `NEXT_PUBLIC_APP_URL` is build-time baked. A value without a scheme (e.g. a bare
 * `ecommerce-autobacs.vercel.app`) makes `new URL()` / `metadataBase` throw
 * `ERR_INVALID_URL` and fails the entire production build. We coerce `https://` when
 * the scheme is missing and strip any trailing slash so canonical/OG URLs are stable.
 *
 * Set the env with the scheme in prod (`https://autobacsindia.com`); this normalizer
 * is the safety net, not a license to omit it.
 */
const FALLBACK = 'http://localhost:3000';

function normalize(raw: string | undefined): string {
  const value = (raw ?? '').trim() || FALLBACK;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}

export const SITE_URL = normalize(process.env.NEXT_PUBLIC_APP_URL);
