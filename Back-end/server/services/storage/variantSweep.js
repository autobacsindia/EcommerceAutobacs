/**
 * Nightly safety net for image variants.
 *
 * Variants are normally rendered by a media job raised when an upload is signed
 * (queue/workers/mediaWorker.js). That job can give up — an upload that took
 * longer than its retries, a worker restart, a Redis blip — and nothing ever
 * looked again. The image Worker then serves the ORIGINAL for that photo on every
 * visit: measured on the live catalogue, 1 in 6 product photos on the listing
 * pages were 1–2 MB originals instead of ~50 KB AVIF/WebP, which is what made
 * product grids slow on mobile.
 *
 * This finds originals with no variants at all and hands them back to the SAME
 * media job (no second encoder), a bounded number per night, so the CPU cost is
 * spread out and the API that shares the box is never starved.
 *
 * Partially rendered ladders are left alone on purpose: the media job already
 * retries those, and the image Worker's full-rung fallback covers a missing rung.
 */

import { listKeys as r2ListKeys } from './r2Provider.js';
import { VARIANT_PREFIX, variantPrefixFor } from './variants.js';
import { scopeFor } from './assetScope.js';

// Same source extensions the backfill script renders.
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

/**
 * @param {object} [opts]
 * @param {string} [opts.prefix='autobacs/']   only originals under this key prefix
 * @param {number} [opts.limit=300]            at most this many returned
 * @param {Function} [opts.listKeys]           injectable for tests
 * @returns {Promise<{scanned:number, missingTotal:number, missing:string[]}>}
 */
export async function findOriginalsMissingVariants({ prefix = 'autobacs/', limit = 300, listKeys = r2ListKeys } = {}) {
  const sources = await listKeys({ prefix, scope: 'public' });
  const originals = sources
    .map((o) => o.key)
    .filter((k) => IMAGE_EXT.test(k) && !k.startsWith(`${VARIANT_PREFIX}/`) && scopeFor(k) === 'public');

  // One listing of the variant tree; reduce it to the set of "has some variants" folders.
  const variants = await listKeys({ prefix: `${VARIANT_PREFIX}/${prefix}`, scope: 'public' });
  const folders = new Set(variants.map((o) => o.key.slice(0, o.key.lastIndexOf('/') + 1)));

  const missing = originals.filter((k) => {
    const folder = variantPrefixFor(k);
    return folder && !folders.has(folder);
  });
  return { scanned: originals.length, missingTotal: missing.length, missing: missing.slice(0, limit) };
}
