/**
 * Delivery fees + Black Friday "Apply offer" through the REAL money path (quote →
 * order → stored snapshot). tests/unit/utils/deliveryFees.test.js pins the maths;
 * this proves the parts that only break with a real cart, order and database:
 *
 *   - fees OFF → quote and order exactly as before (shipping paid on delivery);
 *   - fees ON  → itemised lines, total = goods + fees, Razorpay amount (totalAmount) includes them;
 *   - offer on/off totals; offer requested while the event is off → not applied, order 409;
 *   - a client-sent shippingCost is ignored (tamper);
 *   - remote PIN adds the ODA fee; the order's PIN comes from its shipping address;
 *   - a product with no size falls back to its CATEGORY's class (no category → Medium);
 *   - GST-on-fees toggle; double tap = same quote, one order snapshot;
 *   - order snapshots every fee line, offer applied yes/no and the saving.
 */

import { jest } from '@jest/globals';
import { useTransactionalDb } from './helpers/replicaSet.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Coupon from '../models/Coupon.js';
import FestivalOffer from '../models/FestivalOffer.js';
import DeliveryFeeConfig from '../models/DeliveryFeeConfig.js';
import RemotePin from '../models/RemotePin.js';
import PinLocation from '../models/PinLocation.js';
import { setBlackFridayGateForTests, resetCategoryIndexForTests } from '../services/deliveryFeeService.js';
import Category from '../models/Category.js';
import pricingService, { toPublicQuote } from '../services/pricingService.js';
import orderService from '../services/orderService.js';
import { DEFAULT_RATE_CARD } from '../utils/deliveryFees.js';

jest.setTimeout(120000);

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};
const REMOTE_PIN = '735101'; // Jalpaiguri

let seq = 0;
const seedProduct = (price, over = {}) => Product.create({
  name: `Fee Prod ${++seq}`, slug: `fee-prod-${seq}-${Date.now()}`,
  description: 'Test product', price, stock: 'in', brand: 'B', isActive: true,
  shippingSize: { weightKg: 1, lengthCm: 20, breadthCm: 15, heightCm: 10 },
  shippingClass: 'small',
  ...over,
});
const seedUser = () => User.create({ name: 'U', email: `fee${++seq}${Date.now()}@x.com`, passwordHash: 'x' });

const feesOn = (over = {}) => DeliveryFeeConfig.findOneAndUpdate(
  { key: 'default' }, { $set: { chargeAtCheckout: true, ...over } }, { upsert: true, new: true, setDefaultsOnInsert: true },
);
const bfOfferOn = (over = {}) => FestivalOffer.findOneAndUpdate(
  { key: 'default' }, { $set: { waiveDeliveryFees: true, enabled: false, startsAt: null, endsAt: null, ...over } }, { upsert: true, new: true },
);

const quote = (p, extra = {}, quantity = 1) => pricingService.computeQuote({
  items: [{ product: p._id, quantity }], ...extra,
});

// The Black Friday EVENT lives in the festival theme (separate branch). Stand it in as
// "on" here; the gate itself is tested at the bottom.
beforeAll(async () => { await useTransactionalDb(); setBlackFridayGateForTests(async () => true); });
afterAll(() => setBlackFridayGateForTests(null));
afterEach(async () => {
  resetCategoryIndexForTests();
  await Promise.all([
    FestivalOffer.deleteMany({}), DeliveryFeeConfig.deleteMany({}), RemotePin.deleteMany({}),
    Coupon.deleteMany({}), PinLocation.deleteMany({}), Category.deleteMany({}),
  ]);
});

