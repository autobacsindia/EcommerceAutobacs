/**
 * The production Redis startup gate (utils/redisStartupCheck.js).
 *
 * The regression this guards: a 2-second budget covering connect + TLS + PING
 * failed healthy Redis at cold start and blocked every deploy for a day. The
 * gate must tolerate a slow connect, retry a transient failure, and still
 * refuse to start when Redis is really down.
 */
import { jest } from '@jest/globals';
import { verifyRedisAtStartup } from '../../../utils/redisStartupCheck.js';

const quiet = { log: jest.fn(), warn: jest.fn() };

/** A fake ioredis whose Nth instance behaves per `plan[n]`. */
function fakeRedis(plan) {
  const made = [];
  class FakeRedis {
    constructor(url, opts) {
      this.url = url;
      this.opts = opts;
      this.step = plan[made.length] || plan[plan.length - 1];
      made.push(this);
    }
    on() { return this; }
    connect() { return new Promise((res, rej) => setTimeout(() => (this.step.connect === 'fail' ? rej(new Error('ECONNREFUSED')) : res()), this.step.connectMs ?? 0)); }
    ping() { return new Promise((res) => setTimeout(() => res('PONG'), this.step.pingMs ?? 0)); }
    quit() { return Promise.resolve(); }
    disconnect() {}
  }
  return { FakeRedis, made };
}

describe('Redis startup gate', () => {
  it('passes a connect slower than the old 2 s budget (the outage)', async () => {
    const { FakeRedis } = fakeRedis([{ connectMs: 2500, pingMs: 50 }]);
    const res = await verifyRedisAtStartup('rediss://x', { RedisCtor: FakeRedis, log: quiet });
    expect(res).toMatchObject({ ok: true, attempts: 1 });
    expect(res.ms).toBeGreaterThanOrEqual(2500);
  });

  it('retries a transient failure and then passes', async () => {
    const { FakeRedis, made } = fakeRedis([{ connect: 'fail' }, { connectMs: 10 }]);
    const res = await verifyRedisAtStartup('rediss://x', { RedisCtor: FakeRedis, log: quiet, backoffMs: 1 });
    expect(res).toMatchObject({ ok: true, attempts: 2 });
    expect(made).toHaveLength(2);
  });

  it('still refuses to start when Redis is really down', async () => {
    const { FakeRedis, made } = fakeRedis([{ connect: 'fail' }]);
    const res = await verifyRedisAtStartup('rediss://x', { RedisCtor: FakeRedis, log: quiet, backoffMs: 1 });
    expect(res).toEqual({ ok: false, attempts: 3, error: 'ECONNREFUSED' });
    expect(made).toHaveLength(3);
  });

  it('bounds a connect that hangs, and a PING that hangs', async () => {
    const hang = fakeRedis([{ connectMs: 60_000 }]);
    const a = await verifyRedisAtStartup('rediss://x', { RedisCtor: hang.FakeRedis, log: quiet, attempts: 1, connectTimeout: 20 });
    expect(a).toMatchObject({ ok: false, error: expect.stringMatching(/connect timed out/) });

    const slowPing = fakeRedis([{ pingMs: 60_000 }]);
    const b = await verifyRedisAtStartup('rediss://x', { RedisCtor: slowPing.FakeRedis, log: quiet, attempts: 1, commandTimeout: 20 });
    expect(b).toMatchObject({ ok: false, error: expect.stringMatching(/PING timed out/) });
  });

  it('uses TLS for rediss:// and a single connection per attempt', async () => {
    const { FakeRedis, made } = fakeRedis([{}]);
    await verifyRedisAtStartup('rediss://x', { RedisCtor: FakeRedis, log: quiet });
    expect(made[0].opts).toMatchObject({ lazyConnect: true, tls: {}, enableOfflineQueue: false });
    expect(made[0].opts.retryStrategy()).toBeNull();
  });
});
