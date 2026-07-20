/**
 * Cache flush core + admin monitoring surfaces.
 *
 * - flushPattern/flushResponseCaches: the shared SCAN+UNLINK sweep behind both
 *   scripts/flush-public-cache.js and CacheService.clear() (admin
 *   POST /admin/redis/cache/clear, which returned 501 before clear() existed).
 * - CacheService.getStats(): alias for getMetrics() — routes/redisMonitor.js
 *   called a getStats() that never existed, so the admin dashboard's cache
 *   section rendered empty.
 * - sessionStore.getStats(): must count sessions with non-blocking SCAN, never
 *   KEYS (which blocks the shared prod cache/session instance).
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

const { default: cacheService } = await import('../../../services/cacheService.js');
const { RESPONSE_CACHE_PATTERNS, flushPattern, flushResponseCaches } =
  await import('../../../services/cache/flush.js');
const { default: sessionStore } = await import('../../../services/sessionStore.js');

/** Minimal ioredis stand-in: scanStream emits the keys matching a glob, unlink counts. */
const makeFakeRedis = (keys) => {
  const remaining = new Set(keys);
  return {
    remaining,
    scanStream({ match }) {
      const regex = new RegExp(`^${match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      const stream = new EventEmitter();
      process.nextTick(() => {
        const hits = [...remaining].filter((k) => regex.test(k));
        if (hits.length) stream.emit('data', hits);
        stream.emit('end');
      });
      stream.pause = () => {};
      stream.resume = () => {};
      return stream;
    },
    unlink: jest.fn(async (batch) => {
      let n = 0;
      for (const k of batch) if (remaining.delete(k)) n++;
      return n;
    }),
  };
};

describe('flushResponseCaches', () => {
  it('covers every cache namespace but never sessions or rate limits', async () => {
    const redis = makeFakeRedis([
      'route:categories:abc',
      'public:products:def',
      'v2:products:list:{"page":"1"}',
      'v2:default:products:featured',
      'delivery-zones:list:all:all',
      'session:user123',
      'rl:login:1.2.3.4',
      'razorpay:event:evt_1',
    ]);

    const { total } = await flushResponseCaches(redis);

    expect(total).toBe(5);
    expect(redis.remaining).toEqual(new Set([
      'session:user123',
      'rl:login:1.2.3.4',
      'razorpay:event:evt_1',
    ]));
  });

  it('includes the controller-level and delivery-zone namespaces in its patterns', () => {
    expect(RESPONSE_CACHE_PATTERNS).toEqual(
      expect.arrayContaining(['route:*', 'public:*', 'v2:*', 'delivery-zones:*'])
    );
  });

  it('flushPattern reports scanned and deleted counts', async () => {
    const redis = makeFakeRedis(['public:products:a', 'public:products:b']);
    const { scanned, deleted } = await flushPattern(redis, 'public:*');
    expect(scanned).toBe(2);
    expect(deleted).toBe(2);
  });
});

describe('CacheService.clear (in-memory path)', () => {
  it('empties the cache and reports the count', async () => {
    cacheService.cache.clear();
    await cacheService.set('public:products:x', { a: 1 }, 60);
    await cacheService.set('route:categories:y', { b: 2 }, 60);

    const result = await cacheService.clear();

    expect(result.total).toBe(2);
    expect(cacheService.cache.size).toBe(0);
  });
});

describe('CacheService.getStats', () => {
  it('exists and mirrors getMetrics for the admin monitor', () => {
    const stats = cacheService.getStats();
    expect(stats).toHaveProperty('hitRate');
    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('version');
  });
});

describe('sessionStore.getStats', () => {
  const originalRedis = sessionStore.redis;

  afterEach(() => {
    sessionStore.redis = originalRedis;
  });

  it('counts session keys via SCAN and never calls KEYS', async () => {
    const scan = jest.fn()
      .mockResolvedValueOnce(['42', ['session:a', 'session:b']])
      .mockResolvedValueOnce(['0', ['session:c']]);
    const keys = jest.fn();
    sessionStore.redis = {
      info: async () => 'uptime_in_seconds:10\r\nused_memory_human:1.0M\r\nconnected_clients:2\r\n',
      scan,
      keys,
    };

    const stats = await sessionStore.getStats();

    expect(stats.connected).toBe(true);
    expect(stats.sessionKeys).toBe(3);
    expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'session:*', 'COUNT', 500);
    expect(keys).not.toHaveBeenCalled();
  });

  it('flags truncation instead of scanning forever on a huge keyspace', async () => {
    // Cursor never returns to '0' → the iteration cap must kick in.
    const scan = jest.fn().mockResolvedValue(['1', ['session:x']]);
    sessionStore.redis = { info: async () => '', scan, keys: jest.fn() };

    const stats = await sessionStore.getStats();

    expect(scan.mock.calls.length).toBeLessThanOrEqual(100);
    expect(stats.sessionKeysTruncated).toBe(true);
  });
});
