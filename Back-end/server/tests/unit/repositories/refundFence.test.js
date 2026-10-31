import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as db from '../../db-handler.js';
import Order from '../../../models/Order.js';
import orderRepository, { refundFence } from '../../../repositories/orderRepository.js';

/**
 * The order's refund fence (Order.refundSeq) against a REAL database.
 *
 * Every refund on an order draws on one capture, and each computes "what is left" from a
 * snapshot of the order. Two refunds computed from the same snapshot used to be able to
 * both commit — a return refund and a cancellation refund, or two returns — and together
 * send back more than the customer paid. Each claim now matches on the counter it read
 * and advances it in the same write, so the second claim finds it moved and claims
 * nothing.
 *
 * What must hold:
 *   1. The fence matches an order written before the field existed (seen = 0).
 *   2. Every claim that moves money advances the counter by exactly one.
 *   3. A claim made with a stale counter claims NOTHING and changes nothing.
 *   4. An order.save() later in a refund flow can never write the stale value back.
 */

jest.setTimeout(120000);

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Road',
  city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
};

/** Written straight to the collection, so it lacks refundSeq like every order before it. */
async function legacyOrder(overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({
    _id,
    user: new mongoose.Types.ObjectId(),
    items: [],
    totalAmount: 1500, subtotal: 1500, tax: 0, shippingCost: 0,
    status: 'cancelled', paymentStatus: 'paid',
    shippingAddress: ADDRESS,
    ...overrides,
  });
  return Order.findById(_id);
}

const seqOf = async (id) => (await Order.findById(id).lean()).refundSeq;

const withCancellation = () => ({
  status: 'processing',
  cancellations: [{
    _id: new mongoose.Types.ObjectId(),
    sequence: 1,
    lines: [{ itemId: new mongoose.Types.ObjectId(), quantity: 1 }],
    reason: 'Out of stock',
    cancelledAt: new Date(),
    refund: { productValuePaise: 40000, status: 'pending' },
  }],
});

const OFFLINE = {
  amount: 1500, refundType: 'full', offlineMethod: 'bank_transfer',
  offlineReference: 'UTR-1', paidAt: new Date(), markRefunded: true,
};

describe('refundFence', () => {
  it('matches an order that has never had the field — and 0 stays 0 for a missing value', async () => {
    const order = await legacyOrder();
    expect(order.refundSeq).toBeUndefined();
    expect(await Order.countDocuments({ _id: order._id, ...refundFence(order.refundSeq) })).toBe(1);
    expect(await Order.countDocuments({ _id: order._id, ...refundFence(1) })).toBe(0);
  });

  it('advanceRefundSeq moves 0 → 1 once; the same stale read can never move it again', async () => {
    const order = await legacyOrder();
    const outcomes = await Promise.all([
      orderRepository.advanceRefundSeq(order._id, order.refundSeq),
      orderRepository.advanceRefundSeq(order._id, order.refundSeq),
      orderRepository.advanceRefundSeq(order._id, order.refundSeq),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await seqOf(order._id)).toBe(1);
    expect(await orderRepository.advanceRefundSeq(order._id, 1)).toBe(true);
    expect(await seqOf(order._id)).toBe(2);
  });
});

describe('every money-moving claim on the order is fenced', () => {
  it('whole-order gateway refund (markRefundProcessing)', async () => {
    const stale = await legacyOrder();
    await orderRepository.advanceRefundSeq(stale._id, 0); // another refund committed meanwhile
    expect(await orderRepository.markRefundProcessing(stale, new mongoose.Types.ObjectId())).toBe(false);
    expect((await Order.findById(stale._id).lean()).refundDetails?.status).toBeUndefined();

    const fresh = await Order.findById(stale._id);
    expect(await orderRepository.markRefundProcessing(fresh, new mongoose.Types.ObjectId())).toBe(true);
    expect(await seqOf(stale._id)).toBe(2);
  });

  it('whole-order offline payout (markRefundOfflineCompleted)', async () => {
    const order = await legacyOrder();
    await orderRepository.advanceRefundSeq(order._id, 0);
    const userId = new mongoose.Types.ObjectId();
    expect(await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId, refundSeq: 0 })).toBe(false);
    expect((await Order.findById(order._id).lean()).paymentStatus).toBe('paid');

    expect(await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId, refundSeq: 1 })).toBe(true);
    expect(await seqOf(order._id)).toBe(2);
  });

  it('line-cancellation gateway refund (claimCancellationRefund)', async () => {
    const order = await legacyOrder(withCancellation());
    const cid = order.cancellations[0]._id;
    await orderRepository.advanceRefundSeq(order._id, 0);
    expect(await orderRepository.claimCancellationRefund(order._id, cid, 40000, 0)).toBeNull();
    expect((await Order.findById(order._id).lean()).cancellations[0].refund.status).toBe('pending');

    const claimed = await orderRepository.claimCancellationRefund(order._id, cid, 40000, 1);
    expect(claimed.cancellations[0].refund.status).toBe('processing');
    expect(claimed.refundSeq).toBe(2);
  });

  it('line-cancellation offline payout (markCancellationRefundOffline)', async () => {
    const order = await legacyOrder(withCancellation());
    const cid = order.cancellations[0]._id;
    const opts = {
      amountPaise: 40000, offlineMethod: 'upi', offlineReference: 'UTR-2', paidAt: new Date(),
      userId: new mongoose.Types.ObjectId(),
    };
    await orderRepository.advanceRefundSeq(order._id, 0);
    expect(await orderRepository.markCancellationRefundOffline(order._id, cid, { ...opts, refundSeq: 0 })).toBeNull();
    expect((await Order.findById(order._id).lean()).cancellations[0].refund.status).toBe('pending');

    expect(await orderRepository.markCancellationRefundOffline(order._id, cid, { ...opts, refundSeq: 1 })).not.toBeNull();
    expect(await seqOf(order._id)).toBe(2);
  });

  it('two cancellations refunded from one snapshot: only one claims', async () => {
    const order = await legacyOrder({
      status: 'processing',
      cancellations: [1, 2].map((sequence) => ({
        _id: new mongoose.Types.ObjectId(), sequence,
        lines: [{ itemId: new mongoose.Types.ObjectId(), quantity: 1 }],
        reason: 'Out of stock', cancelledAt: new Date(),
        refund: { productValuePaise: 40000, status: 'pending' },
      })),
    });
    const [a, b] = order.cancellations.map((c) => c._id);
    const outcomes = await Promise.all([
      orderRepository.claimCancellationRefund(order._id, a, 40000, order.refundSeq),
      orderRepository.claimCancellationRefund(order._id, b, 40000, order.refundSeq),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const after = await Order.findById(order._id).lean();
    expect(after.cancellations.filter((c) => c.refund.status === 'processing')).toHaveLength(1);
    expect(after.refundSeq).toBe(1);
  });
});

it('an order.save() later in a refund flow never writes the stale counter back', async () => {
  const order = await legacyOrder();
  const loaded = await Order.findById(order._id); // what a refund flow holds in memory
  await orderRepository.advanceRefundSeq(order._id, loaded.refundSeq);
  await orderRepository.advanceRefundSeq(order._id, 1);

  loaded.refundDetails = { amount: 100, status: 'processing', notes: 'Return x' };
  await loaded.save();
  expect(await seqOf(order._id)).toBe(2);
});
