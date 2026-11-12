/**
 * A status change never makes money appear or disappear.
 *
 * Regression for the 2026-11-11 order-process review. orderStatusService let an admin
 * force any status ("admins can bypass transition rules") AND wrote the payment axis
 * from the status (processing/shipped/delivered → paid, returned → refunded). Together:
 *   - a cancelled order moved back to Processing was recorded PAID with no money,
 *   - bulk "Process" on unpaid orders recorded them paid and started the team workflow,
 *   - "Returned" recorded a refund that was never sent.
 * Each case below failed before the fix.
 */

import mongoose from 'mongoose';

import Order from '../models/Order.js';
import orderStatusService from '../services/orderStatusService.js';

const ADDRESS = {
  fullName: 'Lock Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Kochi', state: 'Kerala', postalCode: '682001',
};

const seed = (over = {}) => Order.create({
  user: new mongoose.Types.ObjectId(),
  items: [{ product: new mongoose.Types.ObjectId(), name: 'P', quantity: 1, price: 1000 }],
  subtotal: 1000,
  totalAmount: 1000,
  shippingAddress: ADDRESS,
  status: 'awaiting_payment',
  paymentStatus: 'pending',
  ...over,
});

const admin = { userId: new mongoose.Types.ObjectId(), isAdmin: true, reason: 'admin_update' };
const move = (order, status, opts = admin) => orderStatusService.updateOrderStatus(String(order._id), status, opts);
const reload = (order) => Order.findById(order._id).lean();

afterEach(async () => {
  await Order.deleteMany({});
});

