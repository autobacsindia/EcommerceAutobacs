/**
 * CSRF Middleware Integration Tests
 *
 * Verifies that csrfProtection is correctly mounted and enforced:
 *   - State-changing requests (POST/PUT/DELETE) with cookie auth require a
 *     matching X-XSRF-TOKEN header.
 *   - Bearer-token requests are exempt (browsers never send these cross-site).
 *   - Explicitly excluded paths (login, register, refresh, …) are never blocked.
 *   - The Razorpay webhook (server-to-server, no cookies) bypasses CSRF because
 *     it is mounted before app.use(csrfProtection) in app.js.
 *   - Safe methods (GET, HEAD, OPTIONS) always pass through.
 */

import request from 'supertest';
import { app } from '../../app.js';
import mongoose from 'mongoose';

afterAll(async () => {
  await mongoose.connection.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF_MESSAGE = /CSRF token missing or invalid/i;

/** Returns true when the response is specifically a CSRF rejection. */
function isCsrfRejection(res) {
  return res.status === 403 && CSRF_MESSAGE.test(res.body?.message ?? '');
}

/**
 * Fetches a fresh XSRF-TOKEN cookie by making a GET request.
 * Returns the raw Set-Cookie value and the token string.
 */
async function fetchCsrfToken(path = '/api/v1/cart') {
  const res = await request(app).get(path);
  const setCookie = res.headers['set-cookie'] ?? [];
  const raw = setCookie.find(c => c.startsWith('XSRF-TOKEN=')) ?? '';
  const token = raw.split(';')[0].replace('XSRF-TOKEN=', '');
  return { raw, token };
}

// ── Token issuance ────────────────────────────────────────────────────────────

describe('XSRF-TOKEN cookie issuance', () => {
  it('sets XSRF-TOKEN on GET requests when cookie is absent', async () => {
    const res = await request(app).get('/api/v1/cart');
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('XSRF-TOKEN='))).toBe(true);
  });

  it('does not re-issue XSRF-TOKEN when cookie is already present', async () => {
    const { token } = await fetchCsrfToken();
    const res = await request(app)
      .get('/api/v1/cart')
      .set('Cookie', `XSRF-TOKEN=${token}`);
    const cookies = res.headers['set-cookie'] ?? [];
    // Cookie should not be re-set on subsequent requests
    expect(cookies.some(c => c.startsWith('XSRF-TOKEN='))).toBe(false);
  });
});

// ── Safe methods ──────────────────────────────────────────────────────────────

describe('safe methods (GET / HEAD / OPTIONS)', () => {
  it('GET passes without any CSRF token', async () => {
    const res = await request(app).get('/api/v1/products');
    expect(isCsrfRejection(res)).toBe(false);
  });

  it('OPTIONS passes without any CSRF token', async () => {
    const res = await request(app).options('/api/v1/cart');
    expect(isCsrfRejection(res)).toBe(false);
  });
});

// ── State-changing requests with cookie auth ──────────────────────────────────

describe('POST/PUT/DELETE with cookie auth', () => {
  it('rejects when X-XSRF-TOKEN header is absent', async () => {
    const res = await request(app)
      .post('/api/v1/cart/add')
      .set('Cookie', 'accessToken=faketoken') // cookie-based session present
      .send({ productId: '000000000000000000000001', quantity: 1 });

    expect(isCsrfRejection(res)).toBe(true);
  });

  it('rejects when X-XSRF-TOKEN does not match the XSRF-TOKEN cookie', async () => {
    const res = await request(app)
      .post('/api/v1/cart/add')
      .set('Cookie', 'accessToken=faketoken; XSRF-TOKEN=correcttoken')
      .set('X-XSRF-TOKEN', 'wrongtoken')
      .send({ productId: '000000000000000000000001', quantity: 1 });

    expect(isCsrfRejection(res)).toBe(true);
  });

  it('passes CSRF when X-XSRF-TOKEN matches the XSRF-TOKEN cookie', async () => {
    const token = 'a1b2c3d4'.repeat(8); // 64-char hex-like string
    const res = await request(app)
      .post('/api/v1/cart/add')
      .set('Cookie', `XSRF-TOKEN=${token}; accessToken=faketoken`)
      .set('X-XSRF-TOKEN', token)
      .send({ productId: '000000000000000000000001', quantity: 1 });

    // CSRF passes; request will fail for other reasons (auth/validation) but NOT CSRF
    expect(isCsrfRejection(res)).toBe(false);
  });

  it('rejects PUT without CSRF token when cookie auth is present', async () => {
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Cookie', 'accessToken=faketoken')
      .send({ name: 'Hacker' });

    expect(isCsrfRejection(res)).toBe(true);
  });

  it('rejects DELETE without CSRF token when cookie auth is present', async () => {
    const res = await request(app)
      .delete('/api/v1/cart/remove/000000000000000000000001')
      .set('Cookie', 'accessToken=faketoken');

    expect(isCsrfRejection(res)).toBe(true);
  });
});

// ── Bearer-token exemption ────────────────────────────────────────────────────

describe('Bearer-token exemption', () => {
  it('exempts POST with Authorization: Bearer header from CSRF check', async () => {
    const res = await request(app)
      .post('/api/v1/cart/add')
      .set('Authorization', 'Bearer somefaketoken')
      .send({ productId: '000000000000000000000001', quantity: 1 });

    // CSRF exempted; request may fail with 401 (bad JWT) but NOT a CSRF 403
    expect(isCsrfRejection(res)).toBe(false);
  });
});

// ── Excluded paths ────────────────────────────────────────────────────────────

describe('explicitly excluded paths', () => {
  it('POST /auth/login is not CSRF-checked', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'x@x.com', password: 'wrong' });

    expect(isCsrfRejection(res)).toBe(false);
  });

  it('POST /auth/register is not CSRF-checked', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'new@x.com', password: 'Pass1234!' });

    expect(isCsrfRejection(res)).toBe(false);
  });

  it('POST /auth/refresh is not CSRF-checked', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({});

    expect(isCsrfRejection(res)).toBe(false);
  });
});

// ── Razorpay webhook bypass ───────────────────────────────────────────────────

describe('Razorpay webhook mounts before csrfProtection', () => {
  it('webhook POST is not rejected by CSRF (server-to-server call)', async () => {
    // Razorpay sends no cookies and no Bearer token.
    // Before the fix, this returned 403 "CSRF token missing or invalid".
    // After moving the webhook mount above app.use(csrfProtection), CSRF never
    // runs on this path and the request reaches the webhook handler.
    const res = await request(app)
      .post('/api/v1/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'invalidsignature') // wrong sig → 400 from handler
      .send(Buffer.from('{}'));

    // Must NOT be a CSRF 403 — any other status is acceptable
    expect(isCsrfRejection(res)).toBe(false);
    expect(res.status).not.toBe(403);
  });
});
