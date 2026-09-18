import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as db from '../../db-handler.js';
import Order from '../../../models/Order.js';
import Payment from '../../../models/Payment.js';
import orderRepository from '../../../repositories/orderRepository.js';
import paymentRepository from '../../../repositories/paymentRepository.js';

/**
 * The atomic claims behind offline refund recording and reverting, against a REAL
 * database.
 *
 * These are deliberately not mocked-repository tests. Every guard here is expressed as a
 * MongoDB query predicate — `$nin`, `$elemMatch`, `$exists`, the positional `$` operator
 * — and a mock returns whatever the test tells it to, so a mocked suite passes just as
 * happily against a predicate that matches nothing. This repository has been bitten by
 * exactly that before: a `{$size: 0}` guard that matched 0 of 1,599 production orders
 * while its model-built fixtures all passed.
 *
 * What must hold:
 *   1. One winner per claim, however many callers race.
 *   2. A GATEWAY refund can never be reverted — the single most important rule here,
 *      because the money has genuinely left and only the books would move.
 *   3. mark → revert → mark leaves every counter exactly where one mark leaves it.
 */

jest.setTimeout(120000);

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.closeDatabase(); });

const makeOrder = async (overrides = {}) => Order.create({
  user: new mongoose.Types.ObjectId(),
  items: [],
  totalAmount: 1500,
  subtotal: 1500,
  tax: 0,
  shippingCost: 0,
  status: 'cancelled',
  paymentStatus: 'paid',
  shippingAddress: {
    fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Road',
    city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
  },
  ...overrides,
});

const OFFLINE = {
  amount: 1500,
  refundType: 'full',
  offlineMethod: 'bank_transfer',
  offlineReference: 'UTR-11223344',
  paidAt: new Date('2026-09-10T10:00:00Z'),
  markRefunded: true,
};

