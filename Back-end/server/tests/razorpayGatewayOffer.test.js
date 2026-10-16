/**
 * Razorpay offers applied at the gateway — REAL database, REAL transactions.
 *
 * The case that stranded a real order: the customer paid with an Amex card,
 * Razorpay applied "Flat ₹100 instant discount", and captured ₹2,076 against our
 * ₹2,176 order. The amount guard read that as tampering and every confirmation
 * path (webhook, reconciliation) refused it, so a paid order sat in
 * awaiting_payment.
 *
 * The rule now: a SHORT payment is accepted only when Razorpay's own API (never the
 * webhook body or the browser) confirms the offer — and everything else still
 * throws "Amount mismatch". Razorpay's REST API is stubbed with global fetch.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
delete process.env.REDIS_URL; // post-commit queue enqueue becomes a no-op

import User from '../models/User.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import { remainingRefundable } from '../services/refundMathService.js';

jest.setTimeout(30000);

let razorpayService;
const ADDRESS = {
  fullName: 'Offer Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};
const OFFER_ID = 'offer_AMEX100';
const AMEX_OFFER = {
  id: OFFER_ID,
  name: 'Amex flat 100',
  display_text: 'Flat ₹100 instant discount on American Express Card',
  rules: { items: [{ benefits: { items: [{ type: 'instant_discount', value: '10000', max_benefit_value: '0' }] } }] },
};

async function seedOrder(total = 2176) {
  const user = await User.create({ name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x' });
  return Order.create({
    user: user._id,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Ford Endeavour Keycase', quantity: 1, price: total }],
    subtotal: total,
    totalAmount: total,
    shippingAddress: ADDRESS,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    razorpayOrderId: `order_${new mongoose.Types.ObjectId()}`,
  });
}

/** The payment.captured entity Razorpay sends (amount in paise). */
const captured = (order, paidPaise, over = {}) => ({
  id: `pay_${new mongoose.Types.ObjectId()}`,
  order_id: order.razorpayOrderId,
  amount: paidPaise,
  currency: 'INR',
  method: 'card',
  status: 'captured',
  notes: { orderId: order._id.toString() },
  ...over,
});

/**
 * Stub Razorpay's REST API. `rzp` describes what Razorpay would answer:
 *   order:  the Razorpay order entity      payment: the expanded payment
 *   offers: the offer list (or 'down')     fail:    a path prefix that errors
 */
function stubRazorpay(rzp) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const path = String(url).replace('https://api.razorpay.com/v1', '');
    const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
    if (rzp.fail && path.startsWith(rzp.fail)) return json({ error: 'down' }, false);
    if (path.startsWith('/orders/')) return json(rzp.order);
    if (path.startsWith('/payments/')) return json(rzp.payment);
    if (path.startsWith('/offers')) return rzp.offers === 'down' ? json({}, false) : json({ items: rzp.offers ?? [AMEX_OFFER], has_more: false });
    throw new Error(`unexpected Razorpay call ${path}`);
  });
}

/** What Razorpay reports for a genuine ₹100 offer on our order. */
const genuine = (order, entity, over = {}) => ({
  order: { id: order.razorpayOrderId, amount: Math.round(order.totalAmount * 100), amount_paid: entity.amount, status: 'paid', ...over.order },
  payment: { id: entity.id, amount: entity.amount, status: 'captured', offers: { items: [{ id: OFFER_ID }] }, ...over.payment },
  ...over.rest,
});

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  await Payment.syncIndexes();
  razorpayService = (await import('../services/razorpayService.js')).default;
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([Order.deleteMany({}), Payment.deleteMany({}), User.deleteMany({})]);
});

