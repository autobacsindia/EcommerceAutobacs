/**
 * Custom next/image loader — Cloudinary on-the-fly delivery transforms.
 *
 * Our product/media images are stored on Cloudinary but the persisted
 * `secure_url` carries NO delivery transform, e.g.
 *   res.cloudinary.com/<cloud>/image/upload/v1783950357/autobacs/products/x.jpg
 * so Cloudinary serves the FULL-RESOLUTION original JPEG for every request —
 * even a 300px card thumbnail. This loader injects a responsive transform
 * (`f_auto,q_auto:best,e_sharpen:60,c_limit,w_<width>`) right after `/upload/`,
 * so Cloudinary generates + edge-caches an appropriately sized WebP/AVIF
 * variant. No re-upload or data migration is needed; the stored URL is unchanged.
 *
 * `f_auto` (AVIF/WebP) already saves ~70–75% vs the stored original; the quality
 * tier and the light sharpen are each discussed at their param lines below.
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

  // Quality tier — this is what keeps images crisp on standard (DPR-1) monitors.
  //
  // Bare `q_auto` (≈ `q_auto:good`) is tuned for byte savings and softens
  // photographic detail. A DPR-1 display (most Windows laptops/desktops at 100%
  // scaling) fetches a rendition and views it ~1:1, with no supersampling
  // headroom to hide that softening — so product shots read blurry there, while
  // a Retina/4K (DPR-2/3) screen fetches a larger rendition and packs 4–9 device
  // pixels per CSS pixel, masking the same artifacts. That is the entire "sharp
  // on my Mac, soft on that Windows monitor" report: same page, same served
  // pixels, but only the DPR-1 screen sees the compression at 1:1.
  //
  // The fix is content-crisp delivery at `q_auto:best` for EVERY rendition. We
  // deliberately do NOT tier by width: DPR is invisible to a loader (it only
  // sees the srcset width next/image picked), so a width threshold can't tell a
  // 1920-wide rendition fetched by a DPR-2 phone (supersampled — `good` is fine)
  // from the same width fetched 1:1 by a 1920px DPR-1 monitor (needs `best`).
  // Any cutoff therefore leaves some common DPR-1 screen soft — the exact bug.
  //
  // Cost is bounded and measured against prod: our product originals top out
  // around ~1080px (Cloudinary `c_limit` clamps there), so `best` maxes at
  // ~200 KB for the heaviest PDP shot and 13–99 KB per card; the largest
  // full-bleed marketing banner is ~212 KB at w_1920. `f_auto` (AVIF/WebP) is
  // doing the heavy lifting; `best` trades ~20–85% more bytes on top for
  // artifact-free detail — the right call for a product where the image is the
  // sell. A byte-sensitive caller can still pass an explicit numeric `quality`
  // (via next/image's `quality` prop); it always wins over this default.
  const q = quality != null ? String(quality) : 'auto:best';

  // Light output sharpening — recovers acuity that `best` quality alone can't.
  //
  // Two per-machine effects soften an image AFTER delivery, independent of
  // compression: (1) downscaling a rendition to its final box, and (2) a browser
  // resampling to a FRACTIONAL device-pixel-ratio — Windows at 125%/150% display
  // scaling (DPR 1.25/1.5) never lands on an integer pixel grid, so every image
  // is bilinearly resampled and reads soft. macOS/Retina at a clean DPR 2.0 sits
  // on-grid and dodges this, which is exactly why "sharp on the Mac, soft on that
  // Windows laptop" persists even at `q_auto:best`. A mild unsharp pass restores
  // perceived edge acuity on those screens (and on lower-quality panels) without
  // the crunchy halos of an aggressive value. `:60` is deliberately subtle and,
  // measured on prod, stays on WebP (+~11% bytes); higher values (`:100`) push
  // Cloudinary off WebP back to JPEG and start haloing on good displays, so don't
  // raise it without eyeballing the result. Cloudinary applies effects after the
  // resize, so this sharpens the final downscaled rendition, not the original.
  const transform = [
    'f_auto',                       // best format the browser accepts (AVIF/WebP)
    `q_${q}`,                       // crisp-at-1:1 tier (see above); explicit prop wins
    'e_sharpen:60',                 // subtle unsharp — counters downscale + fractional-DPR softening
    'c_limit',                      // downscale-only, preserve aspect ratio
    `w_${width}`,                   // width chosen by next/image's srcset
  ].join(',');

  return `${prefix}${transform}/${rest}`;
}
