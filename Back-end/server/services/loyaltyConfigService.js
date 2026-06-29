/**
 * Loyalty config accessor with a tiny in-process TTL cache.
 *
 * The config is a single document read on every quote/checkout, so we memoise it
 * for a short window instead of hitting Mongo each time. Admin writes call
 * invalidateLoyaltyConfig() to refresh immediately on the writing instance; other
 * instances converge within TTL_MS (config changes are rare and non-urgent, so a
 * few seconds of staleness is acceptable and avoids a Redis round-trip here).
 */

import loyaltyConfigRepository from '../repositories/loyaltyConfigRepository.js';

const TTL_MS = 60_000;

let cached = null;
let cachedAt = 0;

export async function getLoyaltyConfig() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;

  const doc = await loyaltyConfigRepository.getSingleton();
  // Plain snapshot — callers only read scalar settings, never mutate the doc.
  cached = {
    enabled: doc.enabled,
    earnRatePercent: doc.earnRatePercent,
    pointsExpiryDays: doc.pointsExpiryDays,
    pointValueInRupees: doc.pointValueInRupees,
    redeemMaxPercent: doc.redeemMaxPercent,
    minRedeemPoints: doc.minRedeemPoints
  };
  cachedAt = now;
  return cached;
}

export function invalidateLoyaltyConfig() {
  cached = null;
  cachedAt = 0;
}
