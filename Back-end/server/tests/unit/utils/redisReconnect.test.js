/**
 * Redis clients must keep reconnecting for as long as Redis is away.
 *
 * Incident 2026-11-05: both app clients used `retryStrategy: times > 3 ? null : …`.
 * Returning null tells ioredis to stop for good, so a Redis restart longer than
 * ~600 ms left the API with a permanently closed connection until the process was
 * restarted — sessions, cache and guest checkout all broken in the meantime.
 */
import { jest } from '@jest/globals';

const constructed = [];
class FakeRedis {
  constructor(url, options) { this.url = url; this.options = options; constructed.push(this); }
  on() { return this; }
}
jest.unstable_mockModule('ioredis', () => ({ default: FakeRedis }));

const { redisRetryStrategy, REDIS_RETRY_MAX_DELAY_MS } = await import('../../../utils/redisTransport.js');

describe('redisRetryStrategy', () => {
  it('never gives up, however many attempts have failed', () => {
    for (const times of [1, 4, 10, 100, 10_000]) {
      const delay = redisRetryStrategy(times);
      expect(typeof delay).toBe('number');
      expect(delay).toBeGreaterThan(0);
    }
  });

  it('backs off but stays capped so recovery is noticed quickly', () => {
    expect(redisRetryStrategy(1)).toBeLessThan(redisRetryStrategy(5));
    expect(redisRetryStrategy(10_000)).toBe(REDIS_RETRY_MAX_DELAY_MS);
    expect(REDIS_RETRY_MAX_DELAY_MS).toBeLessThanOrEqual(5000);
  });
});

describe('app Redis clients use the never-give-up strategy', () => {
  const saved = { ...process.env };
  afterAll(() => { process.env = saved; });

  it('cache/session client (REDIS_URL) and rate-limit client', async () => {
    process.env.REDIS_URL = 'redis://cache.example:6379';
    process.env.QUEUE_REDIS_URL = 'redis://queue.example:6379';
    await import('../../../services/redisClient.js');
    await import('../../../middleware/rate-limit/redisClient.js');

    const cacheClient = constructed.find((c) => c.url === process.env.REDIS_URL);
    const rlClient = constructed.find((c) => c.url === process.env.QUEUE_REDIS_URL);
    for (const c of [cacheClient, rlClient]) {
      expect(c).toBeDefined();
      expect(c.options.retryStrategy(50)).toEqual(expect.any(Number));
      expect(c.options.retryStrategy(50)).toBeGreaterThan(0);
    }
  });
});
