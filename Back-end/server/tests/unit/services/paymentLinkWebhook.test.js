/**
 * razorpayService.handlePaymentLinkPaid — resolves our order from the payment
 * LINK entity and runs the same integrity guards as a captured payment before
 * handing off to processPaymentSuccess. processPaymentSuccess itself (which uses
 * a Mongo transaction) is spied out; it's covered by the captured-payment path.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connect, closeDatabase, clearDatabase } from '../../db-handler.js';
import Order from '../../../models/Order.js';
import razorpayService from '../../../services/razorpayService.js';

const ADDR = { fullName: 'B', phone: '9000000000', addressLine1: '1 St', city: 'Pune', state: 'MH', postalCode: '411001', country: 'India' };

const seedAwaitingOrder = (totalAmount = 2500) => Order.create({
  user: new mongoose.Types.ObjectId(),
  source: 'offline',
  items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: totalAmount, name: 'X' }],
  shippingAddress: ADDR,
  subtotal: totalAmount, totalAmount,
  status: 'awaiting_payment', paymentStatus: 'pending',
  guestEmail: 'linkpay@x.com',
});

const linkPayload = (order, over = {}) => ({
  payment_link: { entity: { id: 'plink_1', reference_id: order._id.toString(), notes: { orderId: order._id.toString() } } },
  payment: { entity: { id: 'pay_1', amount: order.totalAmount * 100, currency: 'INR', notes: {}, ...over } },
});

let spy;
beforeAll(async () => { await connect(); });
beforeEach(() => { spy = jest.spyOn(razorpayService, 'processPaymentSuccess').mockResolvedValue({ status: 'processed' }); });
afterEach(async () => { spy.mockRestore(); await clearDatabase(); });
afterAll(async () => { await closeDatabase(); });

describe('handlePaymentLinkPaid', () => {
  it('resolves the order from the link and dispatches to processPaymentSuccess', async () => {
    const order = await seedAwaitingOrder();
    await razorpayService.handlePaymentLinkPaid(linkPayload(order));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(order._id.toString()); // orderId
    expect(spy.mock.calls[0][1].notes.orderId).toBe(order._id.toString()); // orderId stamped on the payment
  });

  it('does not false-mismatch a fractional-rupee total (rounded to paise)', async () => {
    const order = await seedAwaitingOrder(999.10); // ₹999.10 → the link charges Math.round(*100)=99910
    await razorpayService.handlePaymentLinkPaid(linkPayload(order, { amount: 99910 }));
    expect(spy).toHaveBeenCalledTimes(1); // 99910 === Math.round(999.10*100), not the unrounded 99910.0000001
  });

  it('throws on an amount mismatch and does not process', async () => {
    const order = await seedAwaitingOrder(2500);
    await expect(
      razorpayService.handlePaymentLinkPaid(linkPayload(order, { amount: 100 })) // ₹1 ≠ ₹2500
    ).rejects.toThrow(/Amount mismatch/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the order id is missing', async () => {
    await expect(
      razorpayService.handlePaymentLinkPaid({ payment_link: { entity: {} }, payment: { entity: { id: 'p', amount: 100, currency: 'INR' } } })
    ).rejects.toThrow(/Missing orderId/);
  });

  it('throws when the order does not exist', async () => {
    const ghost = { _id: new mongoose.Types.ObjectId(), totalAmount: 2500 };
    await expect(
      razorpayService.handlePaymentLinkPaid(linkPayload(ghost))
    ).rejects.toThrow(/Order not found/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('handlePaymentCaptured — link payments (no orderId)', () => {
  it('ignores a captured payment with no orderId instead of throwing (link payments 500ed before)', async () => {
    await expect(
      razorpayService.handlePaymentCaptured({ payment: { entity: { id: 'pay_nolink', amount: 100, currency: 'INR', notes: {} } } })
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled(); // handled by payment_link.paid, not here
  });
});
