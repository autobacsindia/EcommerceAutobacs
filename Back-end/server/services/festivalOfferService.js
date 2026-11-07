/**
 * Festival (Diwali) price offer — the one place that decides whether the offer is on.
 *
 * Two reads, on purpose:
 *
 *   - getLiveOffer(now) — the PRICING read. Uncached: one indexed findOne on a
 *     singleton per quote. Turning the offer off must stop it being CHARGED on the very
 *     next quote, not after a cache TTL or a fire-and-forget purge settles.
 *
 *   - resolvePublicFestivalOffer() — the DISPLAY read for the storefront. Cached
 *     (Redis 60s, purged on write) and carries the window + tiers so the storefront
 *     switches itself off at `endsAt` on the visitor's clock. Display only; what a
 *     customer is charged always comes from the pricing read.
 */

import festivalOfferRepository from '../repositories/festivalOfferRepository.js';
import cacheService, { CACHE_VERSION } from './cacheService.js';
import { FESTIVAL_OFFER_CODE, FESTIVAL_OFFER_TIERS } from '../utils/festivalOffer.js';

export const FESTIVAL_OFFER_CACHE_TAG = 'public:festival-offer';
const CACHE_KEY = `${CACHE_VERSION}:${FESTIVAL_OFFER_CACHE_TAG}`;
const CACHE_TTL_SECONDS = 60;

const toIso = (d) => (d ? new Date(d).toISOString() : null);

/** Pure: is this config live at `now`? Start inclusive, end exclusive (same as the theme). */
export function isFestivalOfferLive(cfg, now = new Date()) {
  if (!cfg || !cfg.enabled) return false;
  const t = now.getTime();
  if (cfg.startsAt && new Date(cfg.startsAt).getTime() > t) return false;
  if (cfg.endsAt && new Date(cfg.endsAt).getTime() <= t) return false;
  return true;
}

/**
 * Pure: what the storefront receives, or null. A not-yet-started offer is returned with
 * `live: false` so a cached page can switch on at the start; off or ended is null.
 */
export function toPublicOffer(cfg, now = new Date()) {
  if (!cfg || !cfg.enabled) return null;
  if (cfg.endsAt && new Date(cfg.endsAt).getTime() <= now.getTime()) return null;
  return {
    code: FESTIVAL_OFFER_CODE,
    startsAt: toIso(cfg.startsAt),
    endsAt: toIso(cfg.endsAt),
    live: isFestivalOfferLive(cfg, now),
    tiers: FESTIVAL_OFFER_TIERS.map((t) => ({ minPaise: t.minPaise, percent: t.percent })),
  };
}

/**
 * PRICING read: true when the offer must be applied to a cart priced at `now`.
 * Uncached by design (see header). Throws on a DB error rather than guessing — a quote
 * that cannot tell whether the offer is on must not be priced either way.
 */
export async function isOfferLiveForPricing(now = new Date(), session = null) {
  return isFestivalOfferLive(await festivalOfferRepository.find(session), now);
}

/** DISPLAY read (cached). Stores `{ offer }` because wrap() treats a falsy hit as a miss. */
export async function resolvePublicFestivalOffer() {
  const { offer } = await cacheService.wrap(
    CACHE_KEY,
    async () => ({ offer: toPublicOffer(await festivalOfferRepository.find(), new Date()) }),
    { ttl: CACHE_TTL_SECONDS, tags: [FESTIVAL_OFFER_CACHE_TAG] },
  );
  return offer;
}

/** Uncached admin read; a never-saved offer reads as off. */
export async function getFestivalOfferConfig() {
  return (await festivalOfferRepository.find()) || { enabled: false, startsAt: null, endsAt: null };
}

export async function updateFestivalOfferConfig(set) {
  return festivalOfferRepository.update(set);
}

export default {
  isFestivalOfferLive,
  toPublicOffer,
  isOfferLiveForPricing,
  resolvePublicFestivalOffer,
  getFestivalOfferConfig,
  updateFestivalOfferConfig,
  FESTIVAL_OFFER_CACHE_TAG,
};
