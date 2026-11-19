/**
 * Where Razorpay events enqueue the new customer emails (razorpayService):
 *   refundPayment          → "refund started" (not for returns, extra charges, or an
 *                            instant refund already processed)
 *   handlePaymentFailure   → "payment didn't go through" (storefront orders only,
 *                            only while unpaid)
 * The sends themselves and their idempotency are covered in customerUpdateEmails.test.js.
 */

import { jest } from '@jest/globals';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_secret_key_1234567890abcdef';

const refundCalls = [];
let nextRefund = { id: 'rfnd_1', status: 'pending', amount: 425000 };
// A plain class, not jest.fn: jest.config resetMocks would wipe an implementation.
jest.unstable_mockModule('razorpay', () => ({
  default: class MockRazorpay {
    constructor() {
      this.payments = {
        refund: async (id, opts) => {
          refundCalls.push({ id, opts });
          if (nextRefund instanceof Error) throw nextRefund;
          return nextRefund;
        },
      };
    }
  },
}));

const paymentFailed = [];
const refundStarted = [];
jest.unstable_mockModule('../../../services/orderStatusEmailService.js', () => {
  const enqueuePaymentFailedEmail = (orderId) => { paymentFailed.push(String(orderId)); };
  const enqueueRefundStartedEmail = (orderId, refundId, amount) => { refundStarted.push({ orderId, refundId, amount }); };
  const enqueueParcelStepEmail = () => {};
  const enqueueRefundProcessedEmail = () => {};
  const emailOrderStatusUpdate = async () => ({ status: 'sent' });
  return {
    enqueuePaymentFailedEmail, enqueueRefundStartedEmail, enqueueParcelStepEmail, emailOrderStatusUpdate,
    enqueueRefundProcessedEmail, paymentFailedEmailDelayMs: () => 0,
    notificationKey: () => '', stillRelevant: () => true,
    default: { enqueuePaymentFailedEmail, enqueueRefundStartedEmail, enqueueParcelStepEmail, emailOrderStatusUpdate },
  };
});

let orderDoc = null;
const saved = [];
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: {
    findById: async () => orderDoc,
    save: async (o) => { saved.push(o); return o; },
  },
}));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({
  default: { findByGatewayPaymentId: async () => null, save: async (p) => p },
}));
jest.unstable_mockModule('../../../services/leadSyncService.js', () => ({
  default: { safeSync: async () => {}, upsertFromOrder: async () => {} },
}));

const { default: razorpayService } = await import('../../../services/razorpayService.js');

beforeEach(() => {
  refundCalls.length = 0;
  paymentFailed.length = 0;
  refundStarted.length = 0;
  saved.length = 0;
  nextRefund = { id: 'rfnd_1', status: 'pending', amount: 425000 };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('refundPayment → refund started email', () => {
  it('a cancellation refund enqueues one email with the amount in rupees', async () => {
    await razorpayService.refundPayment('pay_1', 425000, { orderId: 'o1' });
    expect(refundStarted).toEqual([{ orderId: 'o1', refundId: 'rfnd_1', amount: 4250 }]);
  });

  it('a partial-cancellation refund enqueues too', async () => {
    nextRefund = { id: 'rfnd_2', status: 'pending', amount: 50000 };
    await razorpayService.refundPayment('pay_1', 50000, { orderId: 'o1', cancellationId: 'c1' });
    expect(refundStarted).toEqual([{ orderId: 'o1', refundId: 'rfnd_2', amount: 500 }]);
  });

  it('not for a return refund (its own email), an extra charge, or no order', async () => {
    await razorpayService.refundPayment('pay_1', 1000, { orderId: 'o1', returnId: 'r1' });
    await razorpayService.refundPayment('pay_1', 1000, { orderId: 'o1', extraChargeId: 'x1' });
    await razorpayService.refundPayment('pay_1', 1000, {});
    expect(refundCalls).toHaveLength(3);
    expect(refundStarted).toHaveLength(0);
  });

  it('not for an instant refund already processed (the refund-processed email follows)', async () => {
    nextRefund = { id: 'rfnd_3', status: 'processed', amount: 1000 };
    await razorpayService.refundPayment('pay_1', 1000, { orderId: 'o1' });
    expect(refundStarted).toHaveLength(0);
  });

  it('a refund Razorpay rejected enqueues nothing', async () => {
    nextRefund = new Error('BAD_REQUEST_ERROR: amount exceeds');
    await expect(razorpayService.refundPayment('pay_1', 1000, { orderId: 'o1' })).rejects.toThrow(/Failed to create Razorpay refund/);
    expect(refundStarted).toHaveLength(0);
  });
});

describe('handlePaymentFailure → payment failed email', () => {
  const failed = (orderId = 'o1') => ({ id: 'pay_x', notes: { orderId }, error_description: 'Card declined' });

  it('a storefront order awaiting payment enqueues the email', async () => {
    orderDoc = { _id: 'o1', source: 'web', status: 'awaiting_payment', paymentStatus: 'pending' };
    await razorpayService.handlePaymentFailure(failed());
    expect(orderDoc.paymentStatus).toBe('failed');
    expect(paymentFailed).toEqual(['o1']);
  });

  it('every failed attempt asks again — the job id and the stamp make it one email', async () => {
    orderDoc = { _id: 'o1', source: 'web', status: 'awaiting_payment', paymentStatus: 'failed' };
    await razorpayService.handlePaymentFailure(failed());
    await razorpayService.handlePaymentFailure(failed());
    expect(paymentFailed).toEqual(['o1', 'o1']);
  });

  it('a sales-panel order is left to the salesperson', async () => {
    orderDoc = { _id: 'o2', source: 'offline', status: 'awaiting_payment', paymentStatus: 'pending' };
    await razorpayService.handlePaymentFailure(failed('o2'));
    expect(paymentFailed).toHaveLength(0);
  });

  it('an order already paid is not told its payment failed', async () => {
    orderDoc = { _id: 'o3', source: 'web', status: 'processing', paymentStatus: 'paid' };
    await razorpayService.handlePaymentFailure(failed('o3'));
    expect(paymentFailed).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });
});
