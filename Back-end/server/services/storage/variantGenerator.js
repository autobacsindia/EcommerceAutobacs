/**
 * Render an original image into its pre-generated variant set (sharp).
 *
 * Runs off the request path — a BullMQ job on upload, and the backfill script
 * for the existing catalog — so an admin saving a product never waits on image
 * encoding. AVIF in particular is CPU-expensive to encode and cheap to decode,
 * which is exactly the trade you want when it is encoded once and served
 * millions of times.
 *
 * ── Quality settings ────────────────────────────────────────────────────────
 * These replace Cloudinary's `q_auto:best` + `e_sharpen:60`, which existed for
 * a specific reported bug: product shots read soft on DPR-1 Windows monitors,
 * where a rendition is viewed 1:1 with no supersampling to hide compression.
 * The equivalent here is a high quality floor plus a light unsharp pass after
 * the resize — sharpening before would amplify artefacts the downscale then
 * bakes in.
 *
 * AVIF at q60 is visually comparable to WebP at q80 while being materially
 * smaller, so the two are tuned to land at similar perceived quality rather
 * than at the same number.
 */
import sharp from 'sharp';
import { plannedVariants, FORMATS } from './variants.js';

/** Encoder settings per output format. */
export const ENCODE = {
  // effort 4 balances encode time against size; 9 is far slower for a few percent.
  avif: { quality: 60, effort: 4, chromaSubsampling: '4:4:4' },
  webp: { quality: 80, effort: 4 },
};

/**
 * Light output sharpening, applied AFTER the resize.
 *
 * Downscaling softens edges, and a browser resampling to a fractional DPR
 * (Windows at 125%/150% scaling never lands on an integer pixel grid) softens
 * them again. A mild unsharp restores perceived acuity without the halos an
 * aggressive value produces on good displays.
 */
const SHARPEN = { sigma: 0.6 };

/** Probe an image's intrinsic dimensions without decoding the whole thing. */
export const probe = async (buffer) => {
  const { width, height, format } = await sharp(buffer).metadata();
  return { width: width || 0, height: height || 0, format: format || '' };
};

/**
 * Encode one variant.
 *
 * `withoutEnlargement` is the belt to widthsFor()'s braces: even if a caller
 * asks for a rung wider than the source, sharp returns the source size rather
 * than an upscaled blur.
 */
export const renderVariant = async (buffer, width, format) => {
  if (!FORMATS.includes(format)) throw new Error(`[Variants] unsupported format "${format}"`);
  const pipeline = sharp(buffer)
    .rotate()                                   // honour EXIF orientation before resizing
    .resize({ width, withoutEnlargement: true, fit: 'inside' })
    .sharpen(SHARPEN);
  return format === 'avif'
    ? pipeline.avif(ENCODE.avif).toBuffer()
    : pipeline.webp(ENCODE.webp).toBuffer();
};

/**
 * Generate and store every variant for one original.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer        original image bytes
 * @param {string} opts.originalKey   R2 key of the original
 * @param {Function} opts.putObject   ({body,key,scope,contentType,cacheControl}) => Promise
 * @param {Function} [opts.headObject] used to skip variants that already exist
 * @param {boolean} [opts.force]      re-encode even if present
 * @returns {Promise<{written:number, skipped:number, failed:Array, bytes:number, variants:Array}>}
 */
export const generateVariants = async ({
  buffer, originalKey, putObject, headObject, force = false,
  cacheControl = 'public, max-age=31536000, immutable',
}) => {
  const { width: sourceWidth } = await probe(buffer);
  const plan = plannedVariants(originalKey, sourceWidth);

  let written = 0; let skipped = 0; let bytes = 0;
  const failed = []; const variants = [];

  for (const v of plan) {
    try {
      // Resumability: a backfill over thousands of images will be interrupted,
      // and re-encoding what already landed is pure CPU waste.
      if (!force && headObject) {
        const existing = await headObject({ key: v.key, scope: 'public' });
        if (existing) { skipped += 1; continue; }
      }
      const out = await renderVariant(buffer, v.width, v.format);
      await putObject({
        body: out,
        key: v.key,
        scope: 'public',
        contentType: v.format === 'avif' ? 'image/avif' : 'image/webp',
        cacheControl,
      });
      written += 1; bytes += out.length;
      variants.push({ key: v.key, width: v.width, format: v.format, bytes: out.length });
    } catch (err) {
      failed.push({ key: v.key, error: err.message });
    }
  }

  return { written, skipped, failed, bytes, variants, sourceWidth };
};

export default { ENCODE, probe, renderVariant, generateVariants };