describe('markRefundOfflineCompleted', () => {
  it('records the payout and flips the payment axis for a full refund', async () => {
    const order = await makeOrder();
    const userId = new mongoose.Types.ObjectId();

    const claimed = await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId });
    expect(claimed).toBe(true);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails.status).toBe('completed');
    expect(fresh.refundDetails.refundMethod).toBe('offline');
    expect(fresh.refundDetails.offlineMethod).toBe('bank_transfer');
    expect(fresh.refundDetails.offlineReference).toBe('UTR-11223344');
    expect(fresh.refundDetails.amount).toBe(1500);
    expect(fresh.paymentStatus).toBe('refunded');
    // The operator's reference must NOT land in the gateway-id field, which is indexed
    // and searched by the refund webhook's fallback lookup.
    expect(fresh.refundDetails.transactionId).toBeNull();
  });

  it('leaves the payment axis alone for a partial record', async () => {
    const order = await makeOrder();
    await orderRepository.markRefundOfflineCompleted(order._id, {
      ...OFFLINE, amount: 500, refundType: 'partial', markRefunded: false,
      userId: new mongoose.Types.ObjectId(),
    });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails.status).toBe('completed');
    expect(fresh.paymentStatus).toBe('paid');
  });

  it('is claimable after a FAILED gateway attempt — the case this whole feature exists for', async () => {
    // Exactly the state an order lands in when the admin refunded by hand in the
    // Razorpay dashboard and then pressed the button: the gateway rejected it as
    // already refunded, markRefundFailed rolled the claim back to `failed`.
    const order = await makeOrder({
      refundDetails: {
        status: 'failed', amount: 1500, requestedAt: new Date(),
        failureReason: 'The payment has been fully refunded already',
      },
    });

    const claimed = await orderRepository.markRefundOfflineCompleted(order._id, {
      ...OFFLINE, userId: new mongoose.Types.ObjectId(),
    });
    expect(claimed).toBe(true);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails.status).toBe('completed');
    expect(fresh.refundDetails.failureReason).toBeNull();
  });

  it('is claimable on a legacy order carrying no refundDetails at all', async () => {
    const order = await makeOrder();
    // Imported/legacy orders predate the auto-flag. $unset rather than building the
    // fixture without it: Mongoose materialises the nested path on save regardless, so
    // only an explicit unset reproduces what is actually in the collection.
    await Order.collection.updateOne({ _id: order._id }, { $unset: { refundDetails: '' } });

    const claimed = await orderRepository.markRefundOfflineCompleted(order._id, {
      ...OFFLINE, userId: new mongoose.Types.ObjectId(),
    });
    expect(claimed).toBe(true);
  });

  it('refuses an order that is not cancelled, and one that is not paid', async () => {
    const live = await makeOrder({ status: 'processing' });
    const unpaid = await makeOrder({ paymentStatus: 'pending' });
    const userId = new mongoose.Types.ObjectId();

    expect(await orderRepository.markRefundOfflineCompleted(live._id, { ...OFFLINE, userId })).toBe(false);
    expect(await orderRepository.markRefundOfflineCompleted(unpaid._id, { ...OFFLINE, userId })).toBe(false);
  });

  it('gives exactly ONE winner when several admins submit at once', async () => {
    const order = await makeOrder();
    const userId = new mongoose.Types.ObjectId();

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId })),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('claimRefundRevert', () => {
  it('puts an offline record back to "refund due" and clears the offline fields', async () => {
    const order = await makeOrder();
    const userId = new mongoose.Types.ObjectId();
    await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId });

    const before = await orderRepository.claimRefundRevert(order._id, {
      userId, reason: 'Recorded against the wrong order',
    });
    expect(before).toBeTruthy();
    // Returns the PRE-update document, so the caller can read what it must now reverse.
    expect(before.refundDetails.amount).toBe(1500);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails.status).toBe('pending');
    expect(fresh.refundDetails.revertReason).toBe('Recorded against the wrong order');
    expect(fresh.refundDetails.offlineMethod).toBeUndefined();
    expect(fresh.refundDetails.offlineReference).toBeUndefined();
    /*
      Reset to original_payment, NOT left as 'offline'. markRefundProcessing carries the
      method forward when it claims, so leaving it would file the next genuine Razorpay
      refund on this order as an offline payout.
    */
    expect(fresh.refundDetails.refundMethod).toBe('original_payment');
    // Re-armed so a later real refund can record against the payment row again.
    expect(fresh.refundDetails.paymentRecorded).toBe(false);
  });

  it('REFUSES to revert a refund that went through Razorpay', async () => {
    // The rule the whole feature hangs on. A gateway refund is real money already gone;
    // reverting it would leave the books saying the customer was never refunded, and the
    // next admin to look would refund them a second time.
    const order = await makeOrder({
      refundDetails: {
        status: 'completed', amount: 1500, refundMethod: 'original_payment',
        requestedAt: new Date(), processedAt: new Date(), transactionId: 'rfnd_XyZ123',
      },
    });

    const claimed = await orderRepository.claimRefundRevert(order._id, {
      userId: new mongoose.Types.ObjectId(), reason: 'oops',
    });

    expect(claimed).toBeNull();
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails.status).toBe('completed');
  });

  it('refuses a refund that is merely pending, or already reverted', async () => {
    const order = await makeOrder({
      refundDetails: { status: 'pending', amount: 1500, requestedAt: new Date() },
    });
    const userId = new mongoose.Types.ObjectId();

    expect(await orderRepository.claimRefundRevert(order._id, { userId, reason: 'r' })).toBeNull();

    await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId });
    expect(await orderRepository.claimRefundRevert(order._id, { userId, reason: 'r' })).toBeTruthy();
    // Second revert finds a `pending` record and must not claim it again.
    expect(await orderRepository.claimRefundRevert(order._id, { userId, reason: 'r' })).toBeNull();
  });

  it('gives exactly ONE winner when several reverts race', async () => {
    const order = await makeOrder();
    const userId = new mongoose.Types.ObjectId();
    await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => orderRepository.claimRefundRevert(order._id, { userId, reason: 'r' })),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('allows mark → revert → mark, and clears the stale reversal stamp on the re-mark', async () => {
    const order = await makeOrder();
    const userId = new mongoose.Types.ObjectId();

    await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId });
    await orderRepository.claimRefundRevert(order._id, { userId, reason: 'first was wrong' });
    const second = await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId });

    expect(second).toBe(true);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails.status).toBe('completed');
    // Without the $unset the document would still read as reverted while carrying a
    // standing refund — two contradictory facts on one record.
    expect(fresh.refundDetails.revertedAt).toBeUndefined();
    expect(fresh.refundDetails.revertReason).toBeUndefined();
  });
});

