/**
 * Phase 1 of the full customer order updates: the four emails customers did not get.
 *   out_for_delivery / delivery_failed — a courier step on one parcel (team panel)
 *   payment_failed                     — Razorpay payment.failed, after a delay
 *   refund_initiated                   — a Razorpay refund was created
 *
 * What must hold:
 *   - each email goes out ONCE per real event: a BullMQ retry of the same job (same
 *     key) sends nothing; a genuinely new occurrence (second attempt, second refund)
 *     sends again
 *   - a delayed / retried email that is no longer true is not sent (paid since,
 *     parcel delivered since)
 *   - the stamp is written atomically ($addToSet), never by saving the whole array
 *   - the wording carries what the customer needs: tracking, note, pay link, amount
 *   - no queue configured = silent no-op, never a crash
 */

import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockSave = jest.fn();
const mockAddNotified = jest.fn();
const mockSendStatus = jest.fn();
const added = [];

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: { findById: mockFindById, save: mockSave, addNotifiedStatus: mockAddNotified },
}));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendOrderStatusUpdate: mockSendStatus },
}));
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getNotificationsQueue: () => ({
    add: (name, data, opts) => { added.push({ name, data, opts }); return Promise.resolve({}); },
  }),
}));

const svc = await import('../../../services/orderStatusEmailService.js');
const { orderStatusEmail } = await import('../../../utils/emailTemplates.js');
const { emailOrderStatusUpdate, notificationKey, stillRelevant } = svc;

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

const SHIP = 'ship1';
const parcel = (over = {}) => ({
  _id: SHIP, sequence: 1, status: 'shipped', lines: [],
  trackingNumber: 'DL555', carrier: { name: 'Delhivery', trackingUrl: 'https://courier.example/DL555' },
  ...over,
});
const makeOrder = (over = {}) => ({
  _id: 'aaaaaaaaaaaaaaaa1f3c9a2e',
  user: { _id: 'u1', name: 'Ravi', email: 'ravi@example.com' },
  shippingAddress: { fullName: 'Ravi' },
  status: 'shipped', paymentStatus: 'paid',
  items: [], shipments: [parcel()], notifiedStatuses: [],
  ...over,
});

beforeEach(() => {
  added.length = 0;
  mockSendStatus.mockResolvedValue({ success: true });
  mockAddNotified.mockResolvedValue(true);
  mockSave.mockResolvedValue(undefined);
});

describe('notificationKey', () => {
  it('keeps every existing key exactly as it was', () => {
    expect(notificationKey('shipped')).toBe('shipped');
    expect(notificationKey('shipped', SHIP)).toBe('shipped:ship1');
    expect(notificationKey('refunded', null, null)).toBe('refunded');
  });
  it('adds the occurrence for events that can happen more than once', () => {
    expect(notificationKey('out_for_delivery', SHIP, 3)).toBe('out_for_delivery:ship1:3');
    expect(notificationKey('refund_initiated', null, 'rfnd_1')).toBe('refund_initiated:rfnd_1');
  });
});

describe('stillRelevant', () => {
  it('payment_failed only while the order is unpaid', () => {
    expect(stillRelevant({ status: 'awaiting_payment', paymentStatus: 'failed' }, 'payment_failed')).toBe(true);
    expect(stillRelevant({ status: 'awaiting_payment', paymentStatus: 'paid' }, 'payment_failed')).toBe(false);
    expect(stillRelevant({ status: 'processing', paymentStatus: 'paid' }, 'payment_failed')).toBe(false);
    expect(stillRelevant({ status: 'cancelled', paymentStatus: 'failed' }, 'payment_failed')).toBe(false);
  });
  it('courier steps only while the parcel is in transit', () => {
    expect(stillRelevant({}, 'out_for_delivery', { status: 'shipped' })).toBe(true);
    expect(stillRelevant({}, 'delivery_failed', { status: 'delivered' })).toBe(false);
    expect(stillRelevant({}, 'out_for_delivery', { status: 'lost' })).toBe(false);
  });
  it('every other status is unaffected', () => {
    expect(stillRelevant({ status: 'cancelled' }, 'refund_initiated')).toBe(true);
    expect(stillRelevant({ status: 'delivered' }, 'shipped')).toBe(true);
  });
});

