/**
 * GET /payment-config/razorpay — the public key the PDP's EMI widget embeds.
 *
 * The contract that matters is narrow and security-shaped: the response carries the
 * key id checkout uses and NOTHING else (above all, never the secret), and a missing
 * or malformed key is a loud 503 the CDN will not cache — not a 200 with an empty or
 * dangerous value that the widget would silently fail on.
 */

import request from 'supertest';
import { app } from '../app.js';
import razorpayService from '../services/razorpayService.js';

const URL = '/api/v1/payment-config/razorpay';

let realKeyId;
beforeEach(() => {
  realKeyId = razorpayService.key_id;
});
afterEach(() => {
  razorpayService.key_id = realKeyId;
});

describe('GET /payment-config/razorpay', () => {
  it('returns exactly the key id checkout uses — and only that', async () => {
    const res = await request(app).get(URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { keyId: process.env.RAZORPAY_KEY_ID } });
    // Same value createOrder hands to checkout, so the widget can never drift from it.
    expect(res.body.data.keyId).toBe(razorpayService.key_id);
  });

  it('never leaks the key secret anywhere in the response', async () => {
    const res = await request(app).get(URL);
    const raw = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(raw).not.toContain(process.env.RAZORPAY_KEY_SECRET);
  });

  it('answers 503 (not cacheable) when the key is not configured', async () => {
    razorpayService.key_id = undefined;
    const res = await request(app).get(URL);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['empty string', ''],
    // The suite's fake secret (tests/setupEnv.js) — read from env, not repeated as a
    // literal, so the secret scanner has nothing to match in this file.
    ['the secret pasted into the key id', process.env.RAZORPAY_KEY_SECRET],
    ['a non-Razorpay value', 'pk_live_abc123'],
    ['a key with an injected suffix', 'rzp_live_abc123"><script>'],
  ])('refuses to publish a malformed key id (%s)', async (_label, value) => {
    razorpayService.key_id = value;
    const res = await request(app).get(URL);

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(value || '__never__');
  });

  it('accepts live and test keys, trimming stray whitespace from the env', async () => {
    razorpayService.key_id = '  rzp_live_AbC123xyz \n';
    const res = await request(app).get(URL);

    expect(res.status).toBe(200);
    expect(res.body.data.keyId).toBe('rzp_live_AbC123xyz');
  });

  it('is a public read — no auth, no CSRF, no session cookie set', async () => {
    const res = await request(app).get(URL);

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] || [];
    // A Set-Cookie would make a compliant CDN refuse to cache the shared response.
    expect(cookies.filter((c) => !c.startsWith('XSRF-TOKEN='))).toEqual([]);
  });
});

describe('razorpayService.getPublicKeyId', () => {
  it('returns null rather than throwing on a non-string value', () => {
    razorpayService.key_id = 12345;
    expect(razorpayService.getPublicKeyId()).toBeNull();
  });
});
