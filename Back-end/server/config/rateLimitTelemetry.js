/**
 * Rate-limit telemetry persistence policy.
 *
 * Every allowed request used to write one `rate_limit_events` document. At ~2.3
 * inserts/s that made this collection 95% of the database (3.0M docs / 518 MB of
 * the 544 MB total) and ~100% of all insert volume, which pushed Atlas compute
 * auto-scaling from M10 to M20. Nothing reads the `hit` rows: the live counters
 * are in Redis, the realtime dashboard reads the in-memory ring buffer, and
 * rateLimitDashboardController only ever aggregates `block` / `retry_*`.
 *
 * So `hit` persistence is now opt-in. `block` and every other event type is
 * ALWAYS persisted regardless of mode — those are the security signal and
 * dropping one is never a cost decision.
 */

export const PERSIST_MODES = Object.freeze(['blocks-only', 'sampled', 'all']);
export const DEFAULT_PERSIST_MODE = 'blocks-only';
export const DEFAULT_HIT_SAMPLE_RATE = 0.01;

/** Longest endpoint path we store. Keeps a hostile URL from bloating the index. */
const MAX_ENDPOINT_LENGTH = 200;

/**
 * Resolve the configured mode. An unrecognised value falls back to the default
 * here; `validateEnvironment()` is what makes a typo a loud boot failure, so this
 * path is only reached in tests and non-validated contexts.
 * @returns {'blocks-only'|'sampled'|'all'}
 */
export function getPersistMode() {
  const raw = (process.env.RATE_LIMIT_EVENT_PERSIST || '').trim();
  return PERSIST_MODES.includes(raw) ? raw : DEFAULT_PERSIST_MODE;
}

/**
 * Fraction of `hit` events persisted in `sampled` mode. Clamped to [0, 1];
 * a missing/invalid value falls back to the default rather than 0, so
 * `sampled` never silently degrades into `blocks-only`.
 * @returns {number}
 */
export function getHitSampleRate() {
  const raw = Number.parseFloat(process.env.RATE_LIMIT_EVENT_HIT_SAMPLE_RATE);
  if (!Number.isFinite(raw)) return DEFAULT_HIT_SAMPLE_RATE;
  if (raw <= 0) return 0;
  return Math.min(raw, 1);
}

/**
 * Should this event be written to MongoDB?
 * @param {string} eventType
 * @param {{ mode?: string, rng?: () => number }} [opts] injectable for tests
 * @returns {boolean}
 */
export function shouldPersistEvent(eventType, opts = {}) {
  const mode = opts.mode ?? getPersistMode();
  if (mode === 'all') return true;

  // block / retry_success / retry_failure / threshold_change — always durable.
  if (eventType !== 'hit') return true;

  if (mode === 'sampled') {
    const rate = getHitSampleRate();
    if (rate <= 0) return false;
    const rng = opts.rng ?? Math.random;
    return rng() < rate;
  }

  return false; // blocks-only
}

/**
 * Strip the query string and bound the length.
 *
 * `req.originalUrl` carries full query strings, so `endpoint` was effectively a
 * unique value per request (`/api/v1/products?category=exterior&sortBy=...`).
 * That made `endpoint_1` 24 MB of near-unique keys and made the dashboard's
 * "top endpoints" aggregation group by something meaningless.
 * @param {string} url
 * @returns {string}
 */
export function normalizeEndpoint(url) {
  if (typeof url !== 'string' || url.length === 0) return '/';
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  if (path.length === 0) return '/';
  return path.length > MAX_ENDPOINT_LENGTH ? path.slice(0, MAX_ENDPOINT_LENGTH) : path;
}
