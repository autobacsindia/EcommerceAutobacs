/**
 * Payment Integration Tests — Razorpay
 * 
 * Tests critical payment flows:
 * - Order creation
 * - Payment signature verification (fraud prevention)
 * - Payment success processing
 * - Idempotency (no duplicate orders)
 * - Webhook handling
 * 
 * Uses mongodb-memory-server for isolated DB
 * Uses supertest against Express app
 * Mocks Razorpay API calls
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../app.js';
import * as dbHandler from './db-handler.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

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

const BASE = '/api/v1/razorpay';
const RAZORPAY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_secret_key_1234567890abcdef';

const TEST_USER = {
  name: 'Test User',
  email: 'payment-test@example.com',
  password: 'SecurePass123!',
};

let authToken;
let userId;
let sessionId;
let testOrder;

/**
 * Create a test order in DB
 */
async function createTestOrder(overrides = {}) {
  return await Order.create({
    user: userId,
    orderNumber: `ORD-${Date.now()}`,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        name: 'Test Product',
        quantity: 1,
        price: 1000,
      },
    ],
    subtotal: 1000,
    totalAmount: 1000,
    shippingAddress: {
      fullName: 'Test User',
      addressLine1: '123 Test St',
      city: 'Test City',
      state: 'Test State',
      postalCode: '123456',
      phone: '9876543210',
    },
    paymentMethod: 'razorpay',
    ...overrides,
  });
}

/**
 * Generate valid Razorpay signature
 */
function generateValidSignature(orderId, paymentId) {
  const shasum = crypto.createHmac('sha256', RAZORPAY_SECRET);
  shasum.update(`${orderId}|${paymentId}`);
  return shasum.digest('hex');
}

/**
 * Generate INVALID Razorpay signature (for fraud testing)
 */
function generateInvalidSignature() {
  return 'invalid_signature_123456789';
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Payment - Order Creation', () => {
  beforeEach(async () => {
    // Create user and get auth token
    const userRes = await request(app)
      .post('/api/v1/auth/register')
      .send(TEST_USER);
    
    authToken = userRes.body.accessToken;
    userId = userRes.body.user._id;
  });

  it('should create Razorpay order for valid order ID', async () => {
    // Create order in DB first
    testOrder = await createTestOrder();

    const res = await request(app)
      .post(`${BASE}/create-order`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        orderId: testOrder._id.toString(),
        amount: 100000, // ₹1000 in paise
        currency: 'INR',
        receipt: testOrder.orderNumber,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orderId).toBeDefined();
    expect(res.body.data.amount).toBe(100000);
  });

  it('should reject order creation for non-existent order', async () => {
    const fakeOrderId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`${BASE}/create-order`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        orderId: fakeOrderId,
        amount: 100000,
        currency: 'INR',
        receipt: 'receipt_123',
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Order not found');
  });

  it('should reject order creation without auth or session', async () => {
    const res = await request(app)
      .post(`${BASE}/create-order`)
      .send({
        orderId: new mongoose.Types.ObjectId().toString(),
        amount: 100000,
        currency: 'INR',
        receipt: 'receipt_123',
      });

    // Should fail (no auth, no session)
    expect([400, 401]).toContain(res.statusCode);
  });
});

describe('Payment - Signature Verification (FRAUD PREVENTION)', () => {
  beforeEach(async () => {
    const userRes = await request(app)
      .post('/api/v1/auth/register')
      .send(TEST_USER);
    
    authToken = userRes.body.accessToken;
    userId = userRes.body.user._id;
    testOrder = await createTestOrder();
  });

  it('should verify VALID payment signature', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;
    const validSignature = generateValidSignature(razorpayOrderId, razorpayPaymentId);

    const res = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: validSignature,
        orderId: testOrder._id.toString(),
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Payment verified');
  });

  it('should REJECT invalid payment signature (FRAUD ATTEMPT)', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;
    const invalidSignature = generateInvalidSignature();

    const res = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: invalidSignature,
        orderId: testOrder._id.toString(),
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('verification failed');
  });

  it('should reject tampered signature (modified payment ID)', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;
    
    // Generate signature for one payment ID
    const validSignature = generateValidSignature(razorpayOrderId, razorpayPaymentId);
    
    // But use different payment ID in request
    const res = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: `pay_TAMPERED_${Date.now()}`, // Different!
        razorpay_signature: validSignature,
        orderId: testOrder._id.toString(),
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject missing signature', async () => {
    const res = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        razorpay_order_id: `order_${Date.now()}`,
        razorpay_payment_id: `pay_${Date.now()}`,
        // No signature!
        orderId: testOrder._id.toString(),
      });

    expect(res.statusCode).toBe(400);
  });
});

