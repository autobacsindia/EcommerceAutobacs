/**
 * Payment Integration Tests — Razorpay (HTTP contract)
 *
 * Exercises the payment ROUTES via supertest against the real Express app:
 *   - create-order (authoritative amount from DB, not the client)
 *   - verify-payment signature verification (fraud prevention)
 *   - verify-payment's post-refactor contract: it validates + defers, and DOES NOT
 *     write to the DB — the webhook is the sole payment writer.
 *   - webhook signature gate
 *
 * The Razorpay SDK is mocked (no network). This suite runs against the shared
 * standalone in-memory Mongo from setup.js, which cannot run transactions — so the
 * money-critical webhook idempotency / concurrent-delivery dedup is covered
 * separately in razorpayWebhookRace.test.js (real replica set). Don't duplicate that
 * assertion here; a standalone-DB "no duplicate payments" check is meaningless because
 * verify-payment never creates a payment at all.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import crypto from 'crypto';

// razorpayService's singleton constructor (imported transitively by app.js) throws
// without these — set BEFORE app.js is imported.
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_secret_key_1234567890abcdef';
// Webhook signature middleware 500s if this is unset — set it so the invalid-signature
// path returns a real 400 (bad signature) rather than a config error.
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret';

const RAZORPAY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Mock the Razorpay SDK so create-order / verify-payment are deterministic (no network).
// orders.create echoes the requested amount; payments.fetch resolves a captured payment.
// NOTE: a plain class (not jest.fn) on purpose — jest.config's resetMocks:true would wipe
// a jest.fn().mockImplementation between tests and make the SDK return undefined.
jest.unstable_mockModule('razorpay', () => ({
  default: class MockRazorpay {
    constructor() {
      this.orders = {
        create: async (opts) => ({
          id: `order_mock_${Date.now()}`,
          amount: opts.amount,
          currency: opts.currency,
          receipt: opts.receipt,
        }),
      };
      this.payments = {
        fetch: async (id) => ({
          id, status: 'captured', method: 'card', amount: 100000, currency: 'INR',
        }),
      };
    }
  },
}));

// Import app + models AFTER the mock + env are in place.
const { app } = await import('../app.js');
const request = (await import('supertest')).default;
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = '/api/v1/razorpay';

const TEST_USER = {
  name: 'Test User',
  email: 'payment-test@example.com',
  password: 'SecurePass123!',
};

let authToken;
let userId;
let testOrder;

async function registerUser() {
  const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);
  // accessToken is delivered as an httpOnly cookie (not the body). Its value is the JWT,
  // so we lift it out and present it as a Bearer token — which also exempts requests
  // from CSRF (browsers never send Bearer cross-site).
  userId = res.body.user.id;
  const cookies = res.headers['set-cookie'] || [];
  const accessCookie = cookies.find((c) => c.startsWith('accessToken='));
  authToken = accessCookie ? accessCookie.split(';')[0].split('=')[1] : undefined;
}

async function createTestOrder(overrides = {}) {
  return Order.create({
    user: userId,
    orderNumber: `ORD-${Date.now()}`,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Test Product', quantity: 1, price: 1000 }],
    subtotal: 1000,
    totalAmount: 1000,
    shippingAddress: {
      fullName: 'Test User', addressLine1: '123 Test St', city: 'Test City',
      state: 'Test State', postalCode: '123456', phone: '9876543210',
    },
    paymentMethod: 'razorpay',
    status: 'awaiting_payment',
    ...overrides,
  });
}

function validSignature(orderId, paymentId) {
  return crypto.createHmac('sha256', RAZORPAY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

// Authenticated requests carry a Bearer token, which also exempts them from CSRF
// (browsers never send Bearer cross-site) — see csrfMiddleware.
function authed(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${authToken}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Payment — create-order', () => {
  beforeEach(registerUser);

  it('creates a Razorpay order using the DB order amount, not the client amount', async () => {
    testOrder = await createTestOrder();

    const res = await authed('post', `${BASE}/create-order`).send({
      orderId: testOrder._id.toString(),
      amount: 999999, // hostile client amount — must be ignored
      currency: 'INR',
      receipt: testOrder.orderNumber,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orderId).toBeDefined();
    expect(res.body.data.amount).toBe(100000); // ₹1000 from DB → paise, NOT 999999
  });

  it('rejects create-order for a non-existent order', async () => {
    const res = await authed('post', `${BASE}/create-order`).send({
      orderId: new mongoose.Types.ObjectId().toString(),
      currency: 'INR',
      receipt: 'receipt_123',
    });
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('rejects create-order without auth or session', async () => {
    const res = await request(app).post(`${BASE}/create-order`).send({
      orderId: new mongoose.Types.ObjectId().toString(),
      currency: 'INR',
      receipt: 'receipt_123',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('Payment — verify-payment signature (FRAUD PREVENTION)', () => {
  beforeEach(async () => {
    await registerUser();
    testOrder = await createTestOrder();
  });

  it('rejects an invalid signature', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;
    const res = await authed('post', `${BASE}/verify-payment`).send({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: 'invalid_signature_123456789',
      orderId: testOrder._id.toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/verification failed|invalid signature/i);
  });

  it('rejects a tampered payment id (signature computed for a different id)', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const sig = validSignature(razorpayOrderId, `pay_${Date.now()}`);
    const res = await authed('post', `${BASE}/verify-payment`).send({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: `pay_TAMPERED_${Date.now()}`,
      razorpay_signature: sig,
      orderId: testOrder._id.toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a missing signature (validation)', async () => {
    const res = await authed('post', `${BASE}/verify-payment`).send({
      razorpay_order_id: `order_${Date.now()}`,
      razorpay_payment_id: `pay_${Date.now()}`,
      orderId: testOrder._id.toString(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a valid signature against a non-existent order', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;
    const res = await authed('post', `${BASE}/verify-payment`).send({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: validSignature(razorpayOrderId, razorpayPaymentId),
      orderId: new mongoose.Types.ObjectId().toString(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Payment — verify-payment defers to the webhook (does NOT write)', () => {
  beforeEach(async () => {
    await registerUser();
    testOrder = await createTestOrder();
  });

  it('accepts a valid signature but creates NO payment and leaves the order awaiting_payment', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;

    const res = await authed('post', `${BASE}/verify-payment`).send({
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: validSignature(razorpayOrderId, razorpayPaymentId),
      orderId: testOrder._id.toString(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/awaiting webhook|signature verified/i);

    // Contract: the client callback is NOT a DB writer — the webhook is the sole
    // authority. Real payment confirmation + idempotency is covered in
    // razorpayWebhookRace.test.js (replica set).
    expect(await Payment.countDocuments({})).toBe(0);
    const fresh = await Order.findById(testOrder._id).lean();
    expect(fresh.status).toBe('awaiting_payment');
    expect(fresh.paymentStatus).not.toBe('paid');
  });
});

describe('Payment — webhook signature gate', () => {
  it('rejects a webhook with no signature header', async () => {
    const res = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .send({ event: 'payment.captured' });
    expect([400, 403]).toContain(res.statusCode);
  });

  it('rejects a webhook with an invalid signature', async () => {
    const res = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'not_a_valid_signature')
      .send({ event: 'payment.captured', payload: {} });
    expect([400, 403]).toContain(res.statusCode);
  });
});
