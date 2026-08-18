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

/**
 * Why a given banner is or isn't on screen. Admin-facing only.
 *
 * Exists because "active but not showing" is a genuinely confusing thing to be
 * told: the operator ticked Active, so the honest question is *what is stopping
 * it*, and there are four different answers. Naming the reason turns a puzzle
 * into an instruction.
 */
export const BANNER_STATE = {
  LIVE: 'live',               // on screen right now
  OFF: 'off',                 // Active unticked
  SCHEDULED: 'scheduled',     // active, but its start date hasn't arrived
  ENDED: 'ended',             // active, but its end date has passed
  SUPERSEDED: 'superseded',   // active and in-window, but another banner outranks it
};

/**
 * Classify every banner for the admin list.
 *
 * `liveId` is resolved by the SAME repository query the storefront uses, not
 * re-derived here — so the admin can never disagree with what shoppers see about
 * which banner won. This function only explains the losers.
 *
 * @param {Array} banners  admin rows (lean docs)
 * @param {string|null} liveId  id of the winning banner, or null
 * @param {Date} now
 */
export function describeBannerStates(banners = [], liveId = null, now = new Date()) {
  return banners.map((b) => {
    const id = String(b._id);
    if (id === liveId) return { ...b, state: BANNER_STATE.LIVE };
    if (!b.isActive) return { ...b, state: BANNER_STATE.OFF };
    if (b.startsAt && new Date(b.startsAt) > now) return { ...b, state: BANNER_STATE.SCHEDULED };
    if (b.endsAt && new Date(b.endsAt) <= now) return { ...b, state: BANNER_STATE.ENDED };
    // Active, inside its window, and still not chosen — something else outranked it.
    return { ...b, state: BANNER_STATE.SUPERSEDED };
  });
}

export default {
  resolveActiveBanner,
  describeBannerStates,
  BANNER_STATE,
  PROMO_BANNER_CACHE_TAG,
};
