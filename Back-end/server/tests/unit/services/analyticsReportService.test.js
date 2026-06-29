import { jest } from '@jest/globals';
import mongoose from 'mongoose';

import Product from '../../../models/Product.js';
import Category from '../../../models/Category.js';
import User from '../../../models/User.js';
import Order from '../../../models/Order.js';
import Payment from '../../../models/Payment.js';
import KarmaLedger from '../../../models/KarmaLedger.js';
import CouponRedemption from '../../../models/CouponRedemption.js';
import cacheService from '../../../services/cacheService.js';
import svc from '../../../services/analyticsReportService.js';
import { resolvePeriod } from '../../../utils/analyticsPeriod.js';

const oid = () => new mongoose.Types.ObjectId();

// Window: Feb 2026. IN = inside, PREV = inside the previous (Jan) window.
const FROM = '2026-02-01T00:00:00.000Z';
const TO = '2026-02-28T00:00:00.000Z';
const IN = new Date('2026-02-15T10:00:00.000Z');
const PREV = new Date('2026-01-15T10:00:00.000Z');
const window = resolvePeriod({ from: FROM, to: TO });

let catA, catB, P1, P2, P3, U1, U2;

beforeEach(async () => {
  // Bypass the cache so each assertion hits the real aggregation deterministically.
  jest.spyOn(cacheService, 'wrap').mockImplementation((_key, fn) => fn());

  catA = await Category.create({ name: 'Brakes', slug: 'brakes' });
  catB = await Category.create({ name: 'Filters', slug: 'filters' });

  [P1, P2, P3] = await Promise.all([
    Product.create({ name: 'Pad', slug: 'pad', description: 'Brake pad', price: 100, brand: 'Bosch', brandSlug: 'bosch', categories: [catA._id], stock: 'in', isActive: true }),
    Product.create({ name: 'Filter', slug: 'filter', description: 'Oil filter', price: 50, brand: 'Bosch', brandSlug: 'bosch', categories: [catB._id], stock: 'low', isActive: true }),
    Product.create({ name: 'Plug', slug: 'plug', description: 'Spark plug', price: 300, brand: 'Denso', brandSlug: 'denso', categories: [catA._id], stock: 'out', isActive: true }),
  ]);

  U1 = oid();
  U2 = oid();
  await User.collection.insertMany([
    { _id: U1, name: 'Cust One', email: 'c1@x.com', role: 'customer', createdAt: IN, updatedAt: IN },
    { _id: U2, name: 'Cust Two', email: 'c2@x.com', role: 'customer', createdAt: IN, updatedAt: IN },
    { _id: oid(), name: 'Boss', email: 'a@x.com', role: 'admin', createdAt: IN, updatedAt: IN },
  ]);

  const O1 = oid();
  const O3 = oid();
  await Order.collection.insertMany([
    // O1 — delivered, U1, two line items, coupon+karma discount, MH/Mumbai, has SLA metrics
    {
      _id: O1, user: U1, status: 'delivered', source: 'web',
      items: [
        { product: P1._id, quantity: 2, price: 100, name: 'Pad' },
        { product: P2._id, quantity: 1, price: 50, name: 'Filter' },
      ],
      shippingAddress: { state: 'MH', city: 'Mumbai' },
      subtotal: 250, totalAmount: 230, couponDiscount: 10, karmaDiscount: 10, couponCode: 'SAVE',
      fulfillmentMetrics: { deliveredAt: IN, timeToShip: 5, timeToDeliver: 20 },
      createdAt: IN, updatedAt: IN,
    },
    // O2 — confirmed, U1 again (=> returning), MH
    {
      _id: oid(), user: U1, status: 'confirmed', source: 'web',
      items: [{ product: P1._id, quantity: 1, price: 100, name: 'Pad' }],
      shippingAddress: { state: 'MH', city: 'Pune' },
      subtotal: 100, totalAmount: 100, couponDiscount: 0, karmaDiscount: 0,
      createdAt: IN, updatedAt: IN,
    },
    // O3 — shipped, U2, has return + refund, KA/Bangalore
    {
      _id: O3, user: U2, status: 'shipped', source: 'web',
      items: [{ product: P3._id, quantity: 1, price: 300, name: 'Plug' }],
      shippingAddress: { state: 'KA', city: 'Bangalore' },
      subtotal: 300, totalAmount: 300, couponDiscount: 0, karmaDiscount: 0,
      returnRequest: { requestedAt: IN, reason: 'defective', status: 'pending' },
      refundDetails: { requestedAt: IN, amount: 300, refundMethod: 'original_payment', status: 'pending' },
      createdAt: IN, updatedAt: IN,
    },
    // O4 — cancelled (NOT a sale): must be excluded from revenue/customers
    {
      _id: oid(), user: U2, status: 'cancelled', source: 'web',
      items: [{ product: P3._id, quantity: 1, price: 999, name: 'Plug' }],
      shippingAddress: { state: 'KA', city: 'Bangalore' },
      subtotal: 999, totalAmount: 999, createdAt: IN, updatedAt: IN,
    },
    // O5 — delivered but in the PREVIOUS window (for delta math)
    {
      _id: oid(), user: U1, status: 'delivered', source: 'web',
      items: [{ product: P1._id, quantity: 5, price: 100, name: 'Pad' }],
      shippingAddress: { state: 'MH', city: 'Mumbai' },
      subtotal: 500, totalAmount: 500, createdAt: PREV, updatedAt: PREV,
    },
  ]);

  await Payment.collection.insertMany([
    { _id: oid(), order: O1, user: U1, amount: 230, currency: 'INR', paymentMethod: 'upi', paymentGateway: 'razorpay', status: 'completed', createdAt: IN, updatedAt: IN },
    { _id: oid(), order: O3, user: U2, amount: 300, currency: 'INR', paymentMethod: 'cod', paymentGateway: 'razorpay', status: 'failed', createdAt: IN, updatedAt: IN },
  ]);

  await CouponRedemption.collection.insertMany([
    { _id: oid(), coupon: oid(), user: U1, order: O1, code: 'SAVE', discountAmount: 10, createdAt: IN, updatedAt: IN },
  ]);

  await KarmaLedger.collection.insertMany([
    { _id: oid(), user: U1, type: 'earn', points: 100, balanceAfter: 100, order: O1, createdAt: IN, updatedAt: IN },
    { _id: oid(), user: U1, type: 'redeem', points: -20, balanceAfter: 80, order: O1, createdAt: IN, updatedAt: IN },
  ]);
});

