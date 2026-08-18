/**
 * Promo banner resolution — the single authority on which banner is live.
 *
 * Every reader (public endpoint, admin preview) goes through resolveActiveBanner().
 * The scheduling rule exists once, so "active" cannot mean one thing to the
 * storefront and another to the admin preview.
 */

import promoBannerRepository from '../repositories/promoBannerRepository.js';
import cacheService, { CACHE_VERSION } from './cacheService.js';

/** Invalidation handle. Write paths pass this to invalidateCache(). */
export const PROMO_BANNER_CACHE_TAG = 'public:promo-banner';

const CACHE_KEY = `${CACHE_VERSION}:${PROMO_BANNER_CACHE_TAG}`;

/**
 * Short. The banner is scheduled by wall-clock time, so a campaign due to start
 * at midnight goes live within this window without anyone touching admin — and
 * an explicit admin edit purges the key outright rather than waiting.
 */
const CACHE_TTL_SECONDS = 60;

/** Only these reach the storefront. Timestamps and admin bookkeeping stay put. */
const publicShape = (doc) => ({
  id: String(doc._id),
  imageUrl: doc.imageUrl,
  // Drive the storefront's reserved-space box. Sent even though they are only
  // layout hints: without them the strip has no height until the image loads.
  imageWidth: doc.imageWidth || null,
  imageHeight: doc.imageHeight || null,
  alt: doc.alt,
  linkPath: doc.linkPath || '/offers',
});

/**
 * The banner to render right now, or null when nothing is scheduled.
 *
 * Returns a plain public-shaped object, never the Mongoose document — the
 * storefront response is a shared (non-personalised) cache entry and must not
 * grow fields by accident.
 *
 * The cache stores `{ banner: null }` rather than a bare null on purpose:
 * CacheService.wrap() treats any falsy hit as a miss, so caching null would make
 * "no campaign running" — the normal state for most of the year — re-query Mongo
 * on every page view of every visitor. The wrapper object is always truthy, so
 * the quiet case is the cheap one.
 */
export async function resolveActiveBanner() {
  const { banner } = await cacheService.wrap(
    CACHE_KEY,
    async () => {
      const doc = await promoBannerRepository.findActiveAt(new Date());
      return { banner: doc ? publicShape(doc) : null };
    },
    { ttl: CACHE_TTL_SECONDS, tags: [PROMO_BANNER_CACHE_TAG] },
  );
  return banner;
}

export default { resolveActiveBanner, PROMO_BANNER_CACHE_TAG };
