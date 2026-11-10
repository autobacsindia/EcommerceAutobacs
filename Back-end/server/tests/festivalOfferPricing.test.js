/**
 * Festival (Diwali) price offer through the REAL money path.
 *
 * tests/festivalOffer.test.js proves the maths and the switch. This proves what only
 * breaks with a real cart, a real order and a real database:
 *
 *   - offer OFF → every quote figure is identical to a cart priced without the feature;
 *   - tier boundaries (₹49,999 / ₹50,000 / ₹1,00,000 / ₹1,00,001 / ₹2,00,000 / ₹2,00,001) as charged;
 *   - Diwali stacks ON TOP of an existing sale, tiered by the selling price;
 *   - variants are priced per variant;
 *   - cart total = Σ server line prices; a client-sent price is ignored;
 *   - the end date / off switch stop the discount being CHARGED on the next quote;
 *   - the order snapshots the offer and the Razorpay amount (totalAmount) reflects it;
 *   - coupons still apply on top, calculated on the offer price;
 *   - the staff sales panel (quotation-style list price) is untouched.
 */

import { jest } from '@jest/globals';
import { useTransactionalDb } from './helpers/replicaSet.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Coupon from '../models/Coupon.js';
import FestivalOffer from '../models/FestivalOffer.js';
import pricingService from '../services/pricingService.js';
import orderService from '../services/orderService.js';
import { priceSalesLines } from '../services/salesOrderService.js';
import { refundableForLines } from '../services/refundMathService.js';

jest.setTimeout(120000);

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

let seq = 0;
const seedProduct = (price, over = {}) => Product.create({
  name: `Offer Prod ${price} ${++seq}`, slug: `offer-prod-${seq}-${Date.now()}`,
  description: 'Test product', price, stock: 'in', brand: 'B', isActive: true, ...over,
});
const seedUser = () => User.create({
  name: 'U', email: `offer${++seq}${Date.now()}@x.com`, passwordHash: 'x',
});

const offerOn = (over = {}) => FestivalOffer.findOneAndUpdate(
  { key: 'default' },
  { $set: { enabled: true, startsAt: null, endsAt: null, ...over } },
  { upsert: true, new: true },
);
const offerOff = () => FestivalOffer.updateOne({ key: 'default' }, { $set: { enabled: false } });

const quoteFor = (lines, extra = {}) => pricingService.computeQuote({
  items: lines.map(([p, quantity = 1, variantId]) => ({ product: p._id, quantity, ...(variantId ? { variantId } : {}) })),
  ...extra,
});

beforeAll(async () => { await useTransactionalDb(); });
afterEach(async () => { await FestivalOffer.deleteMany({}); });

describe('offer OFF = prices exactly as today', () => {
  it('a quote with the switch off (or never saved) matches a quote with no offer at all', async () => {
    const a = await seedProduct(40000);
    const b = await seedProduct(120000, { originalPrice: 150000 });

    const neverSaved = await quoteFor([[a, 2], [b, 1]]);
    await offerOff();
    const switchedOff = await quoteFor([[a, 2], [b, 1]]);
    await offerOn({ endsAt: new Date(Date.now() - 1000) });
    const ended = await quoteFor([[a, 2], [b, 1]]);

    for (const q of [neverSaved, switchedOff, ended]) {
      expect(q.subtotal).toBe(200000);
      expect(q.totalAmount).toBe(200000);
      expect(q.savings).toEqual({ catalog: 30000, festival: 0, coupon: 0, karma: 0, total: 30000 });
      expect(q.festivalOfferLines).toEqual([]);
      expect(q.orderItems.map((i) => i.price)).toEqual([40000, 120000]);
      expect(q.orderItems.every((i) => i.festivalOffer === null)).toBe(true);
    }
    expect(switchedOff).toEqual(neverSaved);
  });

  it('a start date in the future is not charged yet', async () => {
    const a = await seedProduct(40000);
    await offerOn({ startsAt: new Date(Date.now() + 3600_000) });
    expect((await quoteFor([[a]])).totalAmount).toBe(40000);
  });
});