describe('fees switched OFF = exactly as today', () => {
  it('no fee block, shipping 0, total = goods; a client shippingCost is ignored', async () => {
    const p = await seedProduct(5000);
    const q = await quote(p, { deliveryPin: '400001', shippingCost: 999 });
    expect(q.deliveryFees).toBeNull();
    expect(q.shippingCost).toBe(0);
    expect(q.totalAmount).toBe(5000);

    const user = await seedUser();
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, { shippingCost: 5000 });
    const stored = await Order.findById(order._id).lean();
    expect(stored.shippingCost).toBe(0);
    expect(stored.totalAmount).toBe(5000);
    expect(stored).not.toHaveProperty('deliveryFees');
  });

  it('the Black Friday offer alone (fees off) changes nothing', async () => {
    const p = await seedProduct(5000);
    await bfOfferOn();
    const q = await quote(p, { applyDeliveryFeeOffer: true });
    expect(q.deliveryFees).toBeNull();
    expect(q.totalAmount).toBe(5000);
  });
});

describe('fees switched ON', () => {
  it('itemised lines; total = goods + fees; quote is server-computed', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const q = await quote(p, { deliveryPin: '400001' });
    const fees = q.deliveryFees;
    expect(fees.lines.map((l) => l.code)).toEqual(['shipping', 'packing', 'payment', 'gst']);
    const sum = fees.lines.reduce((a, l) => a + l.amount, 0);
    expect(fees.total).toBeCloseTo(sum, 2);
    expect(q.shippingCost).toBe(fees.total);
    expect(q.totalAmount).toBeCloseTo(5000 + fees.total, 2);
    expect(fees.offer).toMatchObject({ available: false, applied: false, saving: 0, error: null });
    // Internal fields never reach the browser.
    expect(toPublicQuote(q)).not.toHaveProperty('deliveryFeeBlock');
    expect(toPublicQuote(q)).not.toHaveProperty('orderItems');
  });

  it('remote PIN adds the ₹750 remote-area fee; an ordinary PIN does not', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await RemotePin.create({ pin: REMOTE_PIN });
    const near = await quote(p, { deliveryPin: '400001' });
    const far = await quote(p, { deliveryPin: REMOTE_PIN });
    expect(near.deliveryFees.lines.find((l) => l.code === 'remote')).toBeUndefined();
    expect(far.deliveryFees.remote).toBe(true);
    expect(far.deliveryFees.lines.find((l) => l.code === 'remote').amount).toBe(750);
    expect(far.totalAmount).toBeGreaterThan(near.totalAmount + 750); // + GST/payment fee on it
  });

  it('a product with no size and no category is charged the Medium box, flagged estimated', async () => {
    const sized = await seedProduct(5000);
    const bare = await seedProduct(5000, {
      shippingSize: { weightKg: null, lengthCm: null, breadthCm: null, heightCm: null }, shippingClass: null,
    });
    await feesOn();
    const a = await quote(bare, { deliveryPin: '400001' });
    expect(a.deliveryFees.estimated).toBe(true);
    // Medium standard box (5 kg, 50×40×30 → 13.3 kg) — not the ½ kg minimum.
    expect(a.deliveryFees.chargedKg).toBe(14);
    expect((await quote(sized, { deliveryPin: '400001' })).deliveryFees.estimated).toBe(false);
  });

  it('GST-on-fees toggle: off removes the GST line; Razorpay\'s GST then moves into the payment fee', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const on = await quote(p, { deliveryPin: '400001' });
    await feesOn({ gstOnFees: { enabled: false, percent: 18 } });
    const off = await quote(p, { deliveryPin: '400001' });
    const amt = (q, code) => q.deliveryFees.lines.find((l) => l.code === code)?.amount ?? 0;
    expect(off.deliveryFees.lines.find((l) => l.code === 'gst')).toBeUndefined();
    // On: 2% fee + one GST line. Off: 2% × 1.18 fee, no GST line. GST is never stacked.
    expect(amt(off, 'payment')).toBeGreaterThan(amt(on, 'payment'));
    expect(on.totalAmount - off.totalAmount).toBeCloseTo(amt(on, 'gst') - (amt(off, 'payment') - amt(on, 'payment')), 2);
  });

  it('a rate change prices the very next quote (no cache in the money path)', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const before = await quote(p, { deliveryPin: '400001' });
    await feesOn({ courier: { ...DEFAULT_RATE_CARD.courier, slabRate: 100 } });
    const after = await quote(p, { deliveryPin: '400001' });
    expect(after.deliveryFees.lines[0].amount).toBe(before.deliveryFees.lines[0].amount / 80 * 100);
  });

  it('no PIN yet → no fees (needsPin), total = goods; an invalid PIN is the same', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    for (const deliveryPin of [undefined, '12', 'abcdef']) {
      const q = await quote(p, { deliveryPin });
      expect(q.deliveryFees).toMatchObject({ needsPin: true, lines: [], total: 0 });
      expect(q.shippingCost).toBe(0);
      expect(q.totalAmount).toBe(5000);
    }
  });
});

