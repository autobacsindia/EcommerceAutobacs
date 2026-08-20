/**
 * Per-product tier pricing, end to end through the real money path.
 *
 * productTiers.test.js covers the pure maths. This covers what only breaks once a real
 * campaign, a real cart and a real refund are involved:
 *
 *   - a blended cart (3% / 5% / 8% / 4% / 2%) prices each line at its own rate;
 *   - Σ per-line == the order's discount, to the paise;
 *   - the on-sale ceiling is read LIVE, so an expired sale restores the full rate
 *     before the cron sweep has touched the product;
 *   - a returned line is refunded at ITS OWN rate, not the cart's blended average —
 *     the whole reason the attribution is snapshotted;
 *   - none of it disturbs an ordinary coupon or a cart-value campaign.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import Campaign from '../models/Campaign.js';
import CampaignProductTier from '../models/CampaignProductTier.js';
import Coupon from '../models/Coupon.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import pricingService from '../services/pricingService.js';
import { refundableForLines } from '../services/refundMathService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';
import { toPaise } from '../utils/money.js';

jest.setTimeout(60000);

let seq = 0;

const LADDER = [
  { code: 'bronkz', label: 'Bronkz', percent: 3 },
  { code: 'sora', label: 'Sora', percent: 5 },
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

const seedProduct = (name, over = {}) => Product.create({
  name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++seq}`,
  description: `${name} description`, price: 10000, stock: 'in', isActive: true, ...over,
});

let user, campaign, coupon;

async function seedCampaign(over = {}) {
  const code = `PTIER${++seq}`;
  campaign = await Campaign.create({
    slug: `ptier-${seq}-${Date.now()}`,
    name: 'Product Tier Test',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    requireVerifiedEmail: false,
    couponCode: code,
    maxRedemptions: 1000,
    productTiers: LADDER,
    ...over,
  });
  coupon = await Coupon.create({
    code, type: 'percentage', value: 0, visibility: 'hidden',
    campaign: campaign._id, usageLimitPerUser: 1,
  });
  return campaign;
}

const assign = (product, tierCode) => CampaignProductTier.create({
  campaign: campaign._id, product: product._id, tierCode, matchedCodes: [tierCode],
});

beforeEach(async () => {
  user = await User.create({
    name: 'Buyer', email: `ptier${++seq}${Date.now()}@x.com`,
    passwordHash: 'x', role: 'customer', isVerified: true,
  });
});

const quote = (items, extra = {}) => pricingService.computeQuote({
  items, couponCode: coupon.code, userId: String(user._id), ...extra,
});

describe('a blended cart prices each line at its own rate', () => {
  test('3% / 5% / 8% / default 4% / on-sale 2% all coexist and sum exactly', async () => {
    await seedCampaign();
    const bronkz = await seedProduct('Proman Bumper');            // 3%
    const sora = await seedProduct('Auxbeam Light Bar');          // 5%
    const thanos = await seedProduct('Profender Kit');            // 8%
    const unlisted = await seedProduct('Unlisted Widget');        // default 4%
    // Already discounted: price below its own MRP, so capped at 2% whatever its tier.
    const onSale = await seedProduct('Profender Storm Kit', { price: 10000, originalPrice: 12000 });

    await assign(bronkz, 'bronkz');
    await assign(sora, 'sora');
    await assign(thanos, 'thanos');
    await assign(onSale, 'thanos');

    const q = await quote([bronkz, sora, thanos, unlisted, onSale].map(p => ({ product: p._id, quantity: 1 })));

    const byName = Object.fromEntries(q.discountLines.map(l => [l.name, l]));
    expect(byName['Proman Bumper'].percent).toBe(3);
    expect(byName['Auxbeam Light Bar'].percent).toBe(5);
    expect(byName['Profender Kit'].percent).toBe(8);
    expect(byName['Unlisted Widget'].percent).toBe(4);
    expect(byName['Profender Storm Kit'].percent).toBe(2);

    // Five ₹10,000 lines: ₹300 + ₹500 + ₹800 + ₹400 + ₹200.
    expect(q.subtotal).toBe(50000);
    expect(q.couponDiscount).toBe(2200);
    const summed = q.discountLines.reduce((s, l) => s + l.discountPaise, 0);
    expect(summed).toBe(toPaise(q.couponDiscount));
  });

  test('the on-sale line reports WHY it was capped, and an at-rate line does not', async () => {
    await seedCampaign();
    const onSale = await seedProduct('Profender Storm Kit', { price: 10000, originalPrice: 12000 });
    const plain = await seedProduct('Profender Kit');
    await assign(onSale, 'thanos');
    await assign(plain, 'thanos');

    const q = await quote([onSale, plain].map(p => ({ product: p._id, quantity: 1 })));
    const byName = Object.fromEntries(q.discountLines.map(l => [l.name, l]));

    expect(byName['Profender Storm Kit'].alreadyOnSale).toBe(true);
    expect(byName['Profender Storm Kit'].onSaleCapped).toBe(true);
    expect(byName['Profender Kit'].alreadyOnSale).toBe(false);
    expect(byName['Profender Kit'].onSaleCapped).toBe(false);
  });

  test('quantity multiplies the line before the rate is applied', async () => {
    await seedCampaign();
    const p = await seedProduct('Profender Kit');
    await assign(p, 'thanos');

    const q = await quote([{ product: p._id, quantity: 3 }]);
    expect(q.discountLines[0].discountPaise).toBe(Math.floor(toPaise(10000) * 3 * 8 / 100));
    expect(q.couponDiscount).toBe(2400);   // 8% of ₹30,000
  });
});

describe('the on-sale ceiling is read LIVE, never from a stored flag', () => {
  test('an EXPIRED sale restores the full tier rate before the cron sweep runs', async () => {
    await seedCampaign();
    // Still carrying sale fields — the sweep has not normalized them yet — but the
    // window closed an hour ago, so effectivePrice reverts UP to originalPrice and the
    // buyer is no longer getting a discount. Capping at 2% here would rob them of the
    // 8% they are actually owed.
    const expired = await seedProduct('Profender Storm Kit', {
      price: 10000, originalPrice: 12000, saleEndsAt: new Date(Date.now() - 3600_000),
    });
    await assign(expired, 'thanos');

    const q = await quote([{ product: expired._id, quantity: 1 }]);
    expect(q.discountLines[0].alreadyOnSale).toBe(false);
    expect(q.discountLines[0].percent).toBe(8);
    // Charged at the restored MRP, and discounted 8% of THAT.
    expect(q.subtotal).toBe(12000);
    expect(q.couponDiscount).toBe(960);
  });

  test('a sale still inside its window is capped at 2%', async () => {
    await seedCampaign();
    const live = await seedProduct('Profender Storm Kit', {
      price: 10000, originalPrice: 12000, saleEndsAt: new Date(Date.now() + 3600_000),
    });
    await assign(live, 'thanos');

    const q = await quote([{ product: live._id, quantity: 1 }]);
    expect(q.discountLines[0].percent).toBe(2);
    expect(q.couponDiscount).toBe(200);
  });
});

describe('the order-wide ceiling lands on the lines', () => {
  test('apportioned per-line figures still sum to the cap exactly', async () => {
    await seedCampaign({ maxDiscountPerOrder: 500 });
    const a = await seedProduct('Profender Kit');        // 8% of ₹100 = ₹8
    const b = await seedProduct('Auxbeam Light Bar');    // 5% of ₹100 = ₹5
    await assign(a, 'thanos');
    await assign(b, 'sora');

    const q = await quote([a, b].map(p => ({ product: p._id, quantity: 1 })));

    expect(q.couponDiscount).toBe(500);
    const summed = q.discountLines.reduce((s, l) => s + l.discountPaise, 0);
    // Capping only the total would leave the parts adding to ₹13 against a ₹500 order
    // discount, and every refund would then over-pay.
    expect(summed).toBe(toPaise(500));
  });
});

describe('a returned line is refunded at ITS OWN rate', () => {
  /** The order a blended cart would have produced. */
  const blendedOrder = (lines, discountRupees) => ({
    subtotal: lines.reduce((s, l) => s + l.price * l.quantity, 0),
    discount: discountRupees,
    couponDiscount: discountRupees,
    karmaDiscount: 0,
    items: lines,
  });

  test('the 2% line refunds its own value, not the cart’s blended average', async () => {
    const cheap = new mongoose.Types.ObjectId();   // on offer → 2% → ₹2 off ₹100
    const rich = new mongoose.Types.ObjectId();    // Thanos   → 8% → ₹8 off ₹100
    const order = blendedOrder([
      { product: cheap, quantity: 1, price: 10000, discountPaise: 20000 },
      { product: rich, quantity: 1, price: 10000, discountPaise: 80000 },
    ], 1000);

    const { netRupees, discountShareRupees } =
      refundableForLines(order, [{ product: cheap, quantity: 1 }]);

    // Its own rate: ₹10,000 − ₹200 = ₹9,800.
    expect(netRupees).toBe(9800);
    expect(discountShareRupees).toBe(200);
    // Proration would have answered ₹9,500 — the cart average — refunding ₹300 that was
    // never taken off this line.
    expect(netRupees).not.toBe(9500);
  });

  test('the 8% line likewise refunds its own, larger, discount', async () => {
    const cheap = new mongoose.Types.ObjectId();
    const rich = new mongoose.Types.ObjectId();
    const order = blendedOrder([
      { product: cheap, quantity: 1, price: 10000, discountPaise: 20000 },
      { product: rich, quantity: 1, price: 10000, discountPaise: 80000 },
    ], 1000);

    const { netRupees } = refundableForLines(order, [{ product: rich, quantity: 1 }]);
    expect(netRupees).toBe(9200);
  });

  test('returning EVERY line refunds exactly the goods actually paid for', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const order = blendedOrder([
      { product: a, quantity: 1, price: 10000, discountPaise: 20000 },
      { product: b, quantity: 1, price: 10000, discountPaise: 80000 },
    ], 1000);

    const { netRupees } = refundableForLines(order, [
      { product: a, quantity: 1 }, { product: b, quantity: 1 },
    ]);
    expect(netRupees).toBe(19000);   // ₹20,000 − ₹1,000
  });

  test('a partial-quantity return takes a per-unit share of its own line', async () => {
    const p = new mongoose.Types.ObjectId();
    const order = blendedOrder(
      [{ product: p, quantity: 4, price: 10000, discountPaise: 320000 }], 3200,
    );

    // 1 of 4 units: ₹10,000 gross, a quarter of the line's ₹3,200 discount.
    const { grossRupees, netRupees, discountShareRupees } =
      refundableForLines(order, [{ product: p, quantity: 1 }]);
    expect(grossRupees).toBe(10000);
    expect(discountShareRupees).toBe(800);
    expect(netRupees).toBe(9200);
  });

  test('karma stays PRORATED — it is a whole-cart discount with no per-line meaning', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const order = {
      subtotal: 20000, discount: 1500, couponDiscount: 1000, karmaDiscount: 500,
      items: [
        { product: a, quantity: 1, price: 10000, discountPaise: 20000 },
        { product: b, quantity: 1, price: 10000, discountPaise: 80000 },
      ],
    };

    // ₹10,000 − ₹200 own coupon share − ₹250 prorated karma.
    const { netRupees } = refundableForLines(order, [{ product: a, quantity: 1 }]);
    expect(netRupees).toBe(9550);
  });

  test('never refunds more than the line was worth, even on a corrupt attribution', async () => {
    const p = new mongoose.Types.ObjectId();
    const order = blendedOrder(
      [{ product: p, quantity: 1, price: 10000, discountPaise: -5000 }], 0,
    );
    const { netRupees } = refundableForLines(order, [{ product: p, quantity: 1 }]);
    expect(netRupees).toBeLessThanOrEqual(10000);
  });
});

