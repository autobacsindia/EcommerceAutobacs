/**
 * Pre-generated image variant scheme.
 *
 * Instead of transforming on the fly, every public catalog image is rendered
 * once into a fixed ladder of widths × {AVIF, WebP} and stored as plain objects
 * in R2. Delivery is then a static object read: free egress, no transformation
 * meter, and no per-variant cold-start latency for whoever happens to be the
 * first visitor to request a given size.
 *
 * ── The URL shape, and why it has no extension ──────────────────────────────
 * The loader emits ONE url per (image, width):
 *
 *     https://img.autobacsindia.com/variants/autobacs/products/abc123/w640
 *
 * and a Cloudflare Worker appends `.avif` or `.webp` based on the request's
 * Accept header. A static object cannot content-negotiate by itself, and the
 * alternatives are worse: baking the format into the URL means either shipping
 * WebP to everyone (forgoing ~50% of the bytes AVIF saves) or rewriting every
 * image component to emit <picture>. One extensionless URL per width keeps the
 * srcset exactly the shape next/image already produces.
 *
 * ── The ladder ──────────────────────────────────────────────────────────────
 * Deliberately coarser than the four separate ladders it replaces (next/image
 * deviceSizes + imageSizes, CARD_WIDTHS, DEFAULT_WIDTHS — 14 distinct widths
 * between them). Under on-the-fly transforms an unused rung costs nothing until
 * requested; pre-generated, every rung is CPU at build time and an object
 * forever. Seven rungs cover phone-card through full-bleed-desktop at sensible
 * DPR steps; the cost of landing between rungs is that a browser downloads a
 * slightly larger image, which AVIF has already more than paid for.
 */
import { publicIdFromR2Key } from './keys.js';

/** Width rungs, ascending. */
export const LADDER = [128, 256, 384, 640, 960, 1280, 1920];

/** Formats generated for every rung, best first. */
export const FORMATS = ['avif', 'webp'];

/** Prefix that separates derivatives from originals in the bucket. */
export const VARIANT_PREFIX = 'variants';

/**
 * Name of the FULL-RESOLUTION rung: the source at its own width, never upscaled.
 *
 * ── Why a named rung and not just a number ──────────────────────────────────
 * The ladder never upscales, so a 533px source only ever gets w128/w256/w384.
 * But next/image emits a srcset across EVERY rung regardless of the source, so
 * the browser happily asks for w960 — and on any decent screen it picks one of
 * the large candidates. Measured on the live PDP: a 533px image was requested at
 * w128 through w1920, and every request above w384 fell through to the raw
 * original. Across the bucket that is 782 of 6,244 images (12.5%) serving an
 * unoptimised PNG/JPEG to most visitors.
 *
 * Falling back to the largest available RUNG instead would fix the bytes and
 * break the pixels: for a 533px source that means serving 384px into a slot
 * asking for more, i.e. visibly softer than today. So the fallback has to be the
 * source's own width — same pixels as the original, modern codec.
 *
 * The name is fixed rather than the numeric width because the Worker resolves
 * the fallback without knowing anything about the source.
 */
export const FULL_RUNG = 'full';

/**
 * Widths worth generating for a source of `sourceWidth` pixels.
 *
 * Never upscales — a rung wider than the source would be a bigger file with no
 * more detail, which is the `c_limit` rule the Cloudinary loader already held.
 * Always yields at least the smallest rung, so even a tiny source still gets one
 * variant rather than falling back to the original.
 */
export const widthsFor = (sourceWidth) => {
  const w = Number(sourceWidth);
  if (!Number.isFinite(w) || w <= 0) return [...LADDER];
  const fits = LADDER.filter((rung) => rung <= w);
  return fits.length ? fits : [LADDER[0]];
};

/**
 * Object key for the full-resolution rung.
 * `autobacs/products/abc.jpg` + avif → `variants/autobacs/products/abc/full.avif`
 */