describe('emailOrderStatusUpdate — new events', () => {
  it('out for delivery: sends once and stamps atomically', async () => {
    mockFindById.mockResolvedValue(makeOrder());
    const r = await emailOrderStatusUpdate('o1', 'out_for_delivery', { shipmentId: SHIP, occurrence: 3 });
    expect(r).toEqual({ status: 'sent' });
    expect(mockSendStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'out_for_delivery', to: 'ravi@example.com' }));
    expect(mockAddNotified).toHaveBeenCalledWith('aaaaaaaaaaaaaaaa1f3c9a2e', 'out_for_delivery:ship1:3');
    // Not a shipped email: nothing else on the order needs saving.
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('same step twice (a BullMQ retry) → one email', async () => {
    mockFindById.mockResolvedValue(makeOrder({ notifiedStatuses: ['out_for_delivery:ship1:3'] }));
    expect(await emailOrderStatusUpdate('o1', 'out_for_delivery', { shipmentId: SHIP, occurrence: 3 })).toEqual({ status: 'skipped' });
    expect(mockSendStatus).not.toHaveBeenCalled();
  });

  it('a second attempt (new step number) emails again', async () => {
    mockFindById.mockResolvedValue(makeOrder({ notifiedStatuses: ['out_for_delivery:ship1:1', 'delivery_failed:ship1:2'] }));
    expect(await emailOrderStatusUpdate('o1', 'out_for_delivery', { shipmentId: SHIP, occurrence: 3 })).toEqual({ status: 'sent' });
  });

  it('a step for a parcel delivered since is not sent', async () => {
    mockFindById.mockResolvedValue(makeOrder({ shipments: [parcel({ status: 'delivered' })] }));
    expect(await emailOrderStatusUpdate('o1', 'delivery_failed', { shipmentId: SHIP, occurrence: 2 })).toEqual({ status: 'stale' });
    expect(mockSendStatus).not.toHaveBeenCalled();
    expect(mockAddNotified).not.toHaveBeenCalled();
  });

  it('payment failed: not sent when the customer paid in the meantime', async () => {
    mockFindById.mockResolvedValue(makeOrder({ status: 'processing', paymentStatus: 'paid' }));
    expect(await emailOrderStatusUpdate('o1', 'payment_failed')).toEqual({ status: 'stale' });
    expect(mockSendStatus).not.toHaveBeenCalled();
  });

  it('payment failed: sent once while still unpaid', async () => {
    mockFindById.mockResolvedValue(makeOrder({ status: 'awaiting_payment', paymentStatus: 'failed', shipments: [] }));
    expect(await emailOrderStatusUpdate('o1', 'payment_failed')).toEqual({ status: 'sent' });
    expect(mockAddNotified).toHaveBeenCalledWith(expect.anything(), 'payment_failed');

    mockFindById.mockResolvedValue(makeOrder({ status: 'awaiting_payment', paymentStatus: 'failed', notifiedStatuses: ['payment_failed'] }));
    expect(await emailOrderStatusUpdate('o1', 'payment_failed')).toEqual({ status: 'skipped' });
    expect(mockSendStatus).toHaveBeenCalledTimes(1);
  });

  it('refund started: one per refund id, and passes the amount through', async () => {
    mockFindById.mockResolvedValue(makeOrder({ status: 'cancelled', notifiedStatuses: ['refund_initiated:rfnd_A'] }));
    expect(await emailOrderStatusUpdate('o1', 'refund_initiated', { occurrence: 'rfnd_A', refund: { amount: 4250 } })).toEqual({ status: 'skipped' });
    expect(await emailOrderStatusUpdate('o1', 'refund_initiated', { occurrence: 'rfnd_B', refund: { amount: 1000 } })).toEqual({ status: 'sent' });
    expect(mockSendStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'refund_initiated', refund: { amount: 1000 } }));
  });

  it('a provider failure stamps nothing and throws, so BullMQ retries', async () => {
    mockFindById.mockResolvedValue(makeOrder());
    mockSendStatus.mockResolvedValue({ success: false, error: 'zeptomail down' });
    await expect(emailOrderStatusUpdate('o1', 'out_for_delivery', { shipmentId: SHIP, occurrence: 1 })).rejects.toThrow(/zeptomail down/);
    expect(mockAddNotified).not.toHaveBeenCalled();
  });
});

