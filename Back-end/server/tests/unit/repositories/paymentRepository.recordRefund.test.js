/**
 * paymentRepository.recordRefund — the cumulative write on the Payment row.
 *
 * Two properties this must hold, both of which were broken at some point:
 *   1. ACCUMULATE, never assign. The refund webhooks used to overwrite refundAmount,
 *      so a second partial refund erased the first.
 *   2. Decide "fully refunded?" in integer PAISE. refundAmount is a rupee float and
 *      `$inc` accumulates binary error, so comparing the floats loses roughly one
 *      split in nine and leaves a fully-refunded payment stuck on its old status.
 */

import { connect, closeDatabase, clearDatabase } from '../../db-handler.js';
import paymentRepository from '../../../repositories/paymentRepository.js';
import Payment from '../../../models/Payment.js';
import mongoose from 'mongoose';

beforeAll(async () => { await connect(); });
afterEach(async () => { await clearDatabase(); });
afterAll(async () => { await closeDatabase(); });

const makePayment = (amount) => Payment.create({
  order: new mongoose.Types.ObjectId(),
  user: new mongoose.Types.ObjectId(),
  amount,
  paymentMethod: 'upi',
  paymentGateway: 'razorpay',
  status: 'completed',
  gatewayPaymentId: `pay_${Math.random().toString(36).slice(2)}`,
});

describe('paymentRepository.recordRefund', () => {
  it('accumulates successive partial refunds instead of overwriting', async () => {
    const p = await makePayment(1500);

    await paymentRepository.recordRefund(p._id, 500, 'return_refund');
    const after = await paymentRepository.recordRefund(p._id, 300, 'return_refund');

    expect(after.refundAmount).toBeCloseTo(800, 2);
    expect(after.status).toBe('completed'); // partial — order still reads as paid
  });

  it('flips to `refunded` once the cumulative total covers the capture', async () => {
    const p = await makePayment(1000);
    await paymentRepository.recordRefund(p._id, 400, 'return_refund');
    const after = await paymentRepository.recordRefund(p._id, 600, 'return_refund');
    expect(after.status).toBe('refunded');
  });

  /**
   * The regression. 16000.88 + 12682.50 === 28683.379999999997 in IEEE-754, which is
   * `< 28683.38` — so a rupee-float comparison leaves this payment on `completed`
   * forever despite being refunded in full.
   */
  it('flips to `refunded` on a split whose float sum undershoots the total', async () => {
    const p = await makePayment(28683.38);

    await paymentRepository.recordRefund(p._id, 16000.88, 'return_refund');
    const after = await paymentRepository.recordRefund(p._id, 12682.50, 'return_refund');

    expect(after.status).toBe('refunded');
    // The flip also normalises the accumulated drift out of the stored value.
    expect(after.refundAmount).toBe(28683.38);
  });

  it('does not flip while still a paise short', async () => {
    const p = await makePayment(1000);
    const after = await paymentRepository.recordRefund(p._id, 999.99, 'return_refund');
    expect(after.status).toBe('completed');
  });

  it('ignores a zero or negative amount without touching the row', async () => {
    const p = await makePayment(1000);
    expect(await paymentRepository.recordRefund(p._id, 0, 'x')).toBeNull();
    expect(await paymentRepository.recordRefund(p._id, -50, 'x')).toBeNull();
    const fresh = await Payment.findById(p._id);
    expect(fresh.refundAmount).toBe(0);
  });

  it('returns null for a payment that does not exist', async () => {
    expect(await paymentRepository.recordRefund(new mongoose.Types.ObjectId(), 100, 'x')).toBeNull();
  });

  it('stamps the reason and timestamp', async () => {
    const p = await makePayment(1000);
    const after = await paymentRepository.recordRefund(p._id, 100, 'order_cancelled');
    expect(after.refundReason).toBe('order_cancelled');
    expect(after.refundedAt).toBeInstanceOf(Date);
  });
});
