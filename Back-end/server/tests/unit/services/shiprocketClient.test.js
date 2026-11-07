import { jest } from '@jest/globals';
import { ShiprocketClient, ShiprocketError, TOKEN_CACHE_KEY, TOKEN_TTL_SECONDS } from '../../../services/shiprocketClient.js';

const ENV = { SHIPROCKET_API_EMAIL: 'api@autobacs.test', SHIPROCKET_API_PASSWORD: 's3cret-pass' };

function fakeRedis() {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (k) => store.get(k) ?? null),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (k) => { store.delete(k); return 1; }),
  };
}

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

/** Routes requests by path; `routes[path]` is an array of responses (consumed in order) or a function. */
function fakeFetch(routes) {
  const calls = [];
  const fn = jest.fn(async (url, init) => {
    const path = new URL(url).pathname.replace('/v1/external', '');
    calls.push({ path, url, init });
    const r = routes[path];
    if (typeof r === 'function') return r(init, calls);
    if (Array.isArray(r) && r.length) return r.length > 1 ? r.shift() : r[0];
    throw new Error(`unexpected ${path}`);
  });
  fn.calls = calls;
  return fn;
}

function client({ env = ENV, fetchImpl, redis = fakeRedis(), healthy = true, now } = {}) {
  return new ShiprocketClient({
    env: () => env, fetchImpl, getRedis: () => redis, redisHealthy: () => healthy, ...(now && { now }),
  });
}

const PICKUPS = { data: { shipping_address: [
  { pickup_location: 'Main WH', pin_code: 560001, city: 'Bengaluru', state: 'Karnataka', is_primary_location: 1 },
  { pickup_location: 'Second', pin_code: '110001', city: 'Delhi', state: 'Delhi', is_primary_location: 0 },
] } };

describe('configuration', () => {
  test('isConfigured needs both email and password', () => {
    expect(client({ fetchImpl: jest.fn() }).isConfigured()).toBe(true);
    expect(client({ env: { SHIPROCKET_API_EMAIL: 'a@b' }, fetchImpl: jest.fn() }).isConfigured()).toBe(false);
  });

  test('a call without credentials fails NOT_CONFIGURED and never hits the network', async () => {
    const f = jest.fn();
    await expect(client({ env: {}, fetchImpl: f }).get('/x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('login + token cache', () => {
  test('logs in once, caches the token in Redis for 9 days, sends it as Bearer', async () => {
    const redis = fakeRedis();
    const f = fakeFetch({ '/auth/login': [json(200, { token: 'tok-1' })], '/settings/company/pickup': [json(200, PICKUPS)] });
    const c = client({ fetchImpl: f, redis });

    await c.listPickupLocations();
    await c.listPickupLocations();

    expect(f.calls.filter((x) => x.path === '/auth/login')).toHaveLength(1);
    expect(JSON.parse(f.calls[0].init.body)).toEqual({ email: ENV.SHIPROCKET_API_EMAIL, password: ENV.SHIPROCKET_API_PASSWORD });
    expect(redis.set).toHaveBeenCalledWith(TOKEN_CACHE_KEY, 'tok-1', 'EX', TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBeLessThan(10 * 24 * 3600);
    const api = f.calls.filter((x) => x.path === '/settings/company/pickup');
    expect(api.every((x) => x.init.headers.Authorization === 'Bearer tok-1')).toBe(true);
  });

  test('a token another replica stored in Redis is reused — no login', async () => {
    const redis = fakeRedis();
    redis.store.set(TOKEN_CACHE_KEY, 'shared-tok');
    const f = fakeFetch({ '/settings/company/pickup': [json(200, PICKUPS)] });

    await client({ fetchImpl: f, redis }).listPickupLocations();

    expect(f.calls.map((x) => x.path)).toEqual(['/settings/company/pickup']);
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer shared-tok');
  });

  test('concurrent first calls share ONE login (single-flight)', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const f = fakeFetch({
      '/auth/login': async () => { await gate; return json(200, { token: 'tok' }); },
      '/settings/company/pickup': [json(200, PICKUPS)],
    });
    const c = client({ fetchImpl: f });

    const all = Promise.all([c.listPickupLocations(), c.listPickupLocations(), c.listPickupLocations()]);
    await new Promise((r) => setImmediate(r));
    release();
    await all;

    expect(f.calls.filter((x) => x.path === '/auth/login')).toHaveLength(1);
  });

  test('a failed login is not cached — the next call tries again', async () => {
    const f = fakeFetch({
      '/auth/login': [json(500, { message: 'down' }), json(200, { token: 'tok' })],
      '/settings/company/pickup': [json(200, PICKUPS)],
    });
    const c = client({ fetchImpl: f });

    await expect(c.listPickupLocations()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(c.listPickupLocations()).resolves.toHaveLength(2);
  });

  test('Redis down → falls back to an in-memory token (still one login)', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 'mem' })], '/settings/company/pickup': [json(200, PICKUPS)] });
    const redis = fakeRedis();
    const c = client({ fetchImpl: f, redis, healthy: false });

    await c.listPickupLocations();
    await c.listPickupLocations();

    expect(redis.get).not.toHaveBeenCalled();
    expect(f.calls.filter((x) => x.path === '/auth/login')).toHaveLength(1);
  });

  test('Redis throwing is survived', async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue(new Error('ECONNRESET'));
    redis.set.mockRejectedValue(new Error('ECONNRESET'));
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/settings/company/pickup': [json(200, PICKUPS)] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(client({ fetchImpl: f, redis }).listPickupLocations()).resolves.toHaveLength(2);
    warn.mockRestore();
  });

  test('the in-memory fallback token expires after the TTL', async () => {
    let t = 0;
    const f = fakeFetch({ '/auth/login': [json(200, { token: 'a' })], '/settings/company/pickup': [json(200, PICKUPS)] });
    const c = client({ fetchImpl: f, healthy: false, now: () => t });

    await c.listPickupLocations();
    t = TOKEN_TTL_SECONDS * 1000 + 1;
    await c.listPickupLocations();

    expect(f.calls.filter((x) => x.path === '/auth/login')).toHaveLength(2);
  });

  test('wrong credentials → AUTH_FAILED with a message that never contains the password', async () => {
    const f = fakeFetch({ '/auth/login': [json(400, { message: 'Invalid email and password combination' })] });
    const err = await client({ fetchImpl: f }).get('/x').catch((e) => e);

    expect(err).toBeInstanceOf(ShiprocketError);
    expect(err.code).toBe('AUTH_FAILED');
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(ENV.SHIPROCKET_API_PASSWORD);
  });

  test('a login reply with no token is BAD_RESPONSE', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { foo: 1 })] });
    await expect(client({ fetchImpl: f }).get('/x')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

describe('401 handling', () => {
  test('a rejected cached token is dropped, re-login happens, and the call is retried ONCE', async () => {
    const redis = fakeRedis();
    redis.store.set(TOKEN_CACHE_KEY, 'stale');
    const f = fakeFetch({
      '/auth/login': [json(200, { token: 'fresh' })],
      '/settings/company/pickup': (init) => json(init.headers.Authorization === 'Bearer fresh' ? 200 : 401, PICKUPS),
    });

    await expect(client({ fetchImpl: f, redis }).listPickupLocations()).resolves.toHaveLength(2);
    expect(redis.store.get(TOKEN_CACHE_KEY)).toBe('fresh');
    expect(f.calls.map((x) => x.path)).toEqual(['/settings/company/pickup', '/auth/login', '/settings/company/pickup']);
  });

  test('a second 401 after re-login fails AUTH_FAILED — no loop', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/x': [json(401, { message: 'Unauthenticated.' })] });
    await expect(client({ fetchImpl: f }).get('/x')).rejects.toMatchObject({ code: 'AUTH_FAILED', status: 401 });
    expect(f.calls.filter((x) => x.path === '/x')).toHaveLength(2);
  });

  test('never deletes a fresher token another replica stored meanwhile', async () => {
    const redis = fakeRedis();
    redis.store.set(TOKEN_CACHE_KEY, 'stale');
    const f = fakeFetch({
      '/x': (init) => {
        if (init.headers.Authorization === 'Bearer stale') {
          redis.store.set(TOKEN_CACHE_KEY, 'other-replica'); // replica B refreshed while we waited
          return json(401, {});
        }
        return json(200, { ok: true });
      },
    });

    await client({ fetchImpl: f, redis }).get('/x');
    // We re-read the cache after dropping our own token → used B's token, no login of our own.
    expect(f.calls.map((x) => x.path)).toEqual(['/x', '/x']);
    expect(redis.store.get(TOKEN_CACHE_KEY)).toBe('other-replica');
  });
});