describe('nothing else changes', () => {
  test('an order with NO per-line attribution still prorates exactly as before', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    // A legacy order, or any ordinary-coupon order: one rate across the cart.
    const order = {
      subtotal: 20000, discount: 1000, couponDiscount: 1000, karmaDiscount: 0,
      items: [
        { product: a, quantity: 1, price: 10000 },
        { product: b, quantity: 1, price: 10000 },
      ],
    };
    const { netRupees } = refundableForLines(order, [{ product: a, quantity: 1 }]);
    expect(netRupees).toBe(9500);   // the blended half — correct when one rate applies
  });

  test('lines carrying discountPaise: 0 are NOT mistaken for an attribution', async () => {
    // Every order created since the field was added carries 0 on ordinary-coupon lines.
    // Treating that as "this line was discounted by nothing" would refund it at GROSS.
    const a = new mongoose.Types.ObjectId();
    const order = {
      subtotal: 20000, discount: 1000, couponDiscount: 1000, karmaDiscount: 0,
      items: [
        { product: a, quantity: 1, price: 10000, discountPaise: 0 },
        { product: new mongoose.Types.ObjectId(), quantity: 1, price: 10000, discountPaise: 0 },
      ],
    };
    const { netRupees } = refundableForLines(order, [{ product: a, quantity: 1 }]);
    expect(netRupees).toBe(9500);
    expect(netRupees).not.toBe(10000);
  });

  test('a campaign with a CART-VALUE ladder is untouched by any of this', async () => {
    await seedCampaign({
      productTiers: undefined,
      tiers: [{ id: 'flat20', label: 'Flat 20', minCartValue: 0, percent: 20 }],
    });
    const p = await seedProduct('Anything');

    const q = await quote([{ product: p._id, quantity: 1 }]);
    expect(q.couponDiscount).toBe(2000);
    expect(q.discountLines).toBeNull();
    expect(q.appliedCampaign.percent).toBe(20);
  });

  test('a plain coupon with no campaign is untouched', async () => {
    const plain = await Coupon.create({
      code: `PLAIN${++seq}`, type: 'percentage', value: 10, visibility: 'hidden',
    });
    const p = await seedProduct('Anything');

    const q = await pricingService.computeQuote({
      items: [{ product: p._id, quantity: 1 }],
      couponCode: plain.code,
      userId: String(user._id),
    });
    expect(q.couponDiscount).toBe(1000);
    expect(q.discountLines).toBeNull();
  });
});

