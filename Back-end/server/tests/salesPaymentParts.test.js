/**
 * Paying a quotation-first order in PARTS — REAL database, REAL transactions,
 * real razorpayService (only Razorpay's HTTP lookups are stubbed).
 *
 * The money invariants:
 *   - each part is settled only for EXACTLY its own amount
 *   - the same webhook twice (or concurrently) → one Payment row, one part paid
 *   - the order turns paid exactly once — when the paid parts reach the total —
 *     and only then do the invoice / team alerts fire (once)
 *   - a missed webhook is recovered by the reconciliation sweep
 *   - one-click refunds are refused for an order paid in several payments
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
delete process.env.REDIS_URL;

import User from '../models/User.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import { isSplitPaid } from '../utils/splitPayment.js';

jest.setTimeout(30000);

let razorpayService;
let reconcileSalesLinks;
const ADDRESS = { fullName: 'Big Build', phone: '9820917286', addressLine1: '1 St', city: 'Mumbai', state: 'MH', postalCode: '400706', country: 'India' };
const HOUR = 3600 * 1000;

async function partsOrder(amounts, { total = amounts.reduce((s, a) => s + a, 0), partAgeMs = 0 } = {}) {
  const user = await User.create({ name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x' });
  const seller = await User.create({ name: 'S', email: `s${Date.now()}${Math.random()}@x.com`, passwordHash: 'x' });
  return Order.create({
    user: user._id,
    salesUser: seller._id,
    source: 'offline',
    items: [{ custom: true, name: 'Hilux build', quantity: 1, price: total }],
    subtotal: total,
    totalAmount: total,
    shippingAddress: ADDRESS,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    paymentParts: amounts.map((amount, i) => ({
      amount,
      linkId: `plink_${new mongoose.Types.ObjectId()}_${i}`,
      linkUrl: `https://rzp.io/i/x${i}`,
      expiresAt: new Date(Date.now() + 48 * HOUR),
      status: 'pending',
      createdAt: new Date(Date.now() - partAgeMs),
    })),
  });
}

const capture = (order, part, over = {}) => ({
  id: `pay_${new mongoose.Types.ObjectId()}`,
  amount: Math.round(part.amount * 100),
  currency: 'INR',
  method: 'upi',
  status: 'captured',
  notes: { orderId: String(order._id) },
  ...over,
});

const linkPaid = (order, part, payment) => ({
  payment_link: { entity: { id: part.linkId, notes: { orderId: String(order._id) } } },
  payment: { entity: payment },
});

let afterPaid;
beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
  await Payment.syncIndexes();
  razorpayService = (await import('../services/razorpayService.js')).default;
  ({ reconcileSalesLinks } = await import('../services/paymentReconciliationService.js'));
});
beforeEach(() => {
  afterPaid = jest.spyOn(razorpayService, '_afterOrderPaid').mockImplementation(() => {});
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([Order.deleteMany({}), Payment.deleteMany({}), User.deleteMany({})]);
});

describe('a payment part is paid (payment_link.paid)', () => {
  it('settles that part only; the order stays unpaid until the rest arrives', async () => {
    const order = await partsOrder([1000000, 1000000, 159448]);
    const [p1] = order.paymentParts;
    await razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, capture(order, p1)));

    const saved = await Order.findById(order._id).lean();
    expect(saved.paymentParts.map((p) => p.status)).toEqual(['paid', 'pending', 'pending']);
    expect(saved).toMatchObject({ paymentStatus: 'pending', status: 'awaiting_payment' });
    expect(await Payment.countDocuments({ order: order._id })).toBe(1);
    expect(afterPaid).not.toHaveBeenCalled();
  });

  it('the LAST part turns the order paid — once — in any order of arrival', async () => {
    const order = await partsOrder([600000, 400000]);
    const [p1, p2] = order.paymentParts;
    await razorpayService.handlePaymentLinkPaid(linkPaid(order, p2, capture(order, p2)));
    await razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, capture(order, p1)));

    const saved = await Order.findById(order._id).lean();
    expect(saved).toMatchObject({ paymentStatus: 'paid', status: 'processing' });
    expect(saved.paymentParts.every((p) => p.status === 'paid')).toBe(true);
    expect(await Payment.countDocuments({ order: order._id })).toBe(2);
    expect((await Payment.find({ order: order._id }).lean()).map((p) => p.amount).sort()).toEqual([400000, 600000]);
    expect(afterPaid).toHaveBeenCalledTimes(1);
    expect(isSplitPaid(saved)).toBe(true);
  });

  it('the same webhook twice → one payment, one part, no second "order paid"', async () => {
    const order = await partsOrder([10000]);
    const [p1] = order.paymentParts;
    const pay = capture(order, p1);
    await razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, pay));
    await razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, pay));
    expect(await Payment.countDocuments({ gatewayPaymentId: pay.id })).toBe(1);
    expect(afterPaid).toHaveBeenCalledTimes(1);
  });

  it('the same webhook delivered concurrently → still exactly one payment', async () => {
    const order = await partsOrder([10000]);
    const [p1] = order.paymentParts;
    const pay = capture(order, p1);
    await Promise.allSettled([
      razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, pay)),
      razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, pay)),
    ]);
    expect(await Payment.countDocuments({ gatewayPaymentId: pay.id })).toBe(1);
    expect((await Order.findById(order._id).lean()).paymentStatus).toBe('paid');
    expect(afterPaid).toHaveBeenCalledTimes(1);
  });

  it('a capture that is not exactly the part amount is refused', async () => {
    const order = await partsOrder([600000, 400000]);
    const [p1] = order.paymentParts;
    await expect(razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, capture(order, p1, { amount: 100000000 }))))
      .rejects.toThrow(/Amount mismatch/);
    expect(await Payment.countDocuments({})).toBe(0);
    expect((await Order.findById(order._id).lean()).paymentParts[0].status).toBe('pending');
  });

  it('a single-part order stays refundable in one click', async () => {
    const order = await partsOrder([10000]);
    const [p1] = order.paymentParts;
    await razorpayService.handlePaymentLinkPaid(linkPaid(order, p1, capture(order, p1)));
    const saved = await Order.findById(order._id).lean();
    expect(saved.paymentStatus).toBe('paid');
    expect(isSplitPaid(saved)).toBe(false);
    expect(String(saved.payment)).toBe(String(saved.paymentParts[0].payment));
  });

  it('a webhook for an older single-link order still goes the whole-order way', async () => {
    const user = await User.create({ name: 'U', email: `old${Date.now()}@x.com`, passwordHash: 'x' });
    const order = await Order.create({
      user: user._id, source: 'offline', items: [{ custom: true, name: 'X', quantity: 1, price: 2000 }],
      subtotal: 2000, totalAmount: 2000, shippingAddress: ADDRESS, status: 'awaiting_payment', paymentStatus: 'pending',
      paymentLinkId: 'plink_old', paymentLinkUrl: 'https://rzp.io/i/old',
    });
    const pay = { id: `pay_${new mongoose.Types.ObjectId()}`, amount: 200000, currency: 'INR', method: 'upi', status: 'captured', notes: {} };
    await razorpayService.handlePaymentLinkPaid({ payment_link: { entity: { id: 'plink_old', notes: { orderId: String(order._id) } } }, payment: { entity: pay } });
    expect((await Order.findById(order._id).lean()).paymentStatus).toBe('paid');
  });
});

describe('reconciliation of missed part webhooks', () => {
  it('recovers a captured part whose webhook never came, through the same guards', async () => {
    const order = await partsOrder([600000, 400000], { partAgeMs: HOUR });
    const [p1, p2] = order.paymentParts;
    const captures = { [p1.linkId]: [capture(order, p1)], [p2.linkId]: [capture(order, p2)] };
    jest.spyOn(razorpayService, 'fetchPaymentLinkCaptures').mockImplementation(async (id) => ({ status: 'paid', payments: captures[id] || [] }));

    const result = await reconcileSalesLinks();
    expect(result.recovered).toBe(2);
    const saved = await Order.findById(order._id).lean();
    expect(saved.paymentStatus).toBe('paid');
    expect(afterPaid).toHaveBeenCalledTimes(1);

    // Running again changes nothing.
    await reconcileSalesLinks();
    expect(await Payment.countDocuments({ order: order._id })).toBe(2);
    expect(afterPaid).toHaveBeenCalledTimes(1);
  });

  it('marks a part whose link expired unpaid', async () => {
    const order = await partsOrder([10000], { partAgeMs: HOUR });
    jest.spyOn(razorpayService, 'fetchPaymentLinkCaptures').mockResolvedValue({ status: 'expired', payments: [] });
    const result = await reconcileSalesLinks();
    expect(result.closed).toBe(1);
    expect((await Order.findById(order._id).lean()).paymentParts[0].status).toBe('expired');
  });

  it('leaves a brand-new part alone (its webhook may still be on the way)', async () => {
    await partsOrder([10000], { partAgeMs: 0 });
    const spy = jest.spyOn(razorpayService, 'fetchPaymentLinkCaptures');
    await reconcileSalesLinks();
    expect(spy).not.toHaveBeenCalled();
  });
});
