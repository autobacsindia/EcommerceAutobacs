// Bump on cache-key-shape or recommendation-logic changes to invalidate stale
// entries (a free global flush — old-prefix keys simply age out). v3: unified
// response cache (middleware/httpCache.js) — keys are now v3:resp:<ns>:<md5>.
export const CACHE_VERSION = process.env.CACHE_VERSION || 'v3';

export const CACHE_CONFIG = {
  TTL_JITTER_PERCENT: 0.1,
  LOCK_HEARTBEAT_INTERVAL: 2000,
  LOCK_HEARTBEAT_EXTEND: 5000,
  WARMUP_ENABLED: process.env.CACHE_WARMUP_ENABLED === 'true',
  WARMUP_KEYS: [],
  CLEANUP_LEADER_KEY: 'cache:cleanup:leader',
  CLEANUP_LEADER_TTL: 900,
};

export const TTL = {
  PRODUCT_DETAIL: 3600,
  PRODUCT_LIST: 300,
  PRODUCT_SEARCH: 60,
  PRODUCT_FEATURED: 3600,
  PRODUCT_OFFERS: 1800,
  CATEGORIES: 7200,
  BRANDS: 7200,
  USER_PROFILE: 300,
  USER_CART: 60,
  INVENTORY: 60,
  SEARCH_SUGGESTIONS: 300,
  // Spin-to-Win's live campaign. Short on purpose: admin writes purge this key
  // explicitly, so the TTL is only the backstop for the two cases a purge cannot
  // cover — a campaign whose startsAt arrives with no admin write behind it, and a
  // purge that failed and was swallowed. 60s bounds both without materially
  // weakening the cache (a 90s poll window costs at most 2 DB reads instead of 30).
  SPIN_CAMPAIGN: 60,
};
