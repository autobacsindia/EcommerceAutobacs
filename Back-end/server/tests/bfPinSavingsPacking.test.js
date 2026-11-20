/**
 * Sachin's four Black Friday checkout changes (2026-11-20), through the REAL money path
 * (quote → order → stored snapshot):
 *
 *   1. PIN first — the offer is never applied without a valid PIN (`pin_required`), and an
 *      order cannot be placed without one.
 *   2. Savings breakdown — "Shipping & fees waived" + "Discount"
 *      (MRP − price, coupon …) = "Total savings", server-computed and snapshotted.
 *   3. Insurance is gone — no line, no charge; fees + goods still equal the total.
 *   4. Packing — a product's own packing fee replaces its size-class rate.
 */
import { jest } from '@jest/globals';
import { useTransactionalDb } from './helpers/replicaSet.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import FestivalOffer from '../models/FestivalOffer.js';
import DeliveryFeeConfig from '../models/DeliveryFeeConfig.js';
import { setBlackFridayGateForTests, resetCategoryIndexForTests, OFFER_ERROR } from '../services/deliveryFeeService.js';
import pricingService from '../services/pricingService.js';
import orderService from '../services/orderService.js';
import { FEE_CODES } from '../utils/deliveryFees.js';
import Coupon from '../models/Coupon.js';
import { cardFeeWaivers, MAX_CARD_FEE_IDS } from '../services/deliveryFeeService.js';
import { deliveryFeeBreakdown } from '../utils/deliveryFeeBreakdown.js';

jest.setTimeout(120000);

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

let seq = 0;
const seedProduct = (price, over = {}) => Product.create({
  name: `BF Prod ${++seq}`, slug: `bf-prod-${seq}-${Date.now()}`,
  description: 'Test product', price, stock: 'in', brand: 'B', isActive: true,
  shippingSize: { weightKg: 1, lengthCm: 20, breadthCm: 15, heightCm: 10 },
  shippingClass: 'small',
  ...over,
});
const seedUser = () => User.create({ name: 'U', email: `bf${++seq}${Date.now()}@x.com`, passwordHash: 'x' });
const feesOn = (over = {}) => DeliveryFeeConfig.findOneAndUpdate(
  { key: 'default' }, { $set: { chargeAtCheckout: true, ...over } }, { upsert: true, new: true, setDefaultsOnInsert: true },
);
const bfOfferOn = () => FestivalOffer.findOneAndUpdate(
  { key: 'default' }, { $set: { waiveDeliveryFees: true, enabled: false, startsAt: null, endsAt: null } }, { upsert: true, new: true },
);
const quote = (p, extra = {}, quantity = 1) => pricingService.computeQuote({ items: [{ product: p._id, quantity }], ...extra });
const line = (fees, code) => fees.lines.find((l) => l.code === code)?.amount;

beforeAll(async () => { await useTransactionalDb(); setBlackFridayGateForTests(async () => true); });
afterAll(() => setBlackFridayGateForTests(null));
afterEach(async () => {
  resetCategoryIndexForTests();
  await Promise.all([FestivalOffer.deleteMany({}), DeliveryFeeConfig.deleteMany({}), Coupon.deleteMany({})]);
});

describe('1. PIN first', () => {
  it('offer tapped with no PIN → not applied, pin_required, nothing waived', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const q = await quote(p, { applyDeliveryFeeOffer: true });
    expect(q.deliveryFees.needsPin).toBe(true);
    expect(q.deliveryFees.offer).toMatchObject({ requested: true, applied: false, error: OFFER_ERROR.PIN_REQUIRED });
    expect(q.savings.deliveryFees).toBe(0);
  });

  it('an invalid PIN is the same as none', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const q = await quote(p, { deliveryPin: '012345', applyDeliveryFeeOffer: true });
    expect(q.deliveryFees.offer).toMatchObject({ applied: false, error: OFFER_ERROR.PIN_REQUIRED });
  });

  it('with a valid PIN the offer applies (no error)', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const q = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true });
    expect(q.deliveryFees.offer).toMatchObject({ applied: true, error: null });
    expect(q.totalAmount).toBe(5000);
  });

  it('an order with the offer but no valid PIN is refused (400, not the "offer ended" 409), nothing written', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const user = await seedUser();
    const before = await Order.countDocuments();
    await expect(orderService.createOrder(
      user._id, [{ product: p._id, quantity: 1 }], { ...ADDRESS, postalCode: '12' }, { applyDeliveryFeeOffer: true },
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/PIN/) });
    expect(await Order.countDocuments()).toBe(before);
  });
});