describe('claimRefundRevert — return mirror', () => {
  it('refuses to withdraw a RETURN refund that mirrored itself onto the order', async () => {
    /*
      A return's offline refund writes `refundMethod: 'offline'` onto the very same
      subdoc, tagged `Return <id>`. Without the $nor clause this claim matched it, and
      the whole-order revert would have withdrawn a return's refund — leaving the
      ReturnRequest (the authoritative record) saying `completed` while the order said
      `pending`, with the money counted in neither.
    */
    const returnId = new mongoose.Types.ObjectId();
    const order = await makeOrder({
      refundDetails: {
        status: 'completed', amount: 1500, refundType: 'full', refundMethod: 'offline',
        requestedAt: new Date(), processedAt: new Date(),
        offlineMethod: 'cash', offlineReference: 'RCPT-1',
        notes: `Return ${returnId}`,
      },
    });

    const claimed = await orderRepository.claimRefundRevert(order._id, {
      userId: new mongoose.Types.ObjectId(), reason: 'wrong',
    });

    expect(claimed).toBeNull();
    expect((await Order.findById(order._id).lean()).refundDetails.status).toBe('completed');
  });
});

describe('per-line cancellation offline claims', () => {
  const CANCELLATION_OFFLINE = {
    amountPaise: 40000,
    offlineMethod: 'upi',
    offlineReference: 'UPI-778899',
    paidAt: new Date('2026-09-11T08:00:00Z'),
  };

  // An order cancelled line by line, with one cancellation awaiting its refund.
  const makeOrderWithCancellation = async (refundOverrides = {}) => {
    const itemId = new mongoose.Types.ObjectId();
    return makeOrder({
      status: 'processing',
      cancellations: [{
        sequence: 1,
        lines: [{ itemId, quantity: 1 }],
        reason: 'Customer changed their mind',
        cancelledAt: new Date(),
        refund: { productValuePaise: 40000, status: 'pending', ...refundOverrides },
      }],
    });
  };

  it('records the payout against the right cancellation', async () => {
    const order = await makeOrderWithCancellation();
    const cancellationId = order.cancellations[0]._id;

    const before = await orderRepository.markCancellationRefundOffline(order._id, cancellationId, {
      ...CANCELLATION_OFFLINE, userId: new mongoose.Types.ObjectId(),
    });
    expect(before).toBeTruthy();

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.cancellations[0].refund.status).toBe('completed');
    expect(fresh.cancellations[0].refund.offlineMethod).toBe('upi');
    expect(fresh.cancellations[0].refund.amountPaise).toBe(40000);
    // A per-line refund never moves the payment axis — the order is still part-live.
    expect(fresh.paymentStatus).toBe('paid');
  });

  it('refuses a cancellation whose refund is already completed or not_applicable', async () => {
    const done = await makeOrderWithCancellation({ status: 'completed' });
    const na = await makeOrderWithCancellation({ status: 'not_applicable' });
    const userId = new mongoose.Types.ObjectId();

    expect(await orderRepository.markCancellationRefundOffline(
      done._id, done.cancellations[0]._id, { ...CANCELLATION_OFFLINE, userId })).toBeNull();
    expect(await orderRepository.markCancellationRefundOffline(
      na._id, na.cancellations[0]._id, { ...CANCELLATION_OFFLINE, userId })).toBeNull();
  });

  it('gives exactly ONE winner when several admins submit at once', async () => {
    const order = await makeOrderWithCancellation();
    const userId = new mongoose.Types.ObjectId();

    const results = await Promise.all(Array.from({ length: 6 }, () =>
      orderRepository.markCancellationRefundOffline(
        order._id, order.cancellations[0]._id, { ...CANCELLATION_OFFLINE, userId })));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('reverts an offline record and re-arms the once-only side-effect guards', async () => {
    const order = await makeOrderWithCancellation();
    const cancellationId = order.cancellations[0]._id;
    const userId = new mongoose.Types.ObjectId();

    await orderRepository.markCancellationRefundOffline(order._id, cancellationId, {
      ...CANCELLATION_OFFLINE, userId,
    });
    // Simulate the side effects having run, as they do in the service's phase 2.
    await orderRepository.claimCancellationRefundSideEffects(order._id, cancellationId);
    await orderRepository.setCancellationAppliedAmounts(order._id, cancellationId, { affiliateClawbackPaise: 1200 });

    const before = await orderRepository.claimCancellationRefundRevert(order._id, cancellationId, {
      userId, reason: 'Paid against the wrong cancellation',
    });
    expect(before).toBeTruthy();
    // Pre-update document carries what the caller must now reverse.
    const beforeRecord = before.cancellations.find((c) => String(c._id) === String(cancellationId));
    expect(beforeRecord.refund.amountPaise).toBe(40000);
    expect(beforeRecord.refund.affiliateClawbackPaise).toBe(1200);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.cancellations[0].refund.status).toBe('pending');
    expect(fresh.cancellations[0].refund.offlineMethod).toBeUndefined();
    // Re-armed, or a later genuine refund of these lines would skip its own side effects.
    expect(fresh.cancellations[0].refund.paymentIncremented).toBe(false);
    expect(fresh.cancellations[0].refund.ltvAdjusted).toBe(false);
  });

  it('REFUSES to revert a cancellation refund that went through Razorpay', async () => {
    const order = await makeOrderWithCancellation({
      status: 'completed', razorpayRefundId: 'rfnd_Line123', amountPaise: 40000,
    });

    const claimed = await orderRepository.claimCancellationRefundRevert(
      order._id, order.cancellations[0]._id,
      { userId: new mongoose.Types.ObjectId(), reason: 'oops' },
    );

    expect(claimed).toBeNull();
    expect((await Order.findById(order._id).lean()).cancellations[0].refund.status).toBe('completed');
  });

  it('reverts only the TARGETED cancellation when an order has several', async () => {
    // The positional `$` operator writes to the element `$elemMatch` matched. A predicate
    // that matched the document rather than the element would rewrite cancellation 1's
    // refund while the admin was reverting cancellation 2.
    const itemA = new mongoose.Types.ObjectId();
    const itemB = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const order = await makeOrder({
      status: 'processing',
      cancellations: [
        { sequence: 1, lines: [{ itemId: itemA, quantity: 1 }], cancelledAt: new Date(),
          refund: { productValuePaise: 40000, status: 'pending' } },
        { sequence: 2, lines: [{ itemId: itemB, quantity: 1 }], cancelledAt: new Date(),
          refund: { productValuePaise: 25000, status: 'pending' } },
      ],
    });
    const [first, second] = order.cancellations;

    await orderRepository.markCancellationRefundOffline(order._id, first._id, {
      ...CANCELLATION_OFFLINE, userId });
    await orderRepository.markCancellationRefundOffline(order._id, second._id, {
      ...CANCELLATION_OFFLINE, amountPaise: 25000, userId });

    await orderRepository.claimCancellationRefundRevert(order._id, second._id, {
      userId, reason: 'only the second' });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.cancellations[0].refund.status).toBe('completed');
    expect(fresh.cancellations[0].refund.offlineMethod).toBe('upi');
    expect(fresh.cancellations[1].refund.status).toBe('pending');
  });
});