describe('the client is never trusted', () => {
  test('a tampered price on the incoming item is ignored', async () => {
    await seedCampaign();
    const p = await seedProduct('Profender Kit');
    await assign(p, 'thanos');

    const q = await quote([{ product: p._id, quantity: 1, price: 1, percent: 99 }]);
    expect(q.subtotal).toBe(10000);
    expect(q.discountLines[0].percent).toBe(8);
    expect(q.couponDiscount).toBe(800);
  });

  test('an assignment belonging to ANOTHER campaign does not price this one', async () => {
    await seedCampaign();
    const p = await seedProduct('Profender Kit');
    // Assigned under a different campaign — membership is campaign-scoped, so this cart
    // must fall back to the default tier rather than pick up a foreign 8%.
    await CampaignProductTier.create({
      campaign: new mongoose.Types.ObjectId(), product: p._id,
      tierCode: 'thanos', matchedCodes: ['thanos'],
    });

    const q = await quote([{ product: p._id, quantity: 1 }]);
    expect(q.discountLines[0].tierCode).toBe('ismpor');
    expect(q.discountLines[0].percent).toBe(4);
  });
});

describe('the savings figures the celebration popup shows', () => {
  test('separates what the catalogue already saved from what the coupon added', async () => {
    await seedCampaign();
    // ₹2,000 already off MRP, before any code is typed.
    const onSale = await seedProduct('Profender Storm Kit', { price: 10000, originalPrice: 12000 });
    const plain = await seedProduct('Profender Kit');
    await assign(onSale, 'thanos');
    await assign(plain, 'thanos');

    const q = await quote([onSale, plain].map(p => ({ product: p._id, quantity: 1 })));

    expect(q.savings.catalog).toBe(2000);          // MRP − paid
    expect(q.savings.coupon).toBe(1000);           // 2% of ₹10k + 8% of ₹10k
    expect(q.savings.karma).toBe(0);
    // The honest headline: quoting only the coupon would under-sell a cart of
    // already-discounted goods.
    expect(q.savings.total).toBe(3000);
  });

  test('an EXPIRED sale contributes no catalogue saving — nothing is being saved', async () => {
    await seedCampaign();
    const expired = await seedProduct('Profender Storm Kit', {
      price: 10000, originalPrice: 12000, saleEndsAt: new Date(Date.now() - 3600_000),
    });
    await assign(expired, 'thanos');

    const q = await quote([{ product: expired._id, quantity: 1 }]);
    expect(q.savings.catalog).toBe(0);
    expect(q.savings.coupon).toBe(960);            // 8% of the restored ₹12,000
    expect(q.savings.total).toBe(960);
  });

  test('quantity multiplies the catalogue saving', async () => {
    await seedCampaign();
    const onSale = await seedProduct('Profender Storm Kit', { price: 10000, originalPrice: 12000 });
    await assign(onSale, 'thanos');

    const q = await quote([{ product: onSale._id, quantity: 3 }]);
    expect(q.savings.catalog).toBe(6000);
  });

  test('a cart with no coupon still reports what the catalogue saved', async () => {
    await seedCampaign();
    const onSale = await seedProduct('Profender Storm Kit', { price: 10000, originalPrice: 12000 });

    const q = await pricingService.computeQuote({
      items: [{ product: onSale._id, quantity: 1 }], userId: String(user._id),
    });
    expect(q.savings.catalog).toBe(2000);
    expect(q.savings.coupon).toBe(0);
    expect(q.savings.total).toBe(2000);
  });
});