describe('enqueue helpers', () => {
  beforeEach(() => { process.env.REDIS_URL = 'redis://localhost:6379'; });

  it('a courier step: deterministic job id per parcel step, note carried', () => {
    svc.enqueueParcelStepEmail('o1', SHIP, 'delivery_failed', 2, 'Customer not at home');
    expect(added).toEqual([{
      name: 'send-shipment-email',
      data: { orderId: 'o1', shipmentId: SHIP, kind: 'delivery_failed', occurrence: 2, note: 'Customer not at home' },
      opts: { jobId: 'parcel-step|ship1|2' },
    }]);
  });

  it('picked up / in transit do not email', () => {
    svc.enqueueParcelStepEmail('o1', SHIP, 'picked_up', 1);
    svc.enqueueParcelStepEmail('o1', SHIP, 'in_transit', 2);
    expect(added).toHaveLength(0);
  });

  it('payment failed: one job id per order, delayed 30 min by default', () => {
    svc.enqueuePaymentFailedEmail('o1');
    svc.enqueuePaymentFailedEmail('o1');
    expect(added.map((j) => j.opts.jobId)).toEqual(['payment-failed|o1', 'payment-failed|o1']);
    expect(added[0].opts.delay).toBe(30 * 60 * 1000);
    expect(added[0].data).toEqual({ orderId: 'o1', status: 'payment_failed' });
  });

  it('payment failed delay is configurable, and a bad value falls back to 30 min', () => {
    process.env.PAYMENT_FAILED_EMAIL_DELAY_MINUTES = '5';
    expect(svc.paymentFailedEmailDelayMs()).toBe(5 * 60 * 1000);
    process.env.PAYMENT_FAILED_EMAIL_DELAY_MINUTES = 'soon';
    expect(svc.paymentFailedEmailDelayMs()).toBe(30 * 60 * 1000);
  });

  it('refund started: job id per refund', () => {
    svc.enqueueRefundStartedEmail('o1', 'rfnd_A', 4250);
    expect(added[0]).toEqual({
      name: 'send-order-status-email',
      data: { orderId: 'o1', status: 'refund_initiated', refundId: 'rfnd_A', amount: 4250 },
      opts: { jobId: 'refund-started|rfnd_A' },
    });
  });

  it('no queue Redis configured → silent no-op', () => {
    delete process.env.REDIS_URL;
    delete process.env.QUEUE_REDIS_URL;
    expect(svc.enqueuePaymentFailedEmail('o1')).toBeNull();
    expect(svc.enqueueRefundStartedEmail('o1', 'r', 1)).toBeNull();
    expect(svc.enqueueParcelStepEmail('o1', SHIP, 'out_for_delivery', 1)).toBeNull();
    expect(added).toHaveLength(0);
  });
});

describe('orderStatusEmail — wording', () => {
  beforeEach(() => { process.env.FRONTEND_URL = 'https://shop.example'; });

  it('out for delivery carries the tracking details', () => {
    const order = makeOrder();
    const { subject, text, html } = orderStatusEmail({ order, status: 'out_for_delivery', shipment: order.shipments[0] });
    expect(subject).toBe('Out for delivery today — AB-1F3C9A2E');
    expect(text).toContain('out for delivery today');
    expect(text).toContain('Tracking number: DL555');
    expect(text).toContain('Carrier: Delhivery');
    expect(html).toContain('https://courier.example/DL555');
    // The unboxing reminder belongs to the shipped email only.
    expect(text).not.toContain('unboxing');
  });

  it('missed delivery shows the step note, HTML-escaped', () => {
    const order = makeOrder();
    const { text, html } = orderStatusEmail({ order, status: 'delivery_failed', shipment: order.shipments[0], note: 'Gate <locked>' });
    expect(text).toContain('Courier note: Gate <locked>');
    expect(html).toContain('Courier note: Gate &lt;locked&gt;');
    expect(html).not.toContain('<locked>');
  });

  it('a step on one parcel of several names the parcel and keeps its own copy', () => {
    const order = makeOrder({ shipments: [parcel(), parcel({ _id: 'ship2', sequence: 2 })] });
    const { subject, text } = orderStatusEmail({ order, status: 'out_for_delivery', shipment: order.shipments[1] });
    expect(subject).toBe('Out for delivery today — AB-1F3C9A2E');
    expect(text).toContain('This is about parcel 2 of 2 of your order.');
    expect(text).not.toContain('Still to come');
  });

  it('payment failed: a signed-in customer gets a link to pay from their order page', () => {
    const { subject, text, html } = orderStatusEmail({ order: makeOrder({ status: 'awaiting_payment' }), status: 'payment_failed' });
    expect(subject).toBe("Your payment didn't go through — AB-1F3C9A2E");
    expect(text).toContain('Complete your payment: https://shop.example/orders/aaaaaaaaaaaaaaaa1f3c9a2e');
    expect(html).toContain('href="https://shop.example/orders/aaaaaaaaaaaaaaaa1f3c9a2e"');
  });

  it('payment failed: a guest is sent to the shop to order again', () => {
    const { text } = orderStatusEmail({ order: makeOrder({ user: null }), status: 'payment_failed' });
    expect(text).toContain('Place your order again: https://shop.example');
    expect(text).not.toContain('/orders/');
  });

  it('refund started states the amount in rupees, and falls back without one', () => {
    const withAmount = orderStatusEmail({ order: makeOrder(), status: 'refund_initiated', refund: { amount: 4250 } });
    expect(withAmount.subject).toBe('Refund started — AB-1F3C9A2E');
    expect(withAmount.text).toContain("We've started a refund of ₹4,250.00");
    const without = orderStatusEmail({ order: makeOrder(), status: 'refund_initiated' });
    expect(without.text).toContain("We've started your refund to your original payment method");
  });

  it('the existing shipped email for a partial parcel is unchanged', () => {
    const order = makeOrder({ shipments: [parcel(), parcel({ _id: 'ship2', sequence: 2 })] });
    const { subject } = orderStatusEmail({ order, status: 'shipped', shipment: order.shipments[1] });
    expect(subject).toBe('Parcel 2 of 2 is on its way — AB-1F3C9A2E');
  });
});