describe('distance by PIN', () => {
  const HEAVY = { shippingSize: { weightKg: 100, lengthCm: 50, breadthCm: 50, heightCm: 50 }, shippingClass: 'xl' };
  const bands = [{ upToKm: 500, ratePerKg: 10 }, { upToKm: 1500, ratePerKg: 14 }, { upToKm: null, ratePerKg: 20 }];

  beforeEach(async () => {
    await PinLocation.create([
      { pin: '201301', lat: 28.57, lng: 77.32, district: 'Gautam Buddha Nagar', state: 'Uttar Pradesh' }, // Noida, ~12 km
      { pin: '500001', lat: 17.385, lng: 78.4867, district: 'Hyderabad', state: 'Telangana' },             // ~1,250 km
    ]);
  });

  it('place + km from the origin are returned and the band sets the freight ₹/kg', async () => {
    const p = await seedProduct(50000, HEAVY);
    await feesOn({ distanceBands: bands });
    const near = (await quote(p, { deliveryPin: '201301' })).deliveryFees;
    const hyd = (await quote(p, { deliveryPin: '500001' })).deliveryFees;
    expect(near.place).toEqual({ district: 'Gautam Buddha Nagar', state: 'Uttar Pradesh' });
    expect(near.distanceKm).toBeLessThan(30);
    expect(near.band).toEqual({ upToKm: 500, ratePerKg: 10, slabRate: 80 });
    expect(near.lines.find((l) => l.code === 'shipping').amount).toBe(100 * 10);
    expect(hyd.origin).toBe('Delhi');
    expect(hyd.distanceKm).toBeGreaterThan(1200);
    expect(hyd.band.ratePerKg).toBe(14);
    expect(hyd.lines.find((l) => l.code === 'shipping').amount).toBe(100 * 14);
  });

  it('a valid PIN not in the location table → highest band, no place shown', async () => {
    const p = await seedProduct(50000, HEAVY);
    await feesOn({ distanceBands: bands });
    const f = (await quote(p, { deliveryPin: '799001' })).deliveryFees;
    expect(f.place).toBeNull();
    expect(f.distanceKm).toBeNull();
    expect(f.band).toEqual({ upToKm: null, ratePerKg: 20, slabRate: 80 });
    expect(f.lines.find((l) => l.code === 'shipping').amount).toBe(100 * 20);
  });

  it('the order snapshots distance, place and band', async () => {
    const p = await seedProduct(50000, HEAVY);
    await feesOn({ distanceBands: bands });
    const user = await seedUser();
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], { ...ADDRESS, postalCode: '500001' }, {});
    const stored = await Order.findById(order._id).lean();
    expect(stored.deliveryFees).toMatchObject({
      pin: '500001', place: { district: 'Hyderabad', state: 'Telangana' }, band: { ratePerKg: 14 }, mode: 'freight',
    });
    expect(stored.deliveryFees.distanceKm).toBeGreaterThan(1200);
  });

  it('small parcels: each band\'s own ₹ per slab (saved through the model), snapshotted on the order', async () => {
    // Default product: 1 kg in a 20×15×10 box → 1 kg charged → 2 slabs of 0.5 kg.
    const p = await seedProduct(5000);
    await feesOn({ distanceBands: [
      { upToKm: 500, ratePerKg: 16, slabRate: 60 }, { upToKm: 1500, ratePerKg: 16, slabRate: 90 }, { upToKm: null, ratePerKg: 16 },
    ] });
    const near = (await quote(p, { deliveryPin: '201301' })).deliveryFees;
    const hyd = (await quote(p, { deliveryPin: '500001' })).deliveryFees;
    const unknown = (await quote(p, { deliveryPin: '799001' })).deliveryFees;
    expect(near.mode).toBe('courier');
    expect(near.lines.find((l) => l.code === 'shipping').amount).toBe(2 * 60);
    expect(hyd.lines.find((l) => l.code === 'shipping').amount).toBe(2 * 90);
    // Last band left blank → the all-India ₹80.
    expect(unknown.lines.find((l) => l.code === 'shipping').amount).toBe(2 * 80);

    const user = await seedUser();
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], { ...ADDRESS, postalCode: '500001' }, {});
    const stored = await Order.findById(order._id).lean();
    expect(stored.deliveryFees.band).toMatchObject({ upToKm: 1500, slabRate: 90 });
    expect(stored.deliveryFees.lines.find((l) => l.code === 'shipping').amount).toBe(180);
  });
});