describe('getSalesTrends', () => {
  it('sums realised revenue, excludes cancelled, and computes period delta', async () => {
    const out = await svc.getSalesTrends(window);
    expect(out.totals.revenue).toBe(630); // 230 + 100 + 300 (cancelled 999 excluded)
    expect(out.totals.orders).toBe(3);
    expect(out.previous.revenue).toBe(500); // O5
    expect(out.deltas.revenuePct).toBe(26); // (630-500)/500
    expect(out.series.length).toBeGreaterThan(0);
  });
});

describe('getRevenueBreakdown', () => {
  it('attributes revenue to categories and brands', async () => {
    const out = await svc.getRevenueBreakdown(window);
    const brakes = out.byCategory.find((c) => c.name === 'Brakes');
    const filters = out.byCategory.find((c) => c.name === 'Filters');
    expect(brakes.revenue).toBe(600); // P1: 200+100, P3: 300
    expect(filters.revenue).toBe(50);
    const bosch = out.byBrand.find((b) => b.name === 'Bosch');
    const denso = out.byBrand.find((b) => b.name === 'Denso');
    expect(bosch.revenue).toBe(350);
    expect(denso.revenue).toBe(300);
  });
});

describe('getProductPerformance', () => {
  it('ranks products and reports the active stock mix', async () => {
    const out = await svc.getProductPerformance(window);
    expect(out.topByRevenue[0].revenue).toBeGreaterThanOrEqual(out.topByRevenue[1].revenue);
    expect(out.stock).toEqual({ in: 1, low: 1, out: 1 });
  });
});

describe('getCustomerInsights', () => {
  it('splits new vs returning on realised orders only', async () => {
    const out = await svc.getCustomerInsights(window);
    expect(out.activeCustomers).toBe(2);
    expect(out.returningCustomers).toBe(1); // U1 has 2 sale orders
    expect(out.newCustomers).toBe(1);
    expect(out.repeatRatePct).toBe(50);
  });
});

describe('getGeoDistribution', () => {
  it('groups orders by state', async () => {
    const out = await svc.getGeoDistribution(window);
    const mh = out.byState.find((s) => s.state === 'MH');
    const ka = out.byState.find((s) => s.state === 'KA');
    expect(mh.revenue).toBe(330); // 230 + 100
    expect(ka.revenue).toBe(300);
  });
});

describe('getLoyaltyAndCoupons', () => {
  it('aggregates coupon use, karma velocity and discount impact', async () => {
    const out = await svc.getLoyaltyAndCoupons(window);
    expect(out.coupons.totalUses).toBe(1);
    expect(out.coupons.totalDiscount).toBe(10);
    expect(out.karma.earned).toBe(100);
    expect(out.karma.redeemed).toBe(20);
    expect(out.discountImpact.gross).toBe(650); // sum of subtotals on sale orders
    expect(out.discountImpact.totalDiscount).toBe(20);
  });
});

describe('getReturnsAndPayments', () => {
  it('computes return rate, refund methods, payment mix and SLA', async () => {
    const out = await svc.getReturnsAndPayments(window);
    expect(out.returns.total).toBe(1);
    expect(out.returns.reasons[0]).toEqual({ reason: 'defective', count: 1 });
    expect(out.refunds.methods[0].method).toBe('original_payment');
    expect(out.payments.length).toBe(2);
    expect(out.fulfillment.avgTimeToShipHours).toBe(5);
    expect(out.fulfillment.avgTimeToDeliverHours).toBe(20);
    expect(out.fulfillment.deliveredCount).toBe(1);
  });
});

describe('getOverview', () => {
  it('returns KPI values with period-over-period deltas', async () => {
    const out = await svc.getOverview(window);
    expect(out.revenue.value).toBe(630);
    expect(out.revenue.deltaPct).toBe(26);
    expect(out.orders.value).toBe(3);
  });

  it('handles an empty window gracefully', async () => {
    const empty = resolvePeriod({ from: '2030-01-01', to: '2030-01-15' });
    const out = await svc.getOverview(empty);
    expect(out.revenue.value).toBe(0);
    expect(out.revenue.deltaPct).toBeNull();
  });
});
