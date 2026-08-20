/**
 * Session validation must not issue a hash command against a string key.
 *
 * createSession() stores the session with `setex` as a JSON STRING. validateSession()
 * used to "touch" it with `hset(key, 'lastAccessedAt', ...)`, and HSET against a
 * string key raises WRONGTYPE in Redis. The throw was swallowed by the surrounding
 * catch, so every authenticated request quietly fell back to a MongoDB session
 * lookup — visible in production only as:
 *
 *   [Session] Redis validation error, falling back to MongoDB: ... WRONGTYPE ...
 *
 * It also had a race with a lasting cost: when the key expired between the `exists`
 * check and the HSET, the HSET CREATED a hash carrying NO TTL, which then survived
 * forever and made every later GET of that key throw as well.
 *
 * These tests pin the type contract: validation may only use string/key commands.
 */
import { jest } from '@jest/globals';
import sessionStore from '../services/sessionStore.js';

// A fake Redis that enforces the one rule real Redis enforces here: hash commands
// against a string key fail. Without this, a unit test would happily "pass" on the
// exact call that breaks in production.
function makeTypedRedis() {
  const types = new Map();
  const wrongType = () => {
    const e = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    e.name = 'ReplyError';
    return e;
  };
  return {
    types,
    setex: jest.fn(async (k) => { types.set(k, 'string'); return 'OK'; }),
    sadd: jest.fn(async () => 1),
    exists: jest.fn(async (k) => (types.has(k) ? 1 : 0)),
    hset: jest.fn(async (k) => {
      if (types.get(k) === 'string') throw wrongType();
      types.set(k, 'hash');
      return 1;
    }),
    get: jest.fn(async (k) => {
      if (types.get(k) === 'hash') throw wrongType();
      return types.has(k) ? '{}' : null;
    }),
    expire: jest.fn(async () => 1),
  };
}

