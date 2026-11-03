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