describe('offer ON — tiers as charged', () => {
  beforeEach(async () => { await offerOn(); });

  it.each([
    [49999, 44999, 10],
    [50000, 47500, 5],
    [100000, 95000, 5],
    [100001, 97000, 3],
    [200000, 194000, 3],
    [200001, 196000, 2],
  ])('₹%d is charged ₹%d (%d%%)', async (price, charged, percent) => {
    const p = await seedProduct(price);
    const q = await quoteFor([[p]]);
    expect(q.orderItems[0].price).toBe(charged);
    expect(q.orderItems[0].festivalOffer).toMatchObject({ code: 'diwali', percent, basePrice: price, priceBeforeOffer: price });
    expect(q.subtotal).toBe(charged);
    expect(q.totalAmount).toBe(charged);
    expect(q.savings.festival).toBe(price - charged);
    expect(q.festivalOfferLines).toEqual([expect.objectContaining({
      product: String(p._id), percent, basePrice: price, finalPrice: charged, discount: price - charged,
    })]);
  });

  it('stacks ON TOP of an existing sale, tiered by the selling price (Profender example)', async () => {
    // M.R.P. ₹1,40,625 → selling ₹1,12,500 (−20%) → above ₹1,00,000 → +3% Diwali.
    const profender = await seedProduct(112500, { originalPrice: 140625 });
    const q = await quoteFor([[profender]]);

    expect(q.orderItems[0].price).toBe(109125);
    expect(q.orderItems[0].festivalOffer).toEqual({
      code: 'diwali', percent: 3, basePrice: 112500, priceBeforeOffer: 112500, discount: 3375,
    });
    // The −20% sale is still reported as the catalogue saving; Diwali is the extra.
    expect(q.savings.catalog).toBe(28125);
    expect(q.savings.festival).toBe(3375);
    expect(q.savings.total).toBe(31500);
    expect(q.totalAmount).toBe(109125);
    // `onSale` still reflects the catalogue sale only (campaign tiers read it).
    expect(q.orderItems[0].onSale).toBe(true);
  });

  it('a product with no MRP gets the Diwali tier on its price and is not "on sale"', async () => {
    const plain = await seedProduct(30000);
    const q = await quoteFor([[plain]]);
    expect(q.orderItems[0].price).toBe(27000);
    expect(q.orderItems[0].onSale).toBe(false);
    expect(q.savings).toMatchObject({ catalog: 0, festival: 3000, total: 3000 });
  });

  it('an EXPIRED sale reverts to MRP first, then earns the offer on MRP', async () => {
    const p = await seedProduct(30000, { originalPrice: 40000, saleEndsAt: new Date(Date.now() - 1000) });
    const q = await quoteFor([[p]]);
    expect(q.orderItems[0].price).toBe(36000);
    expect(q.orderItems[0].festivalOffer).toMatchObject({ percent: 10, basePrice: 40000, priceBeforeOffer: 40000 });
  });

  it('variable products are tiered per variant price', async () => {
    const p = await seedProduct(0, {
      productType: 'variable',
      variants: [
        { label: 'Small', price: 40000, stock: 'in' },
        { label: 'Big', price: 110000, stock: 'in' },
      ],
    });
    const [small, big] = p.variants;
    const q = await quoteFor([[p, 1, small._id], [p, 1, big._id]]);
    expect(q.orderItems.map((i) => i.price)).toEqual([36000, 106700]);
    expect(q.orderItems.map((i) => i.festivalOffer.percent)).toEqual([10, 3]);
  });

  it('cart total = Σ server line prices × qty, and a client-sent price is ignored', async () => {
    const a = await seedProduct(20000);
    const b = await seedProduct(75000);
    const q = await pricingService.computeQuote({
      items: [
        { product: a._id, quantity: 3, price: 1, festivalOffer: { percent: 99 } },
        { product: b._id, quantity: 1, price: 1, finalPrice: 1 },
      ],
    });
    expect(q.orderItems.map((i) => i.price)).toEqual([18000, 71250]);
    const sum = q.orderItems.reduce((s, i) => s + i.price * i.quantity, 0);
    expect(q.subtotal).toBe(sum);
    expect(q.totalAmount).toBe(sum);
  });

  it('switching off stops the discount being charged on the very next quote', async () => {
    const p = await seedProduct(40000);
    expect((await quoteFor([[p]])).totalAmount).toBe(36000);
    await offerOff();
    expect((await quoteFor([[p]])).totalAmount).toBe(40000);
  });

  it('a percentage coupon applies on top, calculated on the offer price', async () => {
    const p = await seedProduct(20000);
    await Coupon.create({ code: `OFF5${++seq}`, type: 'percentage', value: 5, isActive: true });
    const code = `OFF5${seq}`;
    const q = await quoteFor([[p]], { couponCode: code });
    expect(q.couponError).toBeNull();
    expect(q.subtotal).toBe(18000);
    expect(q.couponDiscount).toBe(900);
    expect(q.totalAmount).toBe(17100);
    expect(q.savings).toMatchObject({ festival: 2000, coupon: 900, total: 2900 });
  });
});