describe('Black Friday offer', () => {
  it('applied while live: every fee → ₹0, customer pays goods only, saving = all fees', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const without = await quote(p, { deliveryPin: '400001' });
    const withOffer = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true });
    expect(without.deliveryFees.offer.available).toBe(true);
    expect(without.totalAmount).toBeCloseTo(5000 + without.deliveryFees.total, 2);
    expect(withOffer.shippingCost).toBe(0);
    expect(withOffer.totalAmount).toBe(5000);
    expect(withOffer.deliveryFees.offer).toMatchObject({ applied: true, saving: without.deliveryFees.total, error: null });
    // The itemised lines stay visible (what was saved), the CHARGE is 0.
    expect(withOffer.deliveryFees.lines).toEqual(without.deliveryFees.lines);
    expect(withOffer.freeShippingApplied).toBe(false);
  });

  it('not tapped → the customer pays the fees (owner decision)', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const q = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: false });
    expect(q.deliveryFees.offer.applied).toBe(false);
    expect(q.shippingCost).toBeGreaterThan(0);
  });

  it.each([
    ['switch never saved', null],
    ['switch off', { waiveDeliveryFees: false }],
    ['event ended', { endsAt: new Date(Date.now() - 1000) }],
    ['not started', { startsAt: new Date(Date.now() + 3600_000) }],
  ])('event off (%s) → no offer; a request for it is refused, fees charged', async (_n, over) => {
    const p = await seedProduct(5000);
    await feesOn();
    if (over) await bfOfferOn(over);
    const q = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true });
    expect(q.deliveryFees.offer).toMatchObject({ available: false, applied: false, saving: 0, error: 'offer_ended' });
    expect(q.shippingCost).toBe(q.deliveryFees.total);
  });

  it('Black Friday event not active in the theme → no offer, even with the switch on', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    setBlackFridayGateForTests(async () => false);
    try {
      const q = await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true });
      expect(q.deliveryFees.offer).toMatchObject({ available: false, applied: false, error: 'offer_ended' });
    } finally {
      setBlackFridayGateForTests(async () => true);
    }
  });

  it('the % price discount switch does not turn the fee offer on', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn({ enabled: true, waiveDeliveryFees: false });
    expect((await quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true })).deliveryFees.offer.applied).toBe(false);
  });

  it('double tap: two identical requests give the identical quote (stateless, idempotent)', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const [a, b] = await Promise.all([
      quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true }),
      quote(p, { deliveryPin: '400001', applyDeliveryFeeOffer: true }),
    ]);
    expect(toPublicQuote(a)).toEqual(toPublicQuote(b));
  });
});

