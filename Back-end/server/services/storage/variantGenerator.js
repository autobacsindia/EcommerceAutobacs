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
 * ── Existence checks: a Set beats a HEAD per variant ────────────────────────
 * `existingKeys` short-circuits the "is this variant already there?" probe.
 * Measured against the real bucket, an R2 round-trip from here is ~316ms and a
 * 1080px source plans 10 variants, so the naive per-variant HEAD cost 10 x 316ms
 * = 3.2s PER IMAGE — and on a first run every one of those returns 404, i.e.
 * half the total runtime spent proving nothing exists. Over 6,243 originals that
 * is ~62,000 pointless requests and hours of wall time.
 *
 * The caller lists the `variants/` prefix ONCE (one paginated LIST) and passes
 * the keys as a Set; membership is then O(1) with no network. `headObject` is
 * kept as the fallback for callers that have no Set — a single upload job
 * checking one image should not list the whole bucket to do it.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer        original image bytes
 * @param {string} opts.originalKey   R2 key of the original
 * @param {Function} opts.putObject   ({body,key,scope,contentType,cacheControl}) => Promise
 * @param {Set<string>} [opts.existingKeys] keys already in the bucket (preferred)
 * @param {Function} [opts.headObject] per-variant fallback when no Set is given
 * @param {boolean} [opts.force]      re-encode even if present
 * @returns {Promise<{written:number, skipped:number, failed:Array, bytes:number, variants:Array}>}
 */
export const generateVariants = async ({
  buffer, originalKey, putObject, headObject, existingKeys, force = false,
  cacheControl = 'public, max-age=31536000, immutable',
}) => {
  const { width: sourceWidth } = await probe(buffer);
  const plan = plannedVariants(originalKey, sourceWidth);

  let skipped = 0;
  const todo = [];
  for (const v of plan) {
    if (!force) {
      if (existingKeys) {
        if (existingKeys.has(v.key)) { skipped += 1; continue; }
      } else if (headObject) {
        // eslint-disable-next-line no-await-in-loop
        const existing = await headObject({ key: v.key, scope: 'public' });
        if (existing) { skipped += 1; continue; }
      }
    }
    todo.push(v);
  }

  /*
    Encode + upload the remaining variants concurrently rather than one at a
    time. The work is dominated by network latency, not CPU (measured: 75% idle
    while the sequential version ran), so serialising 10 PUTs at ~316ms each
    wasted ~3s per image doing nothing. sharp does its own thread pooling, so
    the encodes queue rather than oversubscribe the cores.
  */
  const results = await Promise.allSettled(todo.map(async (v) => {
    const out = await renderVariant(buffer, v.width, v.format);
    await putObject({
      body: out,
      key: v.key,
      scope: 'public',
      contentType: v.format === 'avif' ? 'image/avif' : 'image/webp',
      cacheControl,
    });
    return { key: v.key, width: v.width, format: v.format, bytes: out.length };
  }));

  let written = 0; let bytes = 0;
  const failed = []; const variants = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      written += 1; bytes += r.value.bytes; variants.push(r.value);
    } else {
      failed.push({ key: todo[i].key, error: r.reason?.message || String(r.reason) });
    }
  });

  return { written, skipped, failed, bytes, variants, sourceWidth };
};

export default { ENCODE, probe, renderVariant, generateVariants };
