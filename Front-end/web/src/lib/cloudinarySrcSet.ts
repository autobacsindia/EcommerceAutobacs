/**
 * Build a responsive `srcSet` for a Cloudinary delivery URL — the plain-`<img>`
 * equivalent of what `next/image` + `cloudinaryLoader.ts` do for optimized
 * images.
 *
 * Our redesign showcase images (hero, before/after) render through a plain
 * <img> (see components/home/redesign/Img.tsx), NOT next/image, so they get NO
 * srcset: a single baked width is shipped to every device — a 390px phone
 * downloads the same file as a 5K monitor, and high-DPR screens upscale a
 * fixed width and look soft. This helper expands ONE Cloudinary base URL into a
 * width-set so the browser can pick the smallest variant that satisfies its
 * viewport × DPR.
 *
 * It mirrors cloudinaryLoader.ts exactly on the parts that matter:
 *   - `f_auto` (WebP/AVIF), `q_auto` (perceptual quality), `c_limit`
 *     (downscale-only — never upscales past the source, so a w_2560 candidate
 *     on a 1672px source simply returns 1672px, never a blurry upscale).
 *   - Non-Cloudinary URLs return `undefined` (caller omits srcSet entirely).
 *
 * Any width in the base URL's transform is replaced per-candidate; f_/q_/c_
 * params already present are preserved, and any missing ones are added, so the
 * output is consistent regardless of how the base URL was written.
 */

const UPLOAD_MARKER = '/image/upload/';

/** Full-bleed (100vw) default width ladder. Small end keeps phones cheap; large
 * end (2560) lets a hi-res source stay crisp on retina/4K. c_limit caps each
 * candidate at the source width, so extra rungs are harmless on small sources. */
export const DEFAULT_WIDTHS = [640, 828, 1080, 1440, 1920, 2560] as const;

// A Cloudinary transformation segment is a comma-separated list of `key_value`
// params. Same test as cloudinaryLoader.ts: every part starts with `^[a-z]+_`.
// A version (`v12345`) or a bare folder never matches, so those are treated as
// "no transform" and we inject a fresh one.
const isTransformSegment = (segment: string): boolean =>
  segment.length > 0 && segment.split(',').every((part) => /^[a-z]+_/.test(part));

/**
 * @returns a `srcSet` string (`url 640w, url 828w, …`) or `undefined` when `src`
 *          is not a transformable Cloudinary URL (caller should then omit srcSet).
 */
export function cloudinarySrcSet(
  src: string,
  widths: readonly number[] = DEFAULT_WIDTHS,
): string | undefined {
  if (!src.includes('res.cloudinary.com')) return undefined;

  const uploadAt = src.indexOf(UPLOAD_MARKER);
  if (uploadAt === -1) return undefined;

  const prefix = src.slice(0, uploadAt + UPLOAD_MARKER.length); // …/image/upload/
  const rest = src.slice(uploadAt + UPLOAD_MARKER.length);      // [transform/]v123/folder/img.jpg

  const parts = rest.split('/');
  let baseParams: string[];
  let tail: string;

  if (isTransformSegment(parts[0])) {
    // Reuse the existing transform but drop any width — we set it per candidate.
    baseParams = parts[0].split(',').filter((p) => !/^w_/.test(p));
    tail = parts.slice(1).join('/');
  } else {
    // No transform on the URL (bare version/folder) — inject a fresh one.
    baseParams = [];
    tail = rest;
  }

  // Guarantee the delivery essentials, without duplicating any already present.
  if (!baseParams.some((p) => /^f_/.test(p))) baseParams.push('f_auto');
  if (!baseParams.some((p) => /^q_/.test(p))) baseParams.push('q_auto');
  if (!baseParams.some((p) => /^c_/.test(p))) baseParams.push('c_limit');

  return widths
    .map((w) => `${prefix}${[...baseParams, `w_${w}`].join(',')}/${tail} ${w}w`)
    .join(', ');
}
