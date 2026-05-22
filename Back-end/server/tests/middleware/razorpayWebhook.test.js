import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// ── Module mock references (assigned when factory functions execute at import time) ──
let mockRedis;         // ioredis constructor
let mockHandleWebhook; // razorpayService.handleWebhook

jest.unstable_mockModule('ioredis', () => {
  mockRedis = jest.fn();
  return { default: mockRedis };
});

jest.unstable_mockModule('../../services/razorpayService.js', () => {
  mockHandleWebhook = jest.fn();
  return { default: { handleWebhook: mockHandleWebhook } };
});

jest.unstable_mockModule('../../middleware/errorMiddleware.js', () => ({
  asyncHandler: (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next),
}));

// ── Module under test ─────────────────────────────────────────────────────────

const { default: webhookRouter } = await import('../../middleware/razorpayWebhook.js');

// ── Test constants ────────────────────────────────────────────────────────────

// Set to the same value used in staging via RAZORPAY_WEBHOOK_SECRET in .env.test.
// Tests are self-consistent — sign() and the handler both read this constant.
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'test-webhook-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

function sign(rawBody) {
  return crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

function makePayload() {
  // Return a plain JSON string — supertest sends strings as-is, whereas a Buffer
  // with Content-Type: application/json gets JSON.stringified by superagent,
  // corrupting the bytes and breaking HMAC comparison.
  return JSON.stringify({
    id: `evt_${Date.now()}`,
    event: 'payment.captured',
    created_at: Math.floor(Date.now() / 1000),
  });
}

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp({ correctOrder = true } = {}) {
  const app = express();
  if (correctOrder) {
    // Correct: raw body captured before JSON parser can destroy it
    app.use('/api/v1/razorpay/webhook', express.raw({ type: 'application/json' }), webhookRouter);
    app.use(express.json());
  } else {
    // Wrong order: simulates the pre-fix regression
    app.use(express.json());
    app.use('/api/v1/razorpay/webhook', express.raw({ type: 'application/json' }), webhookRouter);
  }
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('razorpayWebhook', () => {
  it('accepts a request with a valid HMAC-SHA256 signature', async () => {
    // Set up mocks here, not in beforeEach — resetMocks: true (jest.config.js) runs
    // before beforeEach in Jest 30 ESM mode and would clear anything set there.
    mockRedis.mockImplementation(() => ({
      get: jest.fn().mockResolvedValue(null), // no prior duplicate event
      set: jest.fn().mockResolvedValue('OK'),
      quit: jest.fn().mockResolvedValue('OK'),
    }));
    mockHandleWebhook.mockResolvedValue({ message: 'processed' });

    const body = makePayload();

    const res = await request(makeApp())
      .post('/api/v1/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(body))
      .send(body);

    expect(res.status).toBe(200);
  });

  it('rejects a request with an invalid signature', async () => {
    const body = makePayload();

    const res = await request(makeApp())
      .post('/api/v1/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(Buffer.from('tampered-body')))
      .send(body);

    expect(res.status).toBe(400);
  });

  it('rejects a valid signature when express.json() runs before express.raw() — body-parser ordering regression guard', async () => {
    // With wrong order, express.json() parses req.body into a JS object and sets
    // req._body = true. express.raw() then skips (body already consumed), leaving
    // req.body as an object. The HMAC digests "[object Object]" instead of the raw
    // bytes, so the signature always mismatches.
    // If this test ever starts returning 200, app.js has regressed.
    // Note: wrong order throws a TypeError in the HMAC call (object instead of Buffer),
    // caught by the outer try/catch → 500, not 400. The meaningful assertion is
    // "the request must not succeed", not the specific error code.
    const body = makePayload();

    const res = await request(makeApp({ correctOrder: false }))
      .post('/api/v1/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sign(body))
      .send(body);

    expect(res.status).not.toBe(200);
  });
});
