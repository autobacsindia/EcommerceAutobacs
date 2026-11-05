/**
 * Transport options shared by every ioredis client in the app.
 *
 * - `tls` only for `rediss://`. Upstash needs TLS; Railway's private network
 *   (`*.railway.internal`) serves plain `redis://` and refuses a TLS handshake.
 * - `family: 0` lets DNS return IPv4 or IPv6. ioredis defaults to IPv4 only, and
 *   Railway's private hostnames can resolve to IPv6 only — the documented
 *   `ENOTFOUND redis.railway.internal` failure. Harmless for public hosts.
 *
 * @param {string} url  a redis:// or rediss:// connection URL
 * @returns {{ family: 0, tls: object|undefined }}
 */
export function redisTransportOptions(url) {
  return {
    family: 0,
    tls: String(url).startsWith('rediss://') ? {} : undefined,
  };
}

/** Longest wait between reconnect attempts. Short enough that a Redis that
 *  comes back is picked up within seconds. */
export const REDIS_RETRY_MAX_DELAY_MS = 2000;

/**
 * ioredis `retryStrategy` shared by the app's long-lived clients: back off, but
 * NEVER give up.
 *
 * Returning null (the old `times > 3 ? null : …`) tells ioredis to stop for good.
 * On 2026-11-05 a ~40 s Redis-Cache region move left both API replicas with a
 * permanently closed connection — sessions, cache and guest checkout failing
 * until the processes were restarted by hand. Commands still fail fast while
 * Redis is away (maxRetriesPerRequest / commandTimeout on each client); only the
 * background reconnect keeps going.
 *
 * @param {number} times  1-based count of consecutive failed attempts
 * @returns {number} delay in ms before the next attempt
 */
export function redisRetryStrategy(times) {
  const n = Math.max(1, Number(times) || 1);
  return Math.min(n * 100, REDIS_RETRY_MAX_DELAY_MS);
}