describe('order creation snapshots the offer', () => {
  it('persists the offer on the line; totalAmount (the Razorpay amount) is the offer price', async () => {
    await offerOn();
    const user = await seedUser();
    const p = await seedProduct(60000);

    const order = await orderService.createOrder(
      user._id,
      [{ product: p._id, quantity: 2, price: 1 }],   // tampered client price → ignored
      ADDRESS,
      { shippingCost: 0, acceptTerms: true },
    );
    const stored = await Order.findById(order._id).lean();

    expect(stored.items[0].price).toBe(57000);
    expect(stored.items[0].festivalOffer).toEqual({
      code: 'diwali', percent: 5, basePrice: 60000, priceBeforeOffer: 60000, discount: 3000,
    });
    expect(stored.subtotal).toBe(114000);
    expect(stored.totalAmount).toBe(114000);

    // The record does not move when the offer ends.
    await offerOff();
    const after = await Order.findById(order._id).lean();
    expect(after.items[0]).toMatchObject({ price: 57000, festivalOffer: { percent: 5 } });

    // A returned unit refunds what was actually charged for it, not the MRP.
    const refund = refundableForLines(stored, [{ product: p._id, quantity: 1, unitPrice: 57000 }]);
    expect(refund).toEqual({ grossRupees: 57000, netRupees: 57000, discountShareRupees: 0 });
  });

  it('with the offer off, the order line carries no offer field at all', async () => {
    const user = await seedUser();
    const p = await seedProduct(60000);
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, { shippingCost: 0, acceptTerms: true });
    const stored = await Order.findById(order._id).lean();
    expect(stored.items[0].price).toBe(60000);
    expect(stored.items[0]).not.toHaveProperty('festivalOffer');
    expect(stored.totalAmount).toBe(60000);
  });
});

describe('staff sales panel / quotation-style pricing is untouched', () => {
  it('priceSalesLines still reads the catalogue price while the offer is live', async () => {
    await offerOn();
    const p = await seedProduct(40000);
    const [line] = await priceSalesLines([{ product: String(p._id), quantity: 1 }]);
    expect(line.price).toBe(40000);
    expect(line.festivalOffer).toBeUndefined();
  });

  it('priceItems without the opt-in never applies the offer', async () => {
    await offerOn();
    const p = await seedProduct(40000);
    const { orderItems, festivalSavingsPaise } = await pricingService.priceItems([{ product: p._id, quantity: 1 }]);
    expect(orderItems[0].price).toBe(40000);
    expect(orderItems[0].festivalOffer).toBeNull();
    expect(festivalSavingsPaise).toBe(0);
  });
});

