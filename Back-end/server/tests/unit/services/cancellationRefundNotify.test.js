/**
 * Regression: a partial-cancellation refund got NO "refund processed" email when
 * Razorpay confirmed it (razorpayService.applyCancellationRefundWebhook enqueued
 * nothing). Since phase 1 those customers DID get "refund started", so the gap showed.
 *
 * Now every path where Razorpay says the refund is done enqueues one, keyed per refund
 * (`refunded:<refundId>` via the job's refundId), with the amount — including the
 * instant refund the controller already settled and a replayed webhook (the jobId and
 * the notifiedStatuses stamp make those one email). A failed refund sends nothing.
 * The WhatsApp twin rides beside it.
 */

import { jest } from '@jest/globals';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_secret_key_1234567890abcdef';

const added = [];
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getNotificationsQueue: () => ({ add: async (name, data, opts) => { added.push({ name, data, jobId: opts?.jobId }); } }),
  getOrderQueue: () => ({ add: async () => {} }),
  enqueueNotification: () => {},
}));

let order;
let settleResult;
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: {
    findById: async () => order,
    findOne: async () => order,
    settleCancellationRefund: async () => settleResult,
  },
}));
const sideEffects = [];
jest.unstable_mockModule('../../../services/cancellationRefundSideEffects.js', () => {
  const applyCancellationRefundSideEffectsOnce = async (...a) => { sideEffects.push(a); };
  return { applyCancellationRefundSideEffectsOnce, default: { applyCancellationRefundSideEffectsOnce } };
});

const { default: razorpayService } = await import('../../../services/razorpayService.js');

const ENV_KEYS = ['REDIS_URL', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'];
const savedEnv = {};
beforeAll(() => { for (const k of ENV_KEYS) savedEnv[k] = process.env[k]; });
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const CID = 'c1';
const entity = { id: 'rfnd_7', amount: 49950, notes: { orderId: 'o1', cancellationId: CID } };
const makeOrder = (refund) => ({ _id: 'o1', payment: 'p1', cancellations: [{ _id: CID, refund }] });
const emails = () => added.filter((j) => j.name === 'send-order-status-email');

beforeEach(() => {
  added.length = 0;
  sideEffects.length = 0;
  process.env.REDIS_URL = 'redis://localhost:6379';
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('applyCancellationRefundWebhook → "refund processed" email', () => {
  it('a normal refund.processed enqueues one email, keyed per refund, with the amount', async () => {
    order = makeOrder({ status: 'processing', razorpayRefundId: 'rfnd_7' });
    settleResult = { _id: 'o1' };

    await razorpayService.applyCancellationRefundWebhook('rfnd_7', CID, entity, 'completed');

    expect(sideEffects).toHaveLength(1);
    expect(emails()).toEqual([{
      name: 'send-order-status-email',
      data: { orderId: 'o1', status: 'refunded', refundId: 'rfnd_7', amount: 499.5 },
      jobId: 'refund-processed|rfnd_7',
    }]);
  });

  it('an instant refund the controller already settled still gets its email', async () => {
    order = makeOrder({ status: 'processing', razorpayRefundId: 'rfnd_7' });
    settleResult = null; // the controller won the race

    await razorpayService.applyCancellationRefundWebhook('rfnd_7', CID, entity, 'completed');

    expect(sideEffects).toHaveLength(0);
    expect(emails()).toHaveLength(1);
  });

  it('a replayed webhook enqueues with the SAME job id (BullMQ + the stamp make it one email)', async () => {
    order = makeOrder({ status: 'completed', razorpayRefundId: 'rfnd_7' });
    await razorpayService.applyCancellationRefundWebhook('rfnd_7', CID, entity, 'completed');
    await razorpayService.applyCancellationRefundWebhook('rfnd_7', CID, entity, 'completed');
    expect(new Set(emails().map((j) => j.jobId))).toEqual(new Set(['refund-processed|rfnd_7']));
  });

  it('a failed refund sends no "refund processed" email', async () => {
    order = makeOrder({ status: 'processing', razorpayRefundId: 'rfnd_7' });
    settleResult = { _id: 'o1' };
    await razorpayService.applyCancellationRefundWebhook('rfnd_7', CID, entity, 'failed');
    expect(emails()).toHaveLength(0);
  });

  it('someone else\'s refund id sends nothing', async () => {
    order = makeOrder({ status: 'processing', razorpayRefundId: 'rfnd_OTHER' });
    await razorpayService.applyCancellationRefundWebhook('rfnd_7', CID, entity, 'completed');
    expect(added).toHaveLength(0);
  });

  it('with WhatsApp switched on, the WhatsApp twin is queued beside the email', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = '555';
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    order = makeOrder({ status: 'processing', razorpayRefundId: 'rfnd_7' });
    settleResult = { _id: 'o1' };

    await razorpayService.applyCancellationRefundWebhook('rfnd_7', CID, entity, 'completed');

    const wa = added.filter((j) => j.name === 'send-order-whatsapp');
    expect(wa).toEqual([{
      name: 'send-order-whatsapp',
      data: { orderId: 'o1', status: 'refunded', occurrence: 'rfnd_7', amount: 499.5 },
      jobId: 'wa|o1|refunded|rfnd_7',
    }]);
    expect(emails()).toHaveLength(1);
  });
});
