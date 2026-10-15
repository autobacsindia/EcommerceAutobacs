/**
 * Production startup gate: prove Redis answers before the server takes traffic.
 *
 * WHY IT IS SHAPED LIKE THIS
 * The original gate gave a brand-new client 2 seconds for EVERYTHING — DNS, TCP,
 * the TLS handshake to Upstash and the PING — because ioredis starts a queued
 * command's `commandTimeout` before the connection exists. From Railway that
 * budget became too tight at cold start: every deploy from 2026-10-14 to
 * 2026-10-15 (twelve of them) had one replica exit with "Command timed out"
 * while the running server, on long-lived connections, used the same Redis
 * without a single error. The gate was failing healthy Redis.
 *
 * So the phases are separated and bounded on their own:
 *   - connect (incl. TLS) gets `connectTimeout`;
 *   - only then is PING sent, with `commandTimeout`;
 *   - a failed attempt is retried after a short backoff, `attempts` times.
 * Each attempt logs how long it took, so a slow path is visible in the deploy
 * log instead of only ever showing up as a timeout.
 *
 * It still refuses to start when Redis is genuinely unreachable: the caller
 * exits on `ok: false`. Worst case with the defaults is ~50 s, inside Railway's
 * 120 s healthcheck window.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bound a promise; reject with `message` after `ms`. */
function within(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {Function} opts.RedisCtor   ioredis constructor (injected for tests)
 * @returns {Promise<{ ok: boolean, attempts: number, ms?: number, error?: string }>}
 */
export async function verifyRedisAtStartup(url, {
  RedisCtor,
  attempts = 3,
  connectTimeout = 10_000,
  commandTimeout = 5_000,
  backoffMs = 1_000,
  log = console,
} = {}) {
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    const client = new RedisCtor(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null, // one connection per attempt; this loop does the retrying
      connectTimeout,
      tls: url.startsWith('rediss://') ? {} : undefined,
    });
    client.on('error', () => {}); // surfaced through the awaited calls below
    try {
      await within(client.connect(), connectTimeout + 1_000, `connect timed out after ${connectTimeout} ms`);
      const connectedMs = Date.now() - started;
      await within(client.ping(), commandTimeout, `PING timed out after ${commandTimeout} ms`);
      const ms = Date.now() - started;
      log.log(`✓ Redis connection verified (attempt ${attempt}: connect ${connectedMs} ms, total ${ms} ms)`);
      client.quit().catch(() => client.disconnect());
      return { ok: true, attempts: attempt, ms };
    } catch (err) {
      lastError = err.message;
      log.warn(`⚠ Redis check attempt ${attempt}/${attempts} failed after ${Date.now() - started} ms: ${err.message}`);
      client.disconnect();
      if (attempt < attempts) await sleep(backoffMs * attempt);
    }
  }
  return { ok: false, attempts, error: lastError };
}