describe('per-product Diwali setting through the real money path', () => {
  const NONE = { festivalOfferSetting: { mode: 'none' } };
  const custom = (percent) => ({ festivalOfferSetting: { mode: 'custom', percent } });

  it('a cart mixing all three settings prices each line by its own', async () => {
    await offerOn();
    const auto = await seedProduct(12999);
    const none = await seedProduct(12999, NONE);
    const seven = await seedProduct(12999, custom(7));

    const q = await quoteFor([[auto], [none], [seven]]);

    expect(q.orderItems.map((i) => i.price)).toEqual([11699, 12999, 12089]);
    expect(q.subtotal).toBe(36787);
    expect(q.savings.festival).toBe(1300 + 910);
    expect(q.festivalOfferLines.map((l) => l.percent)).toEqual([10, 7]);
    expect(q.orderItems[1].festivalOffer).toBeNull();
  });

  it('with the switch off or the dates over, settings do nothing', async () => {
    const none = await seedProduct(12999, NONE);
    const seven = await seedProduct(12999, custom(7));

    await offerOff();
    expect((await quoteFor([[none], [seven]])).orderItems.map((i) => i.price)).toEqual([12999, 12999]);
    await offerOn({ endsAt: new Date(Date.now() - 1000) });
    const ended = await quoteFor([[none], [seven]]);
    expect(ended.orderItems.map((i) => i.price)).toEqual([12999, 12999]);
    expect(ended.festivalOfferLines).toEqual([]);
  });

  it('a custom % stacks on an existing sale price, like the tiers do', async () => {
    await offerOn();
    const p = await seedProduct(112500, { originalPrice: 140625, ...custom(30) });
    expect((await quoteFor([[p]])).orderItems[0].price).toBe(78750);
  });

  it('the setting covers every variant', async () => {
    await offerOn();
    const p = await seedProduct(10000, {
      productType: 'variable',
      ...custom(20),
      variants: [
        { label: 'A', sku: `A${Date.now()}`, price: 10000, stock: 'in' },
        { label: 'B', sku: `B${Date.now()}`, price: 60000, stock: 'in' },
      ],
    });
    const prices = await Promise.all(p.variants.map(async (v) => (await quoteFor([[p, 1, v._id]])).orderItems[0].price));
    expect(prices).toEqual([8000, 48000]);
  });

  it('the order is charged the server price, ignores a tampered client value, and keeps its snapshot', async () => {
    await offerOn();
    const user = await seedUser();
    const p = await seedProduct(12999, custom(7));

    const order = await orderService.createOrder(
      user._id,
      [{ product: p._id, quantity: 1, price: 1, festivalOfferSetting: { mode: 'custom', percent: 30 } }],
      ADDRESS,
      { shippingCost: 0, acceptTerms: true, totalAmount: 1, festivalOfferPercent: 30 },
    );
    const stored = await Order.findById(order._id).lean();
    expect(stored.items[0].price).toBe(12089);
    expect(stored.totalAmount).toBe(12089);
    expect(stored.items[0].festivalOffer).toMatchObject({ percent: 7, priceBeforeOffer: 12999, discount: 910 });

    // Changing the product afterwards must not touch the placed order.
    await Product.updateOne({ _id: p._id }, { $set: { festivalOfferSetting: { mode: 'none' } } });
    const after = await Order.findById(order._id).lean();
    expect(after.items[0].price).toBe(12089);
    expect(after.items[0].festivalOffer.percent).toBe(7);
  });

  it('a setting changed between quote and order is caught: the order uses the new one', async () => {
    await offerOn();
    const user = await seedUser();
    const p = await seedProduct(12999, custom(20));
    expect((await quoteFor([[p]])).totalAmount).toBe(10399);

    await Product.updateOne({ _id: p._id }, { $set: { festivalOfferSetting: { mode: 'none' } } });
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, { shippingCost: 0, acceptTerms: true });
    expect((await Order.findById(order._id).lean()).totalAmount).toBe(12999);
  });

  it('coupons apply to the custom price', async () => {
    await offerOn();
    const p = await seedProduct(10000, custom(20));
    await Coupon.create({ code: 'TENOFF', type: 'percentage', value: 10, isActive: true });
    const q = await quoteFor([[p]], { couponCode: 'TENOFF' });
    expect(q.subtotal).toBe(8000);
    expect(q.couponDiscount).toBe(800);
    expect(q.totalAmount).toBe(7200);
  });

  it('the staff sales panel still ignores the offer and the setting', async () => {
    await offerOn();
    const p = await seedProduct(12999, custom(30));
    const { orderItems } = await pricingService.priceItems([{ product: p._id, quantity: 1 }]);
    expect(orderItems[0].price).toBe(12999);
  });
});

describe('quote line carries the M.R.P. for the "You save" display', () => {
  it('gives the M.R.P. on a sale line and null otherwise; the charged price is unchanged', async () => {
    await offerOn();
    const sale = await seedProduct(75000, { originalPrice: 135680 });
    const plain = await seedProduct(75000);
    const q = await quoteFor([[sale], [plain]]);
    expect(q.orderItems.map((i) => i.price)).toEqual([71250, 71250]);
    expect(q.festivalOfferLines.map((l) => l.mrp)).toEqual([135680, null]);
  });

  it('the M.R.P. is not stored on the order', async () => {
    await offerOn();
    const user = await seedUser();
    const p = await seedProduct(75000, { originalPrice: 135680 });
    const order = await orderService.createOrder(user._id, [{ product: p._id, quantity: 1 }], ADDRESS, { shippingCost: 0, acceptTerms: true });
    const stored = await Order.findById(order._id).lean();
    expect(stored.items[0]).not.toHaveProperty('catalogMrp');
    expect(stored.items[0].festivalOffer).not.toHaveProperty('mrp');
    expect(stored.totalAmount).toBe(71250);
  });
});