export const fullVariantKey = (originalKey, format) => {
  if (typeof originalKey !== 'string' || !originalKey) return '';
  if (!FORMATS.includes(format)) return '';
  const base = publicIdFromR2Key(originalKey, 'image');
  if (!base) return '';
  return `${VARIANT_PREFIX}/${base}/${FULL_RUNG}.${format}`;
};

/**
 * Object key for one concrete variant.
 * `autobacs/products/abc.jpg` + 640 + avif → `variants/autobacs/products/abc/w640.avif`
 */
export const variantKey = (originalKey, width, format) => {
  if (typeof originalKey !== 'string' || !originalKey) return '';
  if (!LADDER.includes(Number(width))) return '';
  if (!FORMATS.includes(format)) return '';
  const base = publicIdFromR2Key(originalKey, 'image');
  if (!base) return '';
  return `${VARIANT_PREFIX}/${base}/w${Number(width)}.${format}`;
};

/**
 * The extensionless key the loader emits and the Worker resolves.
 * `autobacs/products/abc.jpg` + 640 → `variants/autobacs/products/abc/w640`
 */
export const negotiableKey = (originalKey, width) => {
  if (typeof originalKey !== 'string' || !originalKey) return '';
  if (!LADDER.includes(Number(width))) return '';
  const base = publicIdFromR2Key(originalKey, 'image');
  if (!base) return '';
  return `${VARIANT_PREFIX}/${base}/w${Number(width)}`;
};

/**
 * The rung to serve for a requested display width: the smallest rung that still
 * covers it, or the largest rung when the request exceeds the ladder.
 *
 * Rounding UP matters — rounding down would hand a 700px slot a 640px image and
 * the browser would upscale it, which is precisely the softness the quality
 * work on the Cloudinary loader existed to remove.
 */
export const pickWidth = (requested) => {
  const w = Number(requested);
  if (!Number.isFinite(w) || w <= 0) return LADDER[0];
  return LADDER.find((rung) => rung >= w) ?? LADDER[LADDER.length - 1];
};

/**
 * The prefix every variant of one original shares.
 *
 * ⚠ Variant keys are built from the original with its EXTENSION STRIPPED
 * (`…/photo.jpg` → `variants/…/photo/w640.avif`), so listing with the raw
 * original key as a prefix matches nothing. That mistake is silent: the caller
 * concludes no variants exist and re-encodes the entire ladder on every run.
 * Use this rather than concatenating VARIANT_PREFIX by hand.
 *
 * @returns {string} '' when the key yields no usable base
 */
export const variantPrefixFor = (originalKey) => {
  const base = publicIdFromR2Key(String(originalKey || ''), 'image');
  return base ? `${VARIANT_PREFIX}/${base}/` : '';
};

/**
 * Every (width, format) pair to generate for one source image.
 *
 * Includes the FULL rung whenever the source is narrower than the top of the
 * ladder — that is the object the Worker falls back to when a browser asks for a
 * rung this source cannot fill. A source at or above the top rung needs no full
 * variant: requests are capped at 1920 by pickWidth, so the exact rung always
 * exists and the fallback is never reached.
 */
export const plannedVariants = (originalKey, sourceWidth) => {
  const rungs = widthsFor(sourceWidth).flatMap((width) =>
    FORMATS.map((format) => ({ width, format, key: variantKey(originalKey, width, format) })));

  const w = Number(sourceWidth);
  const needsFull = Number.isFinite(w) && w > 0 && w < LADDER[LADDER.length - 1];
  const full = needsFull
    ? FORMATS.map((format) => ({
      width: w, format, full: true, key: fullVariantKey(originalKey, format),
    }))
    : [];

  return [...rungs, ...full].filter((v) => v.key);
};

export default {
  LADDER, FORMATS, VARIANT_PREFIX,
  widthsFor, variantKey, negotiableKey, pickWidth, plannedVariants, variantPrefixFor,
  FULL_RUNG, fullVariantKey,
};
