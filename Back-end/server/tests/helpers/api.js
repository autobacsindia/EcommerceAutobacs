/**
 * Shared helpers for supertest-based API suites.
 *
 * These exist because the same three pieces of fixture rot broke seven suites at
 * once, and each was silent in a different way:
 *
 *   1. ROUTES ARE MOUNTED ONLY AT /api/v1. A request to `/wishlist` does not fail
 *      loudly — it 404s through the notFound handler, so the assertion that breaks
 *      is `expect(201)` and the cause looks like a broken controller.
 *   2. AUTH IS httpOnly-COOKIE BASED. `loginRes.body.accessToken` is `undefined`,
 *      so every "authenticated" request silently ran as anonymous.
 *   3. Product fixtures need a `slug` — it is `required` with no auto-generation.
 *
 * Centralising them means the next auth or mount change is one edit, not seven.
 */

/** Every route lives under this prefix. Never hand-write it in a suite. */
export const API = '/api/v1';

/**
 * Pull the access token out of a login response.
 *
 * The app sets an httpOnly `accessToken` cookie rather than returning it in the
 * body. The body fallback keeps this working if that ever changes back.
 *
 * @param {import('supertest').Response} loginRes
 * @returns {string|undefined}
 */
export function accessTokenFrom(loginRes) {
  const cookie = (loginRes.headers['set-cookie'] || [])
    .find((c) => c.startsWith('accessToken='));
  return cookie
    ? cookie.split(';')[0].slice('accessToken='.length)
    : loginRes.body?.accessToken;
}

/**
 * Pull the refresh token out of a login/register response.
 *
 * Like the access token it is an httpOnly cookie now, so `res.body.refreshToken`
 * is `undefined` — a suite reading it sends an empty token and gets a 400
 * ("Refresh token is required") from the validator, which looks like the refresh
 * endpoint rejecting a REVOKED token when it never saw one at all.
 *
 * @param {import('supertest').Response} res
 * @returns {string|undefined}
 */
export function refreshTokenFrom(res) {
  const cookie = (res.headers['set-cookie'] || [])
    .find((c) => c.startsWith('refreshToken='));
  return cookie
    ? cookie.split(';')[0].slice('refreshToken='.length)
    : res.body?.refreshToken;
}

/**
 * Log in and return a usable Bearer token.
 *
 * Throws on a non-200 rather than returning undefined: a suite that silently
 * continues unauthenticated produces a wall of 401/404s whose cause is invisible.
 *
 * @param {import('express').Express} app
 * @param {{email: string, password: string}} credentials
 * @returns {Promise<string>}
 */
export async function loginAs(app, { email, password }) {
  const request = (await import('supertest')).default;
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });

  if (res.status !== 200) {
    throw new Error(
      `Test login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  const token = accessTokenFrom(res);
  if (!token) {
    throw new Error(
      `Login succeeded but no accessToken cookie was set for ${email}. ` +
      'Auth is httpOnly-cookie based — see tests/helpers/api.js.'
    );
  }
  return token;
}

/**
 * Minimum viable Product fixture. `slug` is required with no auto-generation, so
 * omitting it fails validation with a message that does not mention the fixture.
 *
 * @param {Object} [overrides]
 */
export function productFixture(overrides = {}) {
  const name = overrides.name || 'Test Product';
  return {
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    price: 99.99,
    description: 'Test product description',
    brand: 'Test Brand',
    stock: 'in',
    isActive: true,
    ...overrides,
  };
}
