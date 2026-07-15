/**
 * Sales CRM — leadSweepService.sweepAbandonedOrders tests (real in-memory Mongo).
 *
 * Covers the time-driven reconciliation the feature depends on:
 *   • an abandoned pending order past the LEAD window → "left at checkout" lead
 *   • an order past the (longer) expiry window → settled to paymentStatus 'expired'
 *     so it drops out of the operational Orders view, while still forming its lead
 *   • the expiry window is respected: a still-in-window order keeps 'pending'
 *     (never buried before payment-reconciliation has had its chance)
 */

import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Lead from '../models/Lead.js';
import { sweepAbandonedOrders } from '../services/leadSweepService.js';

const ADDRESS = {
  fullName: 'Test Buyer',
  phone: '9876543210',
  addressLine1: '1 Test St',
  city: 'Mumbai',
  state: 'MH',
  postalCode: '400001',
  country: 'India',
};

function seedOrder(overrides = {}) {
  return Order.create({
    user: new mongoose.Types.ObjectId(),
    source: 'web',
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 500, name: 'Widget' }],
    shippingAddress: ADDRESS,
    subtotal: 500,
    totalAmount: 500,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    guestEmail: 'buyer@example.com',
    ...overrides,
  });
}

// createdAt is auto-managed and immutable (timestamps: true), so backdate via the raw
// driver — a mongoose $set would be silently dropped — to simulate order age.
async function backdate(order, ms) {
  await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: new Date(Date.now() - ms) } });
}

const HOUR = 60 * 60 * 1000;

describe('leadSweepService.sweepAbandonedOrders', () => {
  const origAbandon = process.env.LEAD_ABANDONED_AFTER_MIN;
  const origExpire = process.env.LEAD_EXPIRE_AFTER_MS;

  beforeEach(() => {
    process.env.LEAD_ABANDONED_AFTER_MIN = '60'; // 1h → forms the lead
    process.env.LEAD_EXPIRE_AFTER_MS = String(24 * HOUR); // 24h → settles the order
  });
  afterEach(() => {
    if (origAbandon === undefined) delete process.env.LEAD_ABANDONED_AFTER_MIN;
    else process.env.LEAD_ABANDONED_AFTER_MIN = origAbandon;
    if (origExpire === undefined) delete process.env.LEAD_EXPIRE_AFTER_MS;
    else process.env.LEAD_EXPIRE_AFTER_MS = origExpire;
  });

  it('expires an order past the reconciliation window and forms its lead', async () => {
    const order = await seedOrder({ guestEmail: 'gone@x.com' });
    await backdate(order, 25 * HOUR); // past both windows

    const res = await sweepAbandonedOrders();

    expect(res.expired).toBe(1);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('expired');
    expect(fresh.status).toBe('awaiting_payment'); // fulfillment axis untouched
    expect(fresh.statusHistory.at(-1).reason).toBe('payment_abandoned');

    // Lead formed as "left at checkout" with the cart snapshot.
    const lead = await Lead.findOne({ identityKey: 'email:gone@x.com' }).lean();
    expect(lead.sources.map((s) => s.type)).toEqual(['payment_pending']);
    expect(lead.sources[0].snapshot.items).toHaveLength(1);
  });

  it('forms the lead but keeps the order pending while still inside the expiry window', async () => {
    const order = await seedOrder({ guestEmail: 'recent@x.com' });
    await backdate(order, 2 * HOUR); // past the 1h lead window, well within 24h expiry

    const res = await sweepAbandonedOrders();

    expect(res.expired).toBe(0);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('pending'); // NOT buried before reconciliation is done

    const lead = await Lead.findOne({ identityKey: 'email:recent@x.com' }).lean();
    expect(lead.sources.map((s) => s.type)).toEqual(['payment_pending']);
  });

  it('leaves a paid order alone', async () => {
    const order = await seedOrder({ status: 'processing', paymentStatus: 'paid', guestEmail: 'paid@x.com' });
    await backdate(order, 25 * HOUR);

    const res = await sweepAbandonedOrders();

    expect(res.scanned).toBe(0); // query only matches pending/awaiting_payment
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.paymentStatus).toBe('paid');
  });
});