describe('errors and no blind retries', () => {
  test('a 5xx is thrown once, never retried (creates are not idempotent at Shiprocket)', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/orders/create/adhoc': [json(502, 'Bad gateway')] });
    await expect(client({ fetchImpl: f }).post('/orders/create/adhoc', { a: 1 }))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', status: 502, message: 'Bad gateway' });
    expect(f.calls.filter((x) => x.path === '/orders/create/adhoc')).toHaveLength(1);
  });

  test('validation messages from {errors:{field:[msg]}} surface', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/x': [json(422, { errors: { pincode: ['Invalid pincode'] } })] });
    await expect(client({ fetchImpl: f }).post('/x', {})).rejects.toMatchObject({ message: 'Invalid pincode', status: 422 });
  });

  test('a timeout becomes TIMEOUT, a network error NETWORK', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    await expect(client({ fetchImpl: jest.fn().mockRejectedValue(timeout) }).get('/x')).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
    await expect(client({ fetchImpl: jest.fn().mockRejectedValue(new Error('ENOTFOUND')) }).get('/x')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  test('every request carries a timeout signal; query params are encoded, blanks skipped', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/courier/serviceability': [json(200, {})] });
    await client({ fetchImpl: f }).get('/courier/serviceability', { query: { delivery_postcode: '560001', cod: 1, weight: '', x: null } });
    const call = f.calls.find((x) => x.path === '/courier/serviceability');
    expect(call.init.signal).toBeDefined();
    expect(new URL(call.url).search).toBe('?delivery_postcode=560001&cod=1');
  });

  test('SHIPROCKET_API_BASE_URL overrides the host (trailing slash tolerated)', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/x': [json(200, {})] });
    await client({ env: { ...ENV, SHIPROCKET_API_BASE_URL: 'https://sandbox.example/v1/external/' }, fetchImpl: f }).get('/x');
    expect(f.calls[0].url).toBe('https://sandbox.example/v1/external/auth/login');
  });
});

describe('listPickupLocations', () => {
  test('maps Shiprocket rows to plain fields', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/settings/company/pickup': [json(200, PICKUPS)] });
    await expect(client({ fetchImpl: f }).listPickupLocations()).resolves.toEqual([
      { name: 'Main WH', pincode: '560001', city: 'Bengaluru', state: 'Karnataka', primary: true },
      { name: 'Second', pincode: '110001', city: 'Delhi', state: 'Delhi', primary: false },
    ]);
  });

  test('an unexpected shape yields an empty list, not a crash', async () => {
    const f = fakeFetch({ '/auth/login': [json(200, { token: 't' })], '/settings/company/pickup': [json(200, { data: {} })] });
    await expect(client({ fetchImpl: f }).listPickupLocations()).resolves.toEqual([]);
  });
});
