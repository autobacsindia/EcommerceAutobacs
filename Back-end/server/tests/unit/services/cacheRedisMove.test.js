/**
 * Guards for moving the cache/session Redis (REDIS_URL) off Upstash onto a
 * Railway Redis service.
 *
 *  1. The app connects with a plain `redis://` URL (Railway private network has
 *     no TLS) and with IPv6-capable DNS (`family: 0`), from every client.
 *  2. Every cache write carries a TTL. The Railway Redis runs `noeviction`, so a
 *     key without an expiry would stay until someone deletes it by hand.
 *  3. Cache keys can never land in BullMQ's (`bull:*`) or the rate limiter's
 *     (`rl:*`) namespace, so the two services could share one Redis safely.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';

// One recording fake for every ioredis client constructed under this test.
const constructed = [];
const commands = [];
class FakeRedis {
  constructor(url, opts) {
    constructed.push({ url, opts });
    const record = (name) => (...args) => {
      commands.push([name, ...args]);
      return name === 'pipeline' || name === 'multi' ? pipe : Promise.resolve(null);
    };
    const pipe = new Proxy({}, {
      get: (_, name) => (name === 'exec' ? () => Promise.resolve([]) : (...args) => { commands.push([name, ...args]); return pipe; }),
    });
    return new Proxy(this, {
      get: (target, name) => {
        if (name === 'on' || name === 'once') return () => target;
        if (name === 'then') return undefined;
        return record(name);
      },
    });
  }
}

jest.unstable_mockModule('ioredis', () => ({ default: FakeRedis, Redis: FakeRedis }));

const ORIGINAL = { REDIS_URL: process.env.REDIS_URL, QUEUE_REDIS_URL: process.env.QUEUE_REDIS_URL };
process.env.REDIS_URL = 'redis://default:pw@redis-cache.railway.internal:6379';
process.env.QUEUE_REDIS_URL = 'redis://default:pw@redis.railway.internal:6379';

const { redisTransportOptions } = await import('../../../utils/redisTransport.js');
const { verifyRedisAtStartup } = await import('../../../utils/redisStartupCheck.js');
const { getRedisClient } = await import('../../../services/redisClient.js');
await import('../../../middleware/rate-limit/redisClient.js');
const { createConnection } = await import('../../../queue/connection.js');
const { default: cacheService } = await import('../../../services/cacheService.js');
const { CACHE_VERSION } = await import('../../../services/cache/config.js');

afterAll(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('plain redis:// (Railway private network)', () => {
  it('builds no TLS for redis:// and TLS for rediss://, both dual-stack', () => {
    expect(redisTransportOptions('redis://h:6379')).toEqual({ family: 0, tls: undefined });
    expect(redisTransportOptions('rediss://h:6379')).toEqual({ family: 0, tls: {} });
  });

  it('the production startup gate passes a plain redis:// URL without TLS', async () => {
    const made = [];
    class Ok {
      constructor(url, opts) { made.push(opts); }
      on() { return this; }
      connect() { return Promise.resolve(); }
      ping() { return Promise.resolve('PONG'); }
      quit() { return Promise.resolve(); }
      disconnect() {}
    }
    const res = await verifyRedisAtStartup('redis://redis-cache.railway.internal:6379', {
      RedisCtor: Ok, log: { log: jest.fn(), warn: jest.fn() },
    });
    expect(res.ok).toBe(true);
    expect(made[0]).toMatchObject({ family: 0, tls: undefined });
  });

  it('cache, rate-limit and queue clients all connect without TLS and dual-stack', () => {
    createConnection();
    expect(getRedisClient()).toBeTruthy();
    const urls = constructed.map((c) => c.url);
    expect(urls).toEqual(expect.arrayContaining([process.env.REDIS_URL, process.env.QUEUE_REDIS_URL]));
    for (const { opts } of constructed) {
      expect(opts.family).toBe(0);
      expect(opts.tls).toBeUndefined();
    }
  });
});

describe('every cache write carries a TTL', () => {
  beforeEach(() => { commands.length = 0; });

  const setCalls = () => commands.filter(([name]) => name === 'set' || name === 'setex' || name === 'expire');

  it.each([
    ['default ttl', []],
    ['explicit ttl', [60]],
    ['tagged', [120, ['product:1']]],
  ])('CacheService.set (%s) writes with EX and a positive expiry', async (_label, extra) => {
    await cacheService.set('v3:default:test:key', { a: 1 }, ...extra);
    const sets = commands.filter(([name]) => name === 'set');
    expect(sets).toHaveLength(1);
    const [, key, , mode, ttl] = sets[0];
    expect(key).toBe('v3:default:test:key');
    expect(mode).toBe('EX');
    expect(ttl).toBeGreaterThan(0);
  });

  it('a tagged write also gives the tag index set an expiry', async () => {
    await cacheService.set('v3:default:test:tagged', 1, 120, ['brand:9']);
    const sadds = commands.filter(([name]) => name === 'sadd');
    const expires = commands.filter(([name, key]) => name === 'expire' && key === 'ctag:brand:9');
    expect(sadds).toHaveLength(1);
    expect(expires.length).toBeGreaterThan(0);
    expect(setCalls().length).toBeGreaterThan(0);
  });

  it('cacheService.wrap (the read-through path) stores with EX too', async () => {
    await cacheService.wrap('v3:default:test:rt', async () => ({ ok: true }), { ttl: 30 });
    const sets = commands.filter(([name, key]) => name === 'set' && key === 'v3:default:test:rt');
    expect(sets).toHaveLength(1);
    expect(sets[0][3]).toBe('EX');
    expect(sets[0][4]).toBeGreaterThan(0);
  });
});

describe('cache keys never collide with queue or rate-limit keys', () => {
  it('generated cache keys are versioned and outside bull:* / rl:*', () => {
    const keys = [
      cacheService.generateKey('products', { page: 1 }),
      cacheService.generateKey('bull', { x: 1 }),
      cacheService.generateKey('rl', {}),
    ];
    for (const key of keys) {
      expect(key.startsWith(`${CACHE_VERSION}:`)).toBe(true);
      expect(key).not.toMatch(/^(bull|rl):/);
    }
    expect(CACHE_VERSION).not.toMatch(/^(bull|rl)$/);
  });

  it('BullMQ queues keep the default bull: prefix (no custom prefix that could overlap)', () => {
    const src = readFileSync(new URL('../../../queue/queues.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bprefix\s*:/);
  });
});
