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

// Cloudinary transform tokens we look for to detect an already-transformed URL.
const TRANSFORM_TOKEN = /(^|,)(f_|q_|w_|h_|c_|e_|dpr_|g_|b_|r_|ar_|l_|o_|fl_)/;

type LoaderArgs = { src: string; width: number; quality?: number };

export default function cloudinaryLoader({ src, width, quality }: LoaderArgs): string {
  // Only rewrite Cloudinary delivery URLs; everything else is served verbatim.
  if (!src.includes('res.cloudinary.com')) return src;

  const uploadAt = src.indexOf(UPLOAD_MARKER);
  if (uploadAt === -1) return src;

  const prefix = src.slice(0, uploadAt + UPLOAD_MARKER.length); // …/image/upload/
  const rest = src.slice(uploadAt + UPLOAD_MARKER.length);      // v123/folder/img.jpg

  // If the first path segment already looks like a transformation, leave it be.
  const firstSegment = rest.split('/')[0];
  if (TRANSFORM_TOKEN.test(firstSegment)) return src;

  const transform = [
    'f_auto',                       // best format the browser accepts (AVIF/WebP)
    `q_${quality ?? 'auto'}`,       // smart quality unless an explicit one is passed
    'c_limit',                      // downscale-only, preserve aspect ratio
    `w_${width}`,                   // width chosen by next/image's srcset
  ].join(',');

  return `${prefix}${transform}/${rest}`;
}