describe('order creation (authoritative)', () => {
  it('snapshots fee lines, offer applied and saving; Razorpay amount = server total', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn();
    const user = await seedUser();
    const preview = await quote(p, { deliveryPin: ADDRESS.postalCode });
    const order = await orderService.createOrder(
      user._id, [{ product: p._id, quantity: 1, price: 1 }], ADDRESS,
      { applyDeliveryFeeOffer: true, shippingCost: 0, totalAmount: 1, discount: 99999 }, // tampered extras
    );
    const stored = await Order.findById(order._id).lean();
    expect(stored.totalAmount).toBe(5000);
    expect(stored.shippingCost).toBe(0);
    expect(stored.deliveryFees).toMatchObject({
      pin: '400001', remote: false, mode: 'courier', total: preview.deliveryFees.total, charged: 0,
      offer: { code: 'blackfriday', applied: true, saving: preview.deliveryFees.total },
    });
    expect(stored.deliveryFees.lines.map((l) => l.code)).toEqual(preview.deliveryFees.lines.map((l) => l.code));
  });

  it('without the offer the order is charged the fees; client shippingCost cannot lower them', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const user = await seedUser();
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, { shippingCost: 0 });
    const stored = await Order.findById(order._id).lean();
    expect(stored.shippingCost).toBeGreaterThan(0);
    expect(stored.shippingCost).toBe(stored.deliveryFees.charged);
    expect(stored.totalAmount).toBeCloseTo(5000 + stored.deliveryFees.total, 2);
    expect(stored.deliveryFees.offer.applied).toBe(false);
  });

  it('a client cannot add fees either: an inflated shippingCost is ignored', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const user = await seedUser();
    const preview = await quote(p, { deliveryPin: ADDRESS.postalCode });
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, { shippingCost: 9000 });
    expect(order.totalAmount).toBe(preview.totalAmount);
  });

  it('offer tapped but the event ended before Pay → 409 with the new fees, no order written', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await bfOfferOn({ endsAt: new Date(Date.now() - 1000) });
    const user = await seedUser();
    const before = await Order.countDocuments({ user: user._id });
    await expect(orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, { applyDeliveryFeeOffer: true }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Black Friday offer has ended/) });
    expect(await Order.countDocuments({ user: user._id })).toBe(before);
  });

  it('the remote-area fee follows the order\'s own shipping PIN', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await RemotePin.create({ pin: REMOTE_PIN });
    const user = await seedUser();
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], { ...ADDRESS, postalCode: REMOTE_PIN }, {});
    const stored = await Order.findById(order._id).lean();
    expect(stored.deliveryFees.remote).toBe(true);
    expect(stored.deliveryFees.lines.find((l) => l.code === 'remote').amount).toBe(750);
  });

  it('an invalid shipping PIN is refused while fees are on (remote fee could be missed)', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    const user = await seedUser();
    await expect(orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], { ...ADDRESS, postalCode: '12' }, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('a free-shipping coupon waives the fees and is not reported as the Black Friday offer', async () => {
    const p = await seedProduct(5000);
    await feesOn();
    await Coupon.create({ code: 'FREEDEL', type: 'free_shipping', value: 0, isActive: true });
    const q = await quote(p, { deliveryPin: '400001', couponCode: 'FREEDEL' });
    expect(q.freeShippingApplied).toBe(true);
    expect(q.shippingCost).toBe(0);
    expect(q.totalAmount).toBe(5000);
    expect(q.deliveryFees.offer.applied).toBe(false);
  });
});