describe('2. savings breakdown', () => {
  it('discount (MRP − price) + delivery fees waived = total savings, all server-computed', async () => {
    const p = await seedProduct(50000, { originalPrice: 55000 });
    await feesOn();
    await bfOfferOn();
    const q = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true });
    expect(q.savings.discount).toBe(5000);
    expect(q.savings.deliveryFees).toBe(q.deliveryFees.offer.saving);
    expect(q.savings.deliveryFees).toBeGreaterThan(0);
    expect(q.savings.total).toBeCloseTo(q.savings.discount + q.savings.deliveryFees, 2);
  });

  it('offer not applied → no delivery saving; total = discount only', async () => {
    const p = await seedProduct(50000, { originalPrice: 55000 });
    await feesOn();
    await bfOfferOn();
    const q = await quote(p, { deliveryPin: '400001' });
    expect(q.savings).toMatchObject({ discount: 5000, deliveryFees: 0, total: 5000 });
  });

  it('the order snapshots the same savings, and Razorpay amount = server total', async () => {
    const p = await seedProduct(50000, { originalPrice: 55000 });
    await feesOn();
    await bfOfferOn();
    const user = await seedUser();
    const preview = await quote(p, { deliveryPin: ADDRESS.postalCode, applyDeliveryFeeOffer: true });
    const order = await orderService.createOrder(
      user._id, [{ product: p._id, quantity: 1, price: 1 }], ADDRESS, { applyDeliveryFeeOffer: true, totalAmount: 1 },
    );
    const stored = await Order.findById(order._id).lean();
    expect(stored.totalAmount).toBe(50000);
    expect(stored.savings).toEqual({
      discount: preview.savings.discount, deliveryFees: preview.savings.deliveryFees, total: preview.savings.total,
    });
  });
});

describe('3. insurance removed', () => {
  it('no insurance line in the quote, the fee codes or the order; goods + fees = total', async () => {
    expect(FEE_CODES).not.toContain('insurance');
    const p = await seedProduct(100000);
    await feesOn();
    const user = await seedUser();
    const q = await quote(p, { deliveryPin: '400001' });
    expect(q.deliveryFees.lines.map((l) => l.code)).not.toContain('insurance');
    const feesSum = q.deliveryFees.lines.reduce((s, l) => s + l.amount, 0);
    expect(q.deliveryFees.total).toBeCloseTo(feesSum, 2);
    expect(q.totalAmount).toBeCloseTo(100000 + q.deliveryFees.total, 2);
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, {});
    const stored = await Order.findById(order._id).lean();
    expect(stored.deliveryFees.lines.map((l) => l.code)).not.toContain('insurance');
    expect(stored.totalAmount).toBeCloseTo(q.totalAmount, 2);
  });

  it('an old saved rate card that still holds insurancePercent charges nothing for it', async () => {
    const p = await seedProduct(100000);
    await DeliveryFeeConfig.collection.updateOne(
      { key: 'default' }, { $set: { chargeAtCheckout: true, insurancePercent: 5 } }, { upsert: true },
    );
    const q = await quote(p, { deliveryPin: '400001' });
    expect(q.deliveryFees.lines.map((l) => l.code)).not.toContain('insurance');
  });
});

describe('4. per-product packing fee', () => {
  it('a product\'s own packing fee replaces the size-class rate (per unit)', async () => {
    const plain = await seedProduct(20000, { shippingClass: 'large', shippingSize: undefined });
    const profender = await seedProduct(20000, { shippingClass: 'large', shippingSize: undefined, packingFee: 2500 });
    await feesOn();
    const a = await quote(plain, { deliveryPin: '400001' });
    const b = await quote(profender, { deliveryPin: '400001' }, 2);
    expect(line(a.deliveryFees, 'packing')).toBe(500);    // large class rate
    expect(line(b.deliveryFees, 'packing')).toBe(5000);   // ₹2,500 × 2
  });

  it('packingFee 0 means free packing; null falls back to the class rate', async () => {
    const zero = await seedProduct(20000, { shippingClass: 'large', shippingSize: undefined, packingFee: 0 });
    await feesOn();
    expect(line((await quote(zero, { deliveryPin: '400001' })).deliveryFees, 'packing') ?? 0).toBe(0);
  });
});

describe('1b. PIN first for free-delivery coupons (their value IS the delivery fees)', () => {
  const freeShip = (code = `FREESHIP${++seq}`) => Coupon.create({ code, type: 'free_shipping', value: 0 });

  it('no PIN → refused with pin_required, nothing waived, coupon not applied', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const c = await freeShip();
    const q = await quote(p, { couponCode: c.code });
    expect(q.couponErrorCode).toBe(OFFER_ERROR.PIN_REQUIRED);
    expect(q.couponError).toMatch(/PIN code first/);
    expect(q.appliedCoupon).toBeNull();
    expect(q.freeShippingApplied).toBe(false);
  });

  it('with a PIN → applied, fees waived', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const c = await freeShip();
    const q = await quote(p, { couponCode: c.code, deliveryPin: '400001' });
    expect(q.couponError).toBeNull();
    expect(q.freeShippingApplied).toBe(true);
    expect(q.shippingCost).toBe(0);
    expect(q.savings.deliveryFees).toBe(q.deliveryFees.total);
  });

  it('a ₹/% coupon does not depend on delivery and still applies without a PIN', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const c = await Coupon.create({ code: `TEN${++seq}`, type: 'percentage', value: 10 });
    const q = await quote(p, { couponCode: c.code });
    expect(q.couponError).toBeNull();
    expect(q.couponDiscount).toBe(500);
  });

  it('fees switched off → the free-delivery coupon is not blocked (nothing to price)', async () => {
    const p = await seedProduct(5000);
    const c = await freeShip();
    const q = await quote(p, { couponCode: c.code });
    expect(q.couponErrorCode).not.toBe(OFFER_ERROR.PIN_REQUIRED);
  });

  it('checkout with the coupon and no valid PIN → 400, no order written', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const c = await freeShip();
    const user = await seedUser();
    const before = await Order.countDocuments();
    await expect(orderService.createOrder(
      user._id, [{ product: p._id, quantity: 1 }], { ...ADDRESS, postalCode: '12' }, { couponCode: c.code },
    )).rejects.toMatchObject({ statusCode: 400 });
    expect(await Order.countDocuments()).toBe(before);
  });
});

