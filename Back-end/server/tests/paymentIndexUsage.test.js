/**
 * Payment index-usage regression test (MONEY PATH).
 *
 * `gatewayPaymentId_1` is `unique` + partial on `$type: "string"`. Two properties
 * must hold simultaneously and they pull in opposite directions:
 *
 *   1. UNIQUENESS — the serialization point that makes webhook processing
 *      idempotent under Razorpay's at-least-once delivery. The partial filter is
 *      what lets legacy null gatewayPaymentId docs coexist without colliding.
 *   2. USABILITY — the planner will not infer that an equality predicate is
 *      inside a `$type` filter, so a bare `findOne({ gatewayPaymentId })` throws
 *      the index away and COLLSCANs.
 *
 * `gatewayPaymentIdFilter()` restores (2) without weakening (1). This suite pins
 * both, because a future "simplification" that drops either the partial filter or
 * the `$type` restatement breaks something that does not fail loudly.
 */

import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import Payment from '../models/Payment.js';
import paymentRepository, { gatewayPaymentIdFilter } from '../repositories/paymentRepository.js';

const GATEWAY_ID = 'pay_TestCapture123';

function chosenIndex(explain) {
  const plan = JSON.stringify(explain.queryPlanner.winningPlan);
  if (plan.includes('COLLSCAN')) return 'COLLSCAN';
  return (plan.match(/"indexName":"([^"]+)"/) || [])[1] || 'UNKNOWN';
}

const basePayment = (overrides = {}) => ({
  order: new mongoose.Types.ObjectId(),
  user: new mongoose.Types.ObjectId(),
  amount: 1000,
  currency: 'INR',
  paymentMethod: 'upi',
  paymentGateway: 'razorpay',
  status: 'completed',
  ...overrides,
});

beforeAll(async () => {
  await dbHandler.connect();
  await Payment.syncIndexes();
});

afterAll(async () => {
  await dbHandler.closeDatabase();
});

beforeEach(async () => {
  await Payment.create(basePayment({ gatewayPaymentId: GATEWAY_ID }));
});

describe('gatewayPaymentId lookups use the unique partial index', () => {
  it('gatewayPaymentIdFilter drives an IXSCAN, not a COLLSCAN', async () => {
    const explain = await Payment.findOne(gatewayPaymentIdFilter(GATEWAY_ID)).explain('executionStats');
    expect(chosenIndex(explain)).toBe('gatewayPaymentId_1');
    expect(explain.executionStats.totalDocsExamined).toBeLessThanOrEqual(1);
  });

  it('the bare {gatewayPaymentId} form COLLSCANs — why the helper exists', async () => {
    const explain = await Payment.findOne({ gatewayPaymentId: GATEWAY_ID }).explain('executionStats');
    expect(chosenIndex(explain)).toBe('COLLSCAN');
  });

  it('findByGatewayPaymentId returns the right row', async () => {
    const found = await paymentRepository.findByGatewayPaymentId(GATEWAY_ID);
    expect(found.gatewayPaymentId).toBe(GATEWAY_ID);
  });

  it('findByGatewayPaymentId returns null for an unknown id', async () => {
    expect(await paymentRepository.findByGatewayPaymentId('pay_nope')).toBeNull();
  });
});

describe('uniqueness — the idempotency guarantee — is unchanged', () => {
  it('rejects a SECOND payment with the same gatewayPaymentId', async () => {
    // This is the webhook-replay case: Razorpay delivers the same capture twice.
    await expect(
      Payment.create(basePayment({ gatewayPaymentId: GATEWAY_ID }))
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('still allows MANY payments with no gatewayPaymentId (legacy Woo orders)', async () => {
    // The whole point of the partial filter: nulls must not collide on null.
    await Payment.create(basePayment());
    await Payment.create(basePayment());
    expect(await Payment.countDocuments({ gatewayPaymentId: null })).toBe(2);
  });
});

describe('drift guard', () => {
  it('the partial filter is still present on the schema', async () => {
    const declared = Payment.schema.indexes()
      .find(([key]) => key.gatewayPaymentId === 1);
    expect(declared).toBeDefined();
    const [, opts] = declared;
    // Removing either of these silently breaks idempotency or performance.
    expect(opts.unique).toBe(true);
    expect(opts.partialFilterExpression).toEqual({ gatewayPaymentId: { $type: 'string' } });
  });
});