describe('applied-amount bookkeeping', () => {
  it('clears the applied record on revert, so a re-mark cannot inherit stale figures', async () => {
    /*
      Without this, mark → (effects land) → revert → mark → (effects FAIL) would leave
      cycle one's `paymentRecordedPaise` in place, and the second revert would subtract
      money the second mark never added.
    */
    const order = await makeOrder();
    const userId = new mongoose.Types.ObjectId();
    await orderRepository.markRefundOfflineCompleted(order._id, { ...OFFLINE, userId });
    await orderRepository.setRefundAppliedAmounts(order._id, {
      paymentRecordedPaise: 150000, affiliateClawbackPaise: 900,
    });

    await orderRepository.claimRefundRevert(order._id, { userId, reason: 'mistake' });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails.paymentRecordedPaise).toBeUndefined();
    expect(fresh.refundDetails.affiliateClawbackPaise).toBeUndefined();
  });

  it('clears the per-line applied record on revert too', async () => {
    const itemId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const order = await makeOrder({
      status: 'processing',
      cancellations: [{
        sequence: 1, lines: [{ itemId, quantity: 1 }], cancelledAt: new Date(),
        refund: { productValuePaise: 40000, status: 'pending' },
      }],
    });
    const cancellationId = order.cancellations[0]._id;

    await orderRepository.markCancellationRefundOffline(order._id, cancellationId, {
      amountPaise: 40000, offlineMethod: 'upi', offlineReference: 'U-1', paidAt: new Date(), userId,
    });
    await orderRepository.setCancellationAppliedAmounts(order._id, cancellationId, {
      paymentRecordedPaise: 40000, ltvDecrementedPaise: 40000, affiliateClawbackPaise: 1200,
    });

    await orderRepository.claimCancellationRefundRevert(order._id, cancellationId, {
      userId, reason: 'mistake',
    });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.cancellations[0].refund.paymentRecordedPaise).toBeUndefined();
    expect(fresh.cancellations[0].refund.ltvDecrementedPaise).toBeUndefined();
    expect(fresh.cancellations[0].refund.affiliateClawbackPaise).toBeUndefined();
  });
});

