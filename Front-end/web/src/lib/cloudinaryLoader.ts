/**
 * Custom next/image loader — Cloudinary on-the-fly delivery transforms.
 *
 * Our product/media images are stored on Cloudinary but the persisted
 * `secure_url` carries NO delivery transform, e.g.
 *   res.cloudinary.com/<cloud>/image/upload/v1783950357/autobacs/products/x.jpg
 * so Cloudinary serves the FULL-RESOLUTION original JPEG for every request —
 * even a 300px card thumbnail. This loader injects a responsive transform
 * (`f_auto,q_auto,c_limit,w_<width>`) right after `/upload/`, so Cloudinary
 * generates + edge-caches an appropriately sized WebP/AVIF variant. No
 * re-upload or data migration is needed; the stored URL is unchanged.
 *
 * Measured: a stored 215 KB JPEG → 54 KB WebP at w_600 (−75%).
 *
 * Safety:
 *   - Non-Cloudinary URLs (local /public fallbacks, any other host) pass through
 *     untouched.
 *   - URLs that ALREADY carry a transform (e.g. a logo with `e_trim,f_auto,q_auto`)
 *     pass through untouched — we never double-transform.
 *   - `c_limit` never upscales past the original and preserves aspect ratio, so
 *     no image is stretched or blown up.
 */

const UPLOAD_MARKER = '/image/upload/';

// A Cloudinary transformation component is a comma-separated list of `key_value`
// params (f_auto, q_auto, w_600, e_trim, a named transform t_thumb, …). We treat
// the first path segment after /upload/ as an existing transformation when EVERY
// comma-separated part starts with a Cloudinary param prefix (`^[a-z]+_`). This
// generalises over the whole param namespace instead of an ad-hoc allowlist
// (which missed t_/x_/y_/co_/… and could double-transform), and it can never
// match a version (`v12345`, no underscore) or a plain folder (`autobacs`), so
// those still get a transform injected. Ambiguous segments err toward NOT
// injecting (skip optimization) rather than corrupting the URL.
const isTransformSegment = (segment: string): boolean =>
  segment.length > 0 && segment.split(',').every((part) => /^[a-z]+_/.test(part));

type LoaderArgs = { src: string; width: number; quality?: number };

export default function cloudinaryLoader({ src, width, quality }: LoaderArgs): string {
  // Only rewrite Cloudinary delivery URLs; everything else is served verbatim.
  if (!src.includes('res.cloudinary.com')) return src;

  const uploadAt = src.indexOf(UPLOAD_MARKER);
  if (uploadAt === -1) return src;

  const prefix = src.slice(0, uploadAt + UPLOAD_MARKER.length); // …/image/upload/
  const rest = src.slice(uploadAt + UPLOAD_MARKER.length);      // v123/folder/img.jpg

  // If the first path segment already carries a transformation, leave it be —
  // never double-transform.
  const firstSegment = rest.split('/')[0];
  if (isTransformSegment(firstSegment)) return src;

  const transform = [
    'f_auto',                       // best format the browser accepts (AVIF/WebP)
    `q_${quality ?? 'auto'}`,       // smart quality unless an explicit one is passed
    'c_limit',                      // downscale-only, preserve aspect ratio
    `w_${width}`,                   // width chosen by next/image's srcset
  ].join(',');

  return `${prefix}${transform}/${rest}`;
}