describe('an unpaid order cannot be moved on by hand', () => {
  it.each(['processing', 'shipped', 'delivered', 'returned'])(
    'admin: awaiting_payment (unpaid) → %s is refused, nothing is marked paid',
    async (target) => {
      const order = await seed();
      const res = await move(order, target);
      expect(res.success).toBe(false);
      const fresh = await reload(order);
      expect(fresh).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending' });
      expect(fresh.workflow?.enteredAt).toBeUndefined();
      expect(fresh.paymentVerification).toBeUndefined();
    },
  );

  it('the bulk "Process" reason is refused the same way (bulk calls this same path)', async () => {
    const order = await seed();
    const res = await move(order, 'processing', { ...admin, reason: 'bulk_admin_update' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/not been paid/);
    expect((await reload(order)).paymentStatus).toBe('pending');
  });

  it('an unpaid order can still be cancelled', async () => {
    const order = await seed();
    const res = await move(order, 'cancelled', { ...admin, reason: 'customer_request' });
    expect(res.success).toBe(true);
    expect(await reload(order)).toMatchObject({ status: 'cancelled', paymentStatus: 'pending' });
  });
});

describe('nothing leaves a closed order', () => {
  it.each(['processing', 'shipped', 'delivered', 'returned', 'awaiting_payment'])(
    'admin: cancelled → %s is refused',
    async (target) => {
      const order = await seed({ status: 'cancelled', paymentStatus: 'pending' });
      expect((await move(order, target)).success).toBe(false);
      expect(await reload(order)).toMatchObject({ status: 'cancelled', paymentStatus: 'pending' });
    },
  );

  it('admin: returned → processing is refused', async () => {
    const order = await seed({ status: 'returned', paymentStatus: 'paid' });
    expect((await move(order, 'processing')).success).toBe(false);
  });

  it('admin: delivered → processing / shipped is refused', async () => {
    const order = await seed({ status: 'delivered', paymentStatus: 'paid' });
    expect((await move(order, 'processing')).success).toBe(false);
    expect((await move(order, 'shipped')).success).toBe(false);
  });

  it('admin: processing → returned is refused (returns go through the returns flow)', async () => {
    const order = await seed({ status: 'processing', paymentStatus: 'paid' });
    expect((await move(order, 'returned')).success).toBe(false);
    expect((await reload(order)).paymentStatus).toBe('paid');
  });
});

describe('"Returned" never records a refund by itself', () => {
  it('delivered → returned keeps paymentStatus paid until a real refund lands', async () => {
    const order = await seed({ status: 'delivered', paymentStatus: 'paid' });
    const res = await move(order, 'returned', { ...admin, reason: 'return_completed' });
    expect(res.success).toBe(true);
    expect(await reload(order)).toMatchObject({ status: 'returned', paymentStatus: 'paid' });
  });
});

describe('legitimate moves still work', () => {
  it('a paid order ships and is delivered; the payment axis is untouched', async () => {
    const order = await seed({ status: 'processing', paymentStatus: 'paid' });
    expect((await move(order, 'shipped', { ...admin, reason: 'handed_to_carrier' })).success).toBe(true);
    expect((await move(order, 'delivered', { ...admin, reason: 'customer_received' })).success).toBe(true);
    expect(await reload(order)).toMatchObject({ status: 'delivered', paymentStatus: 'paid' });
  });

  it('admin: processing → delivered (handed over in store) is allowed', async () => {
    const order = await seed({ status: 'processing', paymentStatus: 'paid' });
    expect((await move(order, 'delivered')).success).toBe(true);
  });

  it('shipped → processing is only for the parcel roll-up (lost parcel), never the menu', async () => {
    const order = await seed({ status: 'shipped', paymentStatus: 'paid' });
    expect((await move(order, 'processing')).success).toBe(false);
    expect((await move(order, 'processing', { ...admin, rollUp: true })).success).toBe(true);
    expect(await reload(order)).toMatchObject({ status: 'processing', paymentStatus: 'paid' });
  });

  it('a customer (not admin) gets no corrections at all', async () => {
    const order = await seed({ status: 'processing', paymentStatus: 'paid' });
    const res = await move(order, 'delivered', { userId: order.user, isAdmin: false });
    expect(res.success).toBe(false);
  });
});

describe('who may mark an order paid', () => {
  it('a bank transfer confirmation marks it paid AND verified, once', async () => {
    const order = await seed();
    const by = new mongoose.Types.ObjectId();
    const res = await move(order, 'processing', {
      ...admin, reason: 'manual_confirmation',
      paymentVerification: { source: 'bank_transfer', reference: 'UTR123', by },
    });
    expect(res.success).toBe(true);
    const fresh = await reload(order);
    expect(fresh).toMatchObject({ status: 'processing', paymentStatus: 'paid' });
    expect(fresh.paymentVerification).toMatchObject({ source: 'bank_transfer', reference: 'UTR123' });
    expect(String(fresh.paymentVerification.verifiedBy)).toBe(String(by));
    expect(fresh.workflow.enteredAt).toBeInstanceOf(Date);
  });

  it('an unknown verification source is refused and writes nothing', async () => {
    const order = await seed();
    const res = await move(order, 'processing', { ...admin, paymentVerification: { source: 'cash' } });
    expect(res.success).toBe(false);
    expect(await reload(order)).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending' });
  });

  it('an offline sale recorded as paid is paid but NOT verified', async () => {
    const order = await seed({ source: 'offline' });
    const res = await move(order, 'processing', { ...admin, reason: 'manual_confirmation', recordedPayment: true });
    expect(res.success).toBe(true);
    const fresh = await reload(order);
    expect(fresh.paymentStatus).toBe('paid');
    expect(fresh.paymentVerification).toBeUndefined();
  });

  it('an order Razorpay already marked paid moves to processing without a new stamp', async () => {
    const verifiedAt = new Date('2026-11-01T10:00:00Z');
    const order = await seed({
      paymentStatus: 'paid',
      paymentVerification: { source: 'razorpay', reference: 'pay_X', verifiedAt },
    });
    const res = await move(order, 'processing', { userId: null, isAdmin: true, reason: 'payment_verified' });
    expect(res.success).toBe(true);
    expect((await reload(order)).paymentVerification).toMatchObject({ source: 'razorpay', reference: 'pay_X', verifiedAt });
  });
});