describe('clearRefundMirror', () => {
  it('removes the summary only when it still describes the named return', async () => {
    const order = await makeOrder({
      status: 'delivered',
      refundDetails: {
        status: 'completed', amount: 400, refundMethod: 'offline',
        requestedAt: new Date(), notes: 'Return ret-1',
      },
    });

    expect(await orderRepository.clearRefundMirror(order._id, 'Return ret-OTHER')).toBe(false);
    expect((await Order.findById(order._id).lean()).refundDetails.status).toBe('completed');

    expect(await orderRepository.clearRefundMirror(order._id, 'Return ret-1')).toBe(true);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.refundDetails).toBeUndefined();
  });

  it('takes the order out of the refunds queue entirely', async () => {
    // The point of unsetting rather than setting `pending`: a delivered order left in the
    // actionable bucket can never be acted on (every action needs status 'cancelled').
    const order = await makeOrder({
      status: 'delivered',
      refundDetails: {
        status: 'completed', amount: 400, refundMethod: 'offline',
        requestedAt: new Date(), notes: 'Return ret-1',
      },
    });

    await orderRepository.clearRefundMirror(order._id, 'Return ret-1');

    const { orders } = await orderRepository.findWithRefunds('all');
    expect(orders.map((o) => String(o._id))).not.toContain(String(order._id));
  });
});

describe('paymentRepository.reverseRefund', () => {
  const makePayment = async (overrides = {}) => Payment.create({
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    amount: 1500,
    currency: 'INR',
    status: 'completed',
    gatewayPaymentId: 'pay_abc123',
    paymentMethod: 'credit_card',
    paymentGateway: 'razorpay',
    ...overrides,
  });

  it('is an exact inverse of recordRefund', async () => {
    const payment = await makePayment();

    await paymentRepository.recordRefund(payment._id, 1500, 'order_cancelled_offline');
    const refunded = await Payment.findById(payment._id).lean();
    expect(refunded.refundAmount).toBe(1500);
    expect(refunded.status).toBe('refunded');

    await paymentRepository.reverseRefund(payment._id, 1500);
    const reversed = await Payment.findById(payment._id).lean();
    expect(reversed.refundAmount).toBe(0);
    // Un-flipped: a capture with nothing refunded against it is `completed`, not `refunded`.
    expect(reversed.status).toBe('completed');
  });

  it('leaves an earlier partial refund standing when a later one is reversed', async () => {
    const payment = await makePayment();

    await paymentRepository.recordRefund(payment._id, 400, 'return_refund');
    await paymentRepository.recordRefund(payment._id, 600, 'order_cancelled_offline');
    await paymentRepository.reverseRefund(payment._id, 600);

    const fresh = await Payment.findById(payment._id).lean();
    // The other refund's money must survive — this is the $inc-not-assign rule, in reverse.
    expect(fresh.refundAmount).toBe(400);
    expect(fresh.status).toBe('completed');
  });

  it('never drives the row negative, however many times it is retried', async () => {
    const payment = await makePayment();
    await paymentRepository.recordRefund(payment._id, 500, 'order_cancelled_offline');

    await Promise.all(Array.from({ length: 4 }, () => paymentRepository.reverseRefund(payment._id, 500)));

    const fresh = await Payment.findById(payment._id).lean();
    expect(fresh.refundAmount).toBe(0);
  });

  it('handles the rupee-float case that breaks a naive comparison', async () => {
    // 16000.88 + 12682.50 === 28683.379999999997 in binary floating point. recordRefund
    // normalises this in paise; the reversal has to agree or the status never un-flips.
    const payment = await makePayment({ amount: 28683.38 });
    await paymentRepository.recordRefund(payment._id, 16000.88, 'return_refund');
    await paymentRepository.recordRefund(payment._id, 12682.50, 'order_cancelled_offline');
    expect((await Payment.findById(payment._id).lean()).status).toBe('refunded');

    await paymentRepository.reverseRefund(payment._id, 12682.50);
    const fresh = await Payment.findById(payment._id).lean();
    expect(fresh.status).toBe('completed');
    expect(Math.round(fresh.refundAmount * 100)).toBe(1600088);
  });
});