describe('2b. coupon changes after the offer is applied re-price from the server', () => {
  it('adding then removing a ₹ coupon moves the discount line; fees waived stay the same', async () => {
    const p = await seedProduct(50000, { originalPrice: 55000 });
    await feesOn();
    await bfOfferOn();
    const c = await Coupon.create({ code: `FLAT${++seq}`, type: 'fixed', value: 1000 });
    const withC = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true, couponCode: c.code });
    const without = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true });
    expect(withC.savings.discount - without.savings.discount).toBe(1000);
    expect(withC.savings.total).toBeCloseTo(withC.savings.discount + withC.savings.deliveryFees, 2);
    expect(withC.totalAmount).toBe(49000);
  });
});

describe('3b. old orders that carried insurance still display it', () => {
  it('the snapshot line is shown as stored, and fees add up to what was charged', () => {
    const view = deliveryFeeBreakdown({
      totalAmount: 10368,
      deliveryFees: {
        lines: [
          { code: 'shipping', label: 'Shipping fee', amount: 300 },
          { code: 'insurance', label: 'Insurance fee', amount: 10 },
          { code: 'gst', label: 'GST on fees', amount: 58 },
        ],
        total: 368, charged: 368, offer: { applied: false, saving: 0 },
      },
    });
    expect(view.lines.map((l) => l.label)).toContain('Insurance fee');
    expect(view.payable.total).toBeCloseTo(10368, 2);
  });
});

describe('5. product-card fee waiver (Save ₹X+)', () => {
  it('offer off → live false, nothing computed', async () => {
    const p = await seedProduct(20000);
    await feesOn();
    expect(await cardFeeWaivers([String(p._id)])).toEqual({ live: false, products: {} });
  });

  it('fees switched off → live false even with the offer on', async () => {
    const p = await seedProduct(20000);
    await bfOfferOn();
    expect((await cardFeeWaivers([String(p._id)])).live).toBe(false);
  });

  it('equals the checkout fee total at the cheapest band (a floor every PIN reaches), lines add up', async () => {
    const p = await seedProduct(20000, { originalPrice: 23000, shippingClass: 'large', shippingSize: undefined });
    await feesOn();
    await bfOfferOn();
    const { live, products } = await cardFeeWaivers([String(p._id)]);
    expect(live).toBe(true);
    const w = products[String(p._id)];
    expect(w.discount).toBe(3000);
    expect(w.total).toBeGreaterThan(0);
    expect(w.shipping + w.packing + w.handling + w.other).toBeCloseTo(w.total, 2);
    expect(w.save).toBeCloseTo(w.discount + w.total, 2);
    // Every real PIN costs at least the card's figure.
    for (const pin of ['110001', '400001', '560001']) {
      const q = await quote(p, { deliveryPin: pin });
      expect(q.deliveryFees.total).toBeGreaterThanOrEqual(w.total - 0.01);
    }
  });

  it('follows the per-product packing fee (point 4) automatically', async () => {
    const a = await seedProduct(20000, { shippingClass: 'large', shippingSize: undefined });
    const b = await seedProduct(20000, { shippingClass: 'large', shippingSize: undefined, packingFee: 2500 });
    await feesOn();
    await bfOfferOn();
    const { products } = await cardFeeWaivers([String(a._id), String(b._id)]);
    expect(products[String(a._id)].packing).toBe(500);
    expect(products[String(b._id)].packing).toBe(2500);
  });

  it('skips sold-out, inactive and invalid ids; caps the id list', async () => {
    const out = await seedProduct(20000, { stock: 'out' });
    const off = await seedProduct(20000, { isActive: false });
    const ok = await seedProduct(20000);
    await feesOn();
    await bfOfferOn();
    const many = Array.from({ length: MAX_CARD_FEE_IDS + 5 }, () => String(ok._id));
    const { products } = await cardFeeWaivers([String(out._id), String(off._id), 'not-an-id', ...many]);
    expect(Object.keys(products)).toEqual([String(ok._id)]);
  });
});