describe('sessionStore.validateSession — Redis type safety', () => {
  let redis;
  let original;

  beforeEach(() => {
    redis = makeTypedRedis();
    original = sessionStore.redis;
    sessionStore.redis = redis;
    redis.types.set('session:user-1:sess-1', 'string'); // as createSession would leave it
  });

  afterEach(() => { sessionStore.redis = original; });

  it('validates a live session without throwing WRONGTYPE', async () => {
    await expect(sessionStore.validateSession('user-1', 'sess-1')).resolves.toBe(true);
  });

  it('never issues a hash command against the session key', async () => {
    // The actual regression. HSET here is what silently disabled the Redis session
    // cache and pushed every authenticated request onto MongoDB.
    await sessionStore.validateSession('user-1', 'sess-1');
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('leaves the key a string, so later reads still parse', async () => {
    await sessionStore.validateSession('user-1', 'sess-1');
    expect(redis.types.get('session:user-1:sess-1')).toBe('string');
    await expect(redis.get('session:user-1:sess-1')).resolves.toBe('{}');
  });

  it('reports an absent session as invalid rather than erroring', async () => {
    await expect(sessionStore.validateSession('user-1', 'missing')).resolves.toBe(false);
  });

  it('validates in PRODUCTION mode without throwing (the real-world symptom)', async () => {
    // Severity lives here. The catch in validateSession fails OPEN in dev/test
    // (returns true) but fails CLOSED in production by rethrowing — so under the old
    // HSET the production path threw on every authenticated request and the caller
    // logged "[Session] Redis validation error, falling back to MongoDB" and did a
    // Mongo lookup instead. A test left at NODE_ENV=test would never have seen it.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(sessionStore.validateSession('user-1', 'sess-1')).resolves.toBe(true);
      expect(err).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
      err.mockRestore();
    }
  });

  it('does not silently start sliding the TTL', async () => {
    // Sessions expire at a fixed TTL from creation. Making them slide is a security
    // decision, not a side effect of repairing the type bug — so assert it is absent.
    await sessionStore.validateSession('user-1', 'sess-1');
    expect(redis.expire).not.toHaveBeenCalled();
  });
});


/**
 * Absolute session lifetime cap (SESSION_ABSOLUTE_MAX_DAYS).
 *
 * Sliding expiration already renews a session on every refresh, so an actively used
 * session never expires. This is the OWASP "absolute timeout" half — a ceiling
 * measured from creation that activity cannot extend. Off by default.
 */
describe('sessionStore.validateSession — absolute lifetime cap', () => {
  let redis;
  let original;
  let prevEnv;

  const KEY = 'session:user-1:sess-1';
  const seed = (createdAtIso) => {
    redis.types.set(KEY, 'string');
    redis.values.set(KEY, JSON.stringify({ createdAt: createdAtIso }));
  };

  beforeEach(() => {
    redis = makeTypedRedis();
    redis.values = new Map();
    redis.get = jest.fn(async (k) => {
      if (redis.types.get(k) === 'hash') throw new Error('WRONGTYPE');
      return redis.values.has(k) ? redis.values.get(k) : null;
    });
    redis.del = jest.fn(async (k) => { redis.types.delete(k); redis.values.delete(k); return 1; });
    original = sessionStore.redis;
    sessionStore.redis = redis;
    prevEnv = process.env.SESSION_ABSOLUTE_MAX_DAYS;
  });

  afterEach(() => {
    sessionStore.redis = original;
    if (prevEnv === undefined) delete process.env.SESSION_ABSOLUTE_MAX_DAYS;
    else process.env.SESSION_ABSOLUTE_MAX_DAYS = prevEnv;
  });

  it('is OFF by default — no extra read, no behaviour change', async () => {
    delete process.env.SESSION_ABSOLUTE_MAX_DAYS;
    seed(new Date(Date.now() - 999 * 864e5).toISOString()); // absurdly old
    await expect(sessionStore.validateSession('user-1', 'sess-1')).resolves.toBe(true);
    // The fast path must stay a single EXISTS when the control is disabled.
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('accepts a session younger than the ceiling', async () => {
    process.env.SESSION_ABSOLUTE_MAX_DAYS = '30';
    seed(new Date(Date.now() - 5 * 864e5).toISOString()); // 5 days old
    await expect(sessionStore.validateSession('user-1', 'sess-1')).resolves.toBe(true);
  });

  it('rejects a session older than the ceiling, however active it has been', async () => {
    process.env.SESSION_ABSOLUTE_MAX_DAYS = '30';
    seed(new Date(Date.now() - 31 * 864e5).toISOString()); // 31 days old
    await expect(sessionStore.validateSession('user-1', 'sess-1')).resolves.toBe(false);
  });

  it('deletes the expired key rather than leaving it to be re-checked forever', async () => {
    process.env.SESSION_ABSOLUTE_MAX_DAYS = '30';
    seed(new Date(Date.now() - 31 * 864e5).toISOString());
    await sessionStore.validateSession('user-1', 'sess-1');
    expect(redis.del).toHaveBeenCalledWith(KEY);
  });

  it('fails CLOSED when the age cannot be established', async () => {
    // No createdAt => malformed/orphaned key. A control that exists to bound session
    // age must not hand unlimited life to a session that cannot prove its own.
    process.env.SESSION_ABSOLUTE_MAX_DAYS = '30';
    redis.types.set(KEY, 'string');
    redis.values.set(KEY, JSON.stringify({ noCreatedAt: true }));
    await expect(sessionStore.validateSession('user-1', 'sess-1')).resolves.toBe(false);
  });

  it('ignores a zero or malformed setting rather than locking everyone out', async () => {
    seed(new Date(Date.now() - 999 * 864e5).toISOString());
    for (const bad of ['0', '-1', 'abc', '']) {
      process.env.SESSION_ABSOLUTE_MAX_DAYS = bad;
      redis.types.set(KEY, 'string'); // re-seed; a prior loop may have deleted it
      await expect(sessionStore.validateSession('user-1', 'sess-1')).resolves.toBe(true);
    }
  });
});
