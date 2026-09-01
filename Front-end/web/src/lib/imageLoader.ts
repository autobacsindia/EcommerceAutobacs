/**
 * next/image loader — provider-aware.
 *
 * Three kinds of URL flow through here during (and after) the Cloudinary → R2
 * migration, and each needs different handling:
 *
 *   1. R2 (img.autobacsindia.com)  → rewrite to a PRE-GENERATED variant URL.
 *   2. Cloudinary (legacy)         → the on-the-fly transform, unchanged.
 *   3. anything else               → passed through untouched.
 *
 * Case 2 stays for as long as any document still holds a Cloudinary URL, so a
 * half-migrated catalog renders correctly and the URL rewrite can proceed one
 * collection at a time instead of as a big-bang.
 *
 * ── The R2 branch emits no file extension ───────────────────────────────────
 *     https://img.autobacsindia.com/variants/autobacs/products/abc/w640
 * A Cloudflare Worker appends `.avif` or `.webp` from the request's Accept
 * header (infra/cloudflare/image-worker). Static objects cannot
 * content-negotiate, and this keeps one URL per width in the srcset — the shape
 * next/image already produces — rather than forcing every image component to
 * become a <picture>.
 *
 * ⚠ LADDER and the key shape below MUST match services/storage/variants.js on
 *   the backend. They are duplicated because this file ships to the browser and
 *   cannot import server code; imageLoader.test.ts pins both shapes, and the
 *   backend's imageWorker.test.js pins the same contract from the other side.
 *   A silent drift here 404s every image while every unit test still passes.
 */
import cloudinaryLoader from './cloudinaryLoader';

/** Mirrors LADDER in services/storage/variants.js. */
export const LADDER = [128, 256, 384, 640, 960, 1280, 1920] as const;

/** Mirrors VARIANT_PREFIX in services/storage/variants.js. */
export const VARIANT_PREFIX = 'variants';

/**
 * Smallest ladder rung that still covers the requested width.
 *
 * Rounds UP deliberately: rounding down would hand a 700px slot a 640px image
 * and let the browser upscale it, reintroducing exactly the softness the
 * quality work on the Cloudinary loader existed to remove.
 */
export function pickWidth(requested: number): number {
  const w = Number(requested);
  if (!Number.isFinite(w) || w <= 0) return LADDER[0];
  return LADDER.find((rung) => rung >= w) ?? LADDER[LADDER.length - 1];
}

/** Host that serves R2 objects. Env-driven — never hardcode the CDN host. */
const r2Host = (): string => {
  const base = process.env.NEXT_PUBLIC_IMAGE_BASE_URL || '';
  try {
    return base ? new URL(base).host : '';
  } catch {
    return '';
  }
};

/** Is this one of our R2-hosted originals? */
export function isR2Url(src: string, host = r2Host()): boolean {
  if (!host || typeof src !== 'string') return false;
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

/**
 * Rewrite an R2 original URL to its variant URL for the given width.
 * Returns '' when the URL cannot be rewritten, so the caller can fall back.
 */
export function toVariantUrl(src: string, width: number): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return '';
  }

  // Already a variant (a re-entrant call, or a hand-written URL) — leave it be.
  const path = url.pathname.replace(/^\/+/, '');
  if (!path || path.startsWith(`${VARIANT_PREFIX}/`)) return '';

  // Strip the original extension: the variant key is extensionless so the
  // Worker can choose one. Matches publicIdFromR2Key() on the backend.
  const base = path.replace(/\.[a-z0-9]+$/i, '');
  if (!base) return '';

  return `${url.origin}/${VARIANT_PREFIX}/${base}/w${pickWidth(width)}`;
}

type LoaderArgs = { src: string; width: number; quality?: number };

export default function imageLoader({ src, width, quality }: LoaderArgs): string {
  /*
    Total by contract. This is a LEAF called during render by every image on the
    site, so a throw here does not blank one image — it unwinds the React tree
    and white-screens the page. A banner slot with no artwork uploaded is enough
    to trigger it, which is exactly what a missing promo banner once did.
  */
  if (typeof src !== 'string' || !src) return src;

  if (isR2Url(src)) {
    const variant = toVariantUrl(src, width);
    // Fall back to the original object if the URL could not be rewritten —
    // a correct-but-larger image beats a broken one.
    return variant || src;
  }

  return cloudinaryLoader({ src, width, quality });
}
