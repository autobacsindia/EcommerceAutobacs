/**
 * Cache must FAIL OPEN when Redis is unreachable.
 *
 * Incident 2026-11-05: Redis-Cache was moved between Railway regions. The ioredis
 * client gave up reconnecting, every command rejected with "Connection is closed.",
 * and `getWithLock` let the lock command's rejection escape — so GET /products
 * returned 500 for ~3 minutes. A cache is an optimisation: losing it may make a
 * page slower, never make it fail.
 *
 * Plain functions, not jest.fn: jest.config sets resetMocks, which would wipe a
 * jest.fn implementation before each test and turn "Redis rejects" into
 * "Redis returns undefined" — a different scenario.
 */
import { jest } from '@jest/globals';

const closed = () => Promise.reject(new Error('Connection is closed.'));
// Per-test overrides: { get, set, eval } → custom implementation.
let override = {};
const call = (name) => (...args) => (override[name] ? override[name](...args) : closed());
const deadRedis = {
  get: call('get'),
  set: call('set'),
  del: call('del'),
  eval: call('eval'),
  sadd: call('sadd'),
  expire: call('expire'),
  pipeline: () => ({ sadd() { return this; }, expire() { return this; }, exec: closed }),
  multi: () => ({ sadd() { return this; }, expire() { return this; }, exec: closed }),
};

jest.unstable_mockModule('../../../services/cache/redisClient.js', () => ({
  redisClient: deadRedis,
  getRedisClient: () => deadRedis,
}));

const { default: CacheService } = await import('../../../services/cache/CacheService.js');

describe('CacheService with Redis down', () => {
  let cache;
  let warn;
  beforeEach(() => {
    override = {};
    cache = new CacheService();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('getWithLock serves the computed value instead of throwing', async () => {
    let calls = 0;
    const fn = async () => { calls += 1; return { products: [1, 2, 3] }; };
    await expect(cache.getWithLock('v2:products:list:x', fn, 60, ['product:list']))
      .resolves.toEqual({ products: [1, 2, 3] });
    expect(calls).toBe(1);
  });

  it('getWithLock still propagates a real error from the data source', async () => {
    const fn = async () => { throw new Error('db down'); };
    await expect(cache.getWithLock('k', fn, 60)).rejects.toThrow('db down');
  });

  it('Redis dropping mid-request (after the lock) does not turn a good result into an error', async () => {
    let sets = 0;
    override.get = async () => null;                       // miss
    override.set = () => (sets++ === 0 ? Promise.resolve('OK') : closed()); // lock OK, write fails
    override.eval = closed;                                // release fails
    let calls = 0;
    const fn = async () => { calls += 1; return 'fresh'; };
    await expect(cache.getWithLock('k2', fn, 60)).resolves.toBe('fresh');
    expect(calls).toBe(1);
  });

  it('background revalidation never rejects', async () => {
    await expect(cache.revalidateWithLock('k4', async () => 'v', 60, [])).resolves.toBeUndefined();
  });
});