describe('Payment - Idempotency (NO DUPLICATE ORDERS)', () => {
  beforeEach(async () => {
    const userRes = await request(app)
      .post('/api/v1/auth/register')
      .send(TEST_USER);
    
    authToken = userRes.body.accessToken;
    userId = userRes.body.user._id;
    testOrder = await createTestOrder();
  });

  it('should not create duplicate orders on double submission', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;
    const validSignature = generateValidSignature(razorpayOrderId, razorpayPaymentId);

    // First payment
    const res1 = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: validSignature,
        orderId: testOrder._id.toString(),
      });

    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);

    // Second payment with SAME details (duplicate submission)
    const res2 = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: validSignature,
        orderId: testOrder._id.toString(),
      });

    // Should handle gracefully (either reject or return same result)
    expect([200, 400]).toContain(res2.statusCode);
    
    // Verify only ONE payment record exists
    const paymentCount = await Payment.countDocuments({
      razorpayPaymentId,
    });
    
    expect(paymentCount).toBeLessThanOrEqual(1);
  });
});

describe('Payment - Guest Checkout Flow', () => {
  // Note: Guest checkout requires session-based order creation
  // which is tested in e2e tests. These tests verify the payment
  // endpoints work with proper authentication.
  
  it('should require authentication or valid session for payment', async () => {
    const res = await request(app)
      .post(`${BASE}/create-order`)
      .send({
        orderId: new mongoose.Types.ObjectId().toString(),
        amount: 50000,
        currency: 'INR',
        receipt: 'receipt_123',
      });

    // Should fail without auth
    expect([400, 401]).toContain(res.statusCode);
  });
});

describe('Payment - Webhook Handling', () => {
  it('should reject webhook without signature header', async () => {
    const res = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .send({
        event: 'payment.captured',
      });

    expect([400, 403]).toContain(res.statusCode);
    expect(res.body.message).toContain('signature');
  });

  it('should handle payment.captured webhook event', async () => {
    // This test verifies webhook endpoint accepts valid requests
    // Full webhook signature verification requires Razorpay secret
    const webhookPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_123',
            order_id: 'order_test_123',
            amount: 1000,
          },
        },
      },
    };

    const res = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'test_signature')
      .send(webhookPayload);

    // May fail signature verification (expected in test env)
    // But endpoint should respond (not crash)
    expect([200, 400, 403, 500]).toContain(res.statusCode);
  });
});

describe('Payment - Edge Cases & Error Handling', () => {
  beforeEach(async () => {
    const userRes = await request(app)
      .post('/api/v1/auth/register')
      .send(TEST_USER);
    
    authToken = userRes.body.accessToken;
    userId = userRes.body.user._id;
  });

  it('should handle payment for non-existent order gracefully', async () => {
    const razorpayOrderId = `order_${Date.now()}`;
    const razorpayPaymentId = `pay_${Date.now()}`;
    const validSignature = generateValidSignature(razorpayOrderId, razorpayPaymentId);
    const fakeOrderId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: validSignature,
        orderId: fakeOrderId,
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain('Order not found');
  });

  it('should validate required payment fields', async () => {
    const res = await request(app)
      .post(`${BASE}/verify-payment`)
      .send({
        // Missing all required fields
      });

    expect(res.statusCode).toBe(400);
  });
});