describe('a payment short by a Razorpay offer', () => {
  it('confirms the order as paid, records what was captured and snapshots the offer (the real ₹2,076-of-₹2,176 case)', async () => {
    const order = await seedOrder(2176);
    const entity = captured(order, 207600);
    stubRazorpay(genuine(order, entity));

    await razorpayService.handlePaymentCaptured({ payment: { entity } });

    const saved = await Order.findById(order._id).lean();
    expect(saved.paymentStatus).toBe('paid');
    expect(saved.status).toBe('processing');
    expect(saved.totalAmount).toBe(2176); // our price is untouched
    expect(saved.gatewayOffer).toEqual({
      offerIds: [OFFER_ID],
      name: 'Flat ₹100 instant discount on American Express Card',
      discount: 100,
      amountPaid: 2076,
      paymentId: entity.id,
    });
    const payment = await Payment.findOne({ gatewayPaymentId: entity.id }).lean();
    expect(payment).toMatchObject({ amount: 2076, status: 'completed' });
  });

  it('is idempotent: the same webhook twice → one payment, one offer snapshot', async () => {
    const order = await seedOrder(2176);
    const entity = captured(order, 207600);
    stubRazorpay(genuine(order, entity));
    await razorpayService.handlePaymentCaptured({ payment: { entity } });
    await razorpayService.handlePaymentCaptured({ payment: { entity } });
    expect(await Payment.countDocuments({ gatewayPaymentId: entity.id })).toBe(1);
  });

  it('the hourly reconciliation recovers a stranded order the same way', async () => {
    const order = await seedOrder(2176);
    const entity = captured(order, 207600);
    stubRazorpay(genuine(order, entity));
    jest.spyOn(razorpayService, 'fetchOrderPayments').mockResolvedValue([entity]);

    const result = await razorpayService.reconcileOrder(order);
    expect(result).toEqual({ recovered: true, paymentId: entity.id });
    expect((await Order.findById(order._id).lean()).gatewayOffer.discount).toBe(100);
  });

  it('still accepts when the offer list is unavailable — just without a name', async () => {
    const order = await seedOrder(2176);
    const entity = captured(order, 207600);
    stubRazorpay({ ...genuine(order, entity), offers: 'down' });
    await razorpayService.handlePaymentCaptured({ payment: { entity } });
    expect((await Order.findById(order._id).lean()).gatewayOffer).toMatchObject({ name: '', discount: 100 });
  });

  it('refunds can only draw what was captured, not the order total', async () => {
    const order = await seedOrder(2176);
    const entity = captured(order, 207600);
    stubRazorpay(genuine(order, entity));
    await razorpayService.handlePaymentCaptured({ payment: { entity } });
    const saved = await Order.findById(order._id).lean();
    expect(remainingRefundable(saved, [])).toEqual({ capturedRupees: 2076, alreadyRefundedRupees: 0, remainingRupees: 2076 });
  });
});

describe('everything else is still an amount mismatch', () => {
  const rejects = async (order, entity, rzp) => {
    stubRazorpay(rzp);
    await expect(razorpayService.handlePaymentCaptured({ payment: { entity } })).rejects.toThrow(/Amount mismatch/);
    const saved = await Order.findById(order._id).lean();
    expect(saved.paymentStatus).toBe('pending');
    expect(saved.gatewayOffer).toBeUndefined();
    expect(await Payment.countDocuments({})).toBe(0);
  };

  it('no offer on the payment', async () => {
    const order = await seedOrder(); const entity = captured(order, 207600);
    await rejects(order, entity, genuine(order, entity, { payment: { offers: { items: [] } } }));
  });

  it('Razorpay does not call its order paid', async () => {
    const order = await seedOrder(); const entity = captured(order, 207600);
    await rejects(order, entity, genuine(order, entity, { order: { status: 'attempted' } }));
  });

  it('the Razorpay order is not for our full total', async () => {
    const order = await seedOrder(); const entity = captured(order, 207600);
    await rejects(order, entity, genuine(order, entity, { order: { amount: 207600 } }));
  });

  it('the payment belongs to a different Razorpay order', async () => {
    const order = await seedOrder(); const entity = captured(order, 207600, { order_id: 'order_someoneElse' });
    await rejects(order, entity, genuine(order, entity));
  });

  it('the webhook amount disagrees with what Razorpay recorded', async () => {
    const order = await seedOrder(); const entity = captured(order, 207600);
    await rejects(order, entity, genuine(order, entity, { payment: { amount: 217600 } }));
  });

  it('the shortfall is bigger than the offer gives (₹1,000 short on a flat ₹100 offer)', async () => {
    const order = await seedOrder(); const entity = captured(order, 117600);
    await rejects(order, entity, genuine(order, entity));
  });

  it('paying MORE than the total', async () => {
    const order = await seedOrder(); const entity = captured(order, 227600);
    await rejects(order, entity, genuine(order, entity));
  });
});

it('a Razorpay outage while checking is retried later, not rejected for good', async () => {
  const order = await seedOrder();
  const entity = captured(order, 207600);
  stubRazorpay({ ...genuine(order, entity), fail: '/orders/' });
  await expect(razorpayService.handlePaymentCaptured({ payment: { entity } })).rejects.toThrow(/Razorpay GET/);
  expect((await Order.findById(order._id).lean()).paymentStatus).toBe('pending');
});

it('an exact payment never calls Razorpay at all', async () => {
  const order = await seedOrder(2176);
  const entity = captured(order, 217600);
  const spy = stubRazorpay({});
  await razorpayService.handlePaymentCaptured({ payment: { entity } });
  expect(spy).not.toHaveBeenCalled();
  const saved = await Order.findById(order._id).lean();
  expect(saved.paymentStatus).toBe('paid');
  expect(saved.gatewayOffer).toBeUndefined();
  expect((await Payment.findOne({ gatewayPaymentId: entity.id }).lean()).amount).toBe(2176);
});