/*
  Regression, 2026-11-17: the owner's cart — "Mercedes-Benz W221 S-Class to Maybach Kit
  W223 Conversion Kit", ₹5,05,000, PIN 682019 (Ernakulam). The live product had NO size
  data, only its categories, and was quoted ₹320 shipping, ₹20 packing, an uncapped
  ₹11,937.94 payment fee and ₹2,300.93 GST charged on top of Razorpay's GST.
*/
describe('Maybach conversion kit to Kochi, no size data', () => {
  const seedKit = async () => {
    const bodyKits = await Category.create({ name: 'Body Kits', slug: 'body-kits' });
    const conversion = await Category.create({ name: 'Conversion Kit', slug: 'conversion-kit', parent: bodyKits._id });
    const exterior = await Category.create({ name: 'Exterior', slug: 'exterior' });
    await PinLocation.create({ pin: '682019', lat: 9.97, lng: 76.29, district: 'Ernakulam', state: 'Kerala' });
    return seedProduct(505000, {
      name: 'Mercedes-Benz W221 S-Class to Maybach Kit W223 Conversion Kit',
      shippingSize: { weightKg: null, lengthCm: null, breadthCm: null, heightCm: null },
      shippingClass: null,
      categories: [conversion._id, exterior._id],
    });
  };
  const line = (fees, code) => fees.lines.find((l) => l.code === code)?.amount ?? 0;

  it('quotes freight in the body-kit range, payment fee ≤ ₹999, GST once', async () => {
    const kit = await seedKit();
    await feesOn();
    const fees = (await quote(kit, { deliveryPin: '682019' })).deliveryFees;

    expect(fees.place).toEqual({ district: 'Ernakulam', state: 'Kerala' });
    expect(fees.distanceKm).toBeGreaterThan(2000);
    expect(fees.mode).toBe('freight');
    expect(fees.estimated).toBe(true);
    expect(fees.chargedKg).toBe(276); // XL crate, 208×70×85
    // Docket + handling show for freight.
    expect(line(fees, 'docket')).toBe(150);
    expect(line(fees, 'handling')).toBeCloseTo(124.2, 2);
    expect(line(fees, 'shipping')).toBe(4416);
    expect(line(fees, 'packing')).toBe(1500);
    expect(line(fees, 'insurance')).toBe(0); // removed 2026-11-20 (was ₹505)
    // Capped, and no Razorpay GST stacked under our GST line.
    expect(line(fees, 'payment')).toBe(999);
    const beforeGst = fees.lines.filter((l) => l.code !== 'gst').reduce((a, l) => a + l.amount, 0);
    expect(line(fees, 'gst')).toBeCloseTo(Math.round(beforeGst * 18) / 100, 2);
    // Owner's body-kit range.
    expect(fees.total).toBeGreaterThanOrEqual(5000);
    expect(fees.total).toBeLessThanOrEqual(10000);
    expect(fees.total).toBeCloseTo(8518.66, 2);
  });

  it('the order charges the same capped fees (server recomputes, Razorpay amount includes them)', async () => {
    const kit = await seedKit();
    await feesOn();
    const user = await seedUser();
    const order = await orderService.createOrder(user._id, [{ product: kit._id, quantity: 1 }], { ...ADDRESS, postalCode: '682019' }, {});
    const stored = await Order.findById(order._id).lean();
    expect(stored.deliveryFees.lines.find((l) => l.code === 'payment').amount).toBe(999);
    expect(stored.deliveryFees.charged).toBeCloseTo(8518.66, 2);
    expect(stored.totalAmount).toBeCloseTo(505000 + 8518.66, 2);
  });

  it('a raised cap and real band rate flow straight through (admin edits, no deploy)', async () => {
    const kit = await seedKit();
    await feesOn({ paymentFeeMax: 0, distanceBands: [{ upToKm: 2000, ratePerKg: 16 }, { upToKm: null, ratePerKg: 22.5 }] });
    const fees = (await quote(kit, { deliveryPin: '682019' })).deliveryFees;
    expect(line(fees, 'shipping')).toBe(6210); // 276 kg × ₹22.50
    expect(line(fees, 'payment')).toBeGreaterThan(10000); // no cap: 2% of ₹5,05,000+
  });
});