/**
 * Integration tests — Auth flow
 *
 * Uses mongodb-memory-server for a real but isolated Mongo instance.
 * Uses supertest against the Express app (imported without starting the server).
 *
 * Covers:
 *   POST /api/v1/auth/register
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/refresh
 *   GET  /api/v1/auth/me
 *   POST /api/v1/auth/logout-all
 *
 * CSRF notes:
 *   - /auth/login and /auth/register are on the CSRF exclusion list → no token needed.
 *   - /auth/refresh and /auth/logout-all require XSRF-TOKEN cookie + X-XSRF-TOKEN header.
 *     We do a GET /ping first to receive the cookie, then mirror it in the header.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../app.js';
import * as dbHandler from './db-handler.js';

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await dbHandler.connect();
}, 120000);

afterAll(async () => {
  await dbHandler.closeDatabase();
});

afterEach(async () => {
  await dbHandler.clearDatabase();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = '/api/v1/auth';

const TEST_USER = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'SecurePass123!',
};

/**
 * Extract the XSRF-TOKEN value from a set-cookie header array.
 * Returns empty string if not found.
 */
function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrfCookie = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  if (!xsrfCookie) return '';
  return xsrfCookie.split(';')[0].split('=')[1];
}

/**
 * Obtain the XSRF-TOKEN value from the agent.
 * The CSRF middleware sets the cookie on the first request through it.
 * If the agent's jar already has the cookie (from register/login), do a fresh
 * GET /ping with a brand-new request to get it, then inject into the agent.
 */
async function getCsrfToken(agent) {
  // Try GET /ping — if XSRF-TOKEN not yet in jar, server will set it here
  const res = await agent.get('/ping');
  const fromPing = extractCsrfFromSetCookie(res.headers['set-cookie'] || []);
  if (fromPing) return { csrfToken: fromPing };

  // Cookie already in jar (set during register) — extract via a throwaway request
  // by sending a GET that echoes cookies; simplest approach is a second GET.
  // The server won't set-cookie again, so parse from the agent's jar via
  // an unauthenticated endpoint that reflects cookies back.
  // Fallback: parse the agent's internal _jar (tough-cookie).
  const jar = agent.jar;
  if (jar) {
    const cookies = jar.getCookiesSync ? jar.getCookiesSync('http://127.0.0.1') : [];
    const xsrf = cookies.find((c) => c.key === 'XSRF-TOKEN');
    if (xsrf) return { csrfToken: xsrf.value };
  }

  return { csrfToken: '' };
}

/**
 * Register + login, returning { accessToken, refreshToken, csrfToken, agent }.
 * Uses a persistent agent so cookies survive across requests.
 * The XSRF-TOKEN cookie is captured from the register response.
 */
async function registerAndLogin(userData = TEST_USER) {
  const agent = request.agent(app);

  // Register — CSRF middleware sets XSRF-TOKEN cookie on this response
  const regRes = await agent.post(`${BASE}/register`).send(userData);
  const csrfToken = extractCsrfFromSetCookie(regRes.headers['set-cookie'] || []);

  const loginRes = await agent
    .post(`${BASE}/login`)
    .send({ email: userData.email, password: userData.password });

  const accessToken  = loginRes.body.accessToken;
  const refreshToken = loginRes.body.refreshToken;

  return { agent, accessToken, refreshToken, csrfToken };
}

// ── Registration ──────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  test('valid payload → 201 with accessToken and user object', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send(TEST_USER);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.email).toBe(TEST_USER.email.toLowerCase());
    expect(res.body.user.role).toBe('customer');
  });

  test('response does NOT contain passwordHash', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send(TEST_USER);

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  test('duplicate email → 400', async () => {
    await request(app).post(`${BASE}/register`).send(TEST_USER);

    const res = await request(app)
      .post(`${BASE}/register`)
      .send(TEST_USER);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('missing password → 400 validation error', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ name: 'No Pass', email: 'nopass@example.com' });

    expect(res.status).toBe(400);
  });

  test('invalid email format → 400', async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ name: 'Bad Email', email: 'not-an-email', password: 'Pass123!' });

    expect(res.status).toBe(400);
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app).post(`${BASE}/register`).send(TEST_USER);
  });

  test('correct credentials → 200 with accessToken', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.email).toBe(TEST_USER.email.toLowerCase());
  });

  test('correct credentials → sets refreshToken cookie', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    const cookies = res.headers['set-cookie'] || [];
    const hasRefreshCookie = cookies.some((c) => c.startsWith('refreshToken='));
    expect(hasRefreshCookie).toBe(true);
  });

  test('wrong password → 401', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: TEST_USER.email, password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('non-existent email → 401', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'ghost@example.com', password: 'Whatever1!' });

    expect(res.status).toBe(401);
  });

  test('response does NOT contain passwordHash', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
  test('valid Bearer token → 200 with user, no passwordHash', async () => {
    const { accessToken } = await registerAndLogin();

    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(TEST_USER.email.toLowerCase());
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('no token → 401', async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });

  test('malformed Bearer token → 401', async () => {
    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', 'Bearer tampered.invalid.token');
    expect(res.status).toBe(401);
  });
});

// ── Token refresh ─────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  test('valid refresh token in body → 200 with new accessToken', async () => {
    const { agent, refreshToken, csrfToken } = await registerAndLogin();

    const res = await agent
      .post(`${BASE}/refresh`)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  test('tampered refresh token in body (no cookie) → 401', async () => {
    // The refresh route reads req.cookies.refreshToken first, then falls back
    // to req.body.refreshToken. To test a tampered body token we must use a
    // fresh agent that carries no refreshToken cookie.
    // We still need CSRF: set matching XSRF-TOKEN cookie + header manually.
    const fakeCsrf = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `XSRF-TOKEN=${fakeCsrf}`)
      .set('X-XSRF-TOKEN', fakeCsrf)
      .send({ refreshToken: 'definitely.not.valid' });

    expect(res.status).toBe(401);
  });

  test('missing CSRF token → 403', async () => {
    const { refreshToken } = await registerAndLogin();

    // Use a fresh agent (no XSRF cookie set) to simulate missing CSRF
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .send({ refreshToken });

    expect(res.status).toBe(403);
  });
});

// ── Logout all ────────────────────────────────────────────────────────────────

describe('POST /auth/logout-all', () => {
  test('clears all refresh tokens from DB and returns 200', async () => {
    const { agent, accessToken, refreshToken, csrfToken } = await registerAndLogin();

    const logoutRes = await agent
      .post(`${BASE}/logout-all`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-XSRF-TOKEN', csrfToken);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Attempting to refresh with old token after logout-all must fail
    const refreshRes = await agent
      .post(`${BASE}/refresh`)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ refreshToken });

    expect(refreshRes.status).toBe(401);
  });

  test('no Authorization → 401', async () => {
    const { agent, csrfToken } = await registerAndLogin();

    const res = await agent
      .post(`${BASE}/logout-all`)
      .set('X-XSRF-TOKEN', csrfToken);

    expect(res.status).toBe(401);
  });
});
