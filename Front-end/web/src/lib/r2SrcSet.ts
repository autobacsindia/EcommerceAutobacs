/**
 * Build a responsive `srcSet` for an R2-hosted image — the R2 twin of
 * `cloudinarySrcSet()`, for components that render a plain `<img>` instead of
 * `next/image`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `Img.tsx` (the redesign's plain-<img> wrapper) only ever knew how to build a
 * srcSet for Cloudinary URLs. Since the catalog moved to R2, `cloudinarySrcSet`
 * returns `undefined` for every one of those URLs, so the <img> shipped the raw
 * ORIGINAL object to every device at every DPR. Measured on the live home page:
 * the nav logo is a 254 KB PNG rendered into a 125x48 box — 97.6% waste, and it
 * was the Largest Contentful Paint element. The w128 AVIF variant of that same
 * logo is 5.8 KB.
 *
 * Nothing here generates or stores an image. The variants are pre-rendered at
 * upload time (`services/storage/variants.js`) and negotiated to AVIF or WebP
 * per request by the Worker (`infra/cloudflare/image-worker`) — this only names
 * the URLs that already exist.
 *
 * ⚠ The ladder and the key shape are NOT redefined here. They are imported from
 *   `imageLoader.ts`, which is the single frontend definition and is itself
 *   pinned against the backend by `imageLoader.test.ts`. A second copy of the
 *   ladder is exactly the drift that 404s every image while all unit tests pass.
 */
import { LADDER, isR2Url, toVariantUrl } from './imageLoader';

/**
 * @param src    an R2 original URL (NOT an already-rewritten `/variants/...` URL)
 * @param widths ladder rungs to emit; defaults to the full shared ladder
 * @returns a `srcSet` string (`url 128w, url 256w, …`), or `undefined` when
 *          `src` is not a rewritable R2 URL — the caller must then omit srcSet
 *          entirely rather than emit a broken one.
 */
export function r2SrcSet(
  src: string,
  widths: readonly number[] = LADDER,
): string | undefined {
  // Same leaf-safety rule as imageLoader: this runs during render for every
  // image on the page, so a nullish/odd URL must yield "no srcSet", never a
  // throw that unwinds the React tree and white-screens the page.
  if (typeof src !== 'string' || !src || !isR2Url(src)) return undefined;

  const candidates: string[] = [];
  for (const w of widths) {
    const url = toVariantUrl(src, w);
    // '' means the URL could not be rewritten (already a variant, no path, or
    // unparseable). One bad rung invalidates the whole set — a srcSet with a
    // hole is worse than none, because the browser may pick the hole.
    if (!url) return undefined;
    candidates.push(`${url} ${w}w`);
  }

  return candidates.length > 0 ? candidates.join(', ') : undefined;
}
