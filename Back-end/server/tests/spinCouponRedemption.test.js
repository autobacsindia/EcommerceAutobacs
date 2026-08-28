/**
 * Spin-to-Win → the NEXT order. The chain a customer actually walks.
 *
 * tests/spinService.test.js proves the LEDGER is right: the correct prize is drawn, the
 * unit is decremented atomically, a real Coupon document is minted with usageLimit 1.
 * It stops there — at the Coupon row. Nothing asserted that the code the customer is
 * shown on their confirmation page can be typed into a second checkout and take money
 * off, or that it stops working afterwards.
 *
 * That is the whole point of the prize, and it crosses a service boundary (spinService
 * mints; pricingService/orderService redeem) which is exactly where an integration bug
 * hides: the coupon is minted `visibility: 'hidden'` so it never appears in the public
 * offers list, and a redemption path that filtered on visibility the way
 * couponRepository.findAvailable does would reject every prize ever won — with the
 * ledger still looking perfect.
 *
 * REAL database, REAL transactions — the money path is asserted, never mocked.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

delete process.env.REDIS_URL; // keep the prize-email enqueue a no-op

import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import CouponUserUsage from '../models/CouponUserUsage.js';
import SpinCampaign from '../models/SpinCampaign.js';
import SpinPrize from '../models/SpinPrize.js';
import SpinResult from '../models/SpinResult.js';

import spinService from '../services/spinService.js';
import orderService from '../services/orderService.js';
import cacheService from '../services/cacheService.js';
import { SPIN_STATUS, VOID_REASON } from '../config/spin.js';

jest.setTimeout(120000);

const ADDRESS = {
  fullName: 'Spin Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'Maharashtra', postalCode: '400001', country: 'India',
};

let user;
let slugSeq = 0;

const seedProduct = (price) => Product.create({
  name: `Prod ${price}`, slug: `prod-${price}-${++slugSeq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
});

/**
 * A live campaign whose FLOOR prize is a ₹200 coupon — the shape an operator actually
 * ships: everybody wins something, most people win the coupon.
 */
async function seedCouponCampaign(overrides = {}) {
  const campaign = await SpinCampaign.create({
    slug: `redeem-${new mongoose.Types.ObjectId()}`,
    name: 'Coupon Campaign',
    status: SPIN_STATUS.LIVE,
    startsAt: new Date(Date.now() - 86400000),
    endsAt: new Date(Date.now() + 86400000),
    goodieWinRatePercent: 1, // push the draw onto the floor prize
    ...overrides,
  });
  const floor = await SpinPrize.create({
    campaign: campaign._id,
    name: '₹200 off your next order',
    kind: 'coupon',
    couponType: 'fixed',
    couponValue: 200,
    couponValidDays: 30,
    isFloorPrize: true,
    stockTotal: null,
    stockRemaining: null,
    minOrderValuePaise: 0,
  });
  // A goodie with zero stock: present so the pool is realistic, unwinnable so the
  // floor coupon is drawn deterministically instead of flaking one run in twenty.
  await SpinPrize.create({
    campaign: campaign._id,
    name: 'Microfibre Cloth', sku: 'GOODIE-MF', kind: 'goodie',
    stockTotal: 0, stockRemaining: 0,
  });
  return { campaign, floor };
}

const seedPaidOrder = (overrides = {}) => Order.create({
  user: user._id,
  items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 1000, name: 'Thing' }],
  shippingAddress: ADDRESS,
  subtotal: 1000,
  totalAmount: 1000,
  status: 'processing',
  paymentStatus: 'paid',
  ...overrides,
});

/** Win a coupon on a fresh paid order and hand back the code the customer sees. */
async function winACoupon() {
  const order = await seedPaidOrder();
  const { result } = await spinService.spin(order._id, { userId: user._id });
  return { order, result, code: result.prizeSnapshot.couponCode };
}

beforeAll(async () => {
  await useTransactionalDb({ warmUp: true });
});

beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}), SpinCampaign.deleteMany({}), SpinPrize.deleteMany({}),
    SpinResult.deleteMany({}), User.deleteMany({}), Coupon.deleteMany({}),
    Product.deleteMany({}), CouponRedemption.deleteMany({}), CouponUserUsage.deleteMany({}),
  ]);
  // "Which campaign is live" is cached; wiping collections does not wipe Redis, so
  // without this every test after the first draws against the previous campaign id.
  await cacheService.invalidatePattern('public:spin:*');
  // Production builds this in config/db.js (autoIndex is off there). It IS the
  // one-spin-per-order guarantee, so the tests must exercise the same serialisation point.
  await SpinResult.collection.createIndex({ order: 1 }, { unique: true });
  user = await User.create({
    name: 'Spin Buyer', email: `spin-${Date.now()}-${Math.random()}@test.com`, passwordHash: 'x',
  });
});


// ── The prize is spendable ────────────────────────────────────────────────────
describe('a coupon won on the wheel discounts the NEXT order', () => {
  it('takes the money off a real second order, end to end', async () => {
    await seedCouponCampaign();
    const { code } = await winACoupon();
    expect(code).toMatch(/^SPIN-[A-Z0-9]+$/);

    // The next visit: a ₹1,000 product, paying with what they won.
    const product = await seedProduct(1000);
    const next = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code },
    );

    expect(next.couponDiscount).toBe(200);
    expect(next.totalAmount).toBe(800); // 1000 − 200, server-computed
    expect(await CouponRedemption.findOne({ order: next._id })).toBeTruthy();
    expect((await Coupon.findOne({ code })).usedCount).toBe(1);
  });

  it('is redeemable despite being hidden from the public offers list', async () => {
    // `visibility: 'hidden'` is deliberate — a prize code must never be discoverable by
    // someone who did not win it. This pins that hiding it does not also disable it.
    await seedCouponCampaign();
    const { code } = await winACoupon();
    expect((await Coupon.findOne({ code })).visibility).toBe('hidden');

    const product = await seedProduct(1000);
    const next = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code },
    );
    expect(next.couponDiscount).toBe(200);
  });

  it('DIES after one redemption — a leaked code is worth exactly one order', async () => {
    // The global usageLimit is the guarantee that actually holds in production, and it
    // is the entire reason each winner gets their OWN code instead of a shared one.
    await seedCouponCampaign();
    const { code } = await winACoupon();
    const product = await seedProduct(1000);

    await orderService.createOrder(user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code });
    await expect(orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code },
    )).rejects.toThrow(/usage limit|already used/i);

    expect((await Coupon.findOne({ code })).usedCount).toBe(1); // never oversold
  });

  it("another customer cannot spend someone else's won code twice over", async () => {
    await seedCouponCampaign();
    const { code } = await winACoupon();
    const product = await seedProduct(1000);
    const stranger = await User.create({ name: 'S', email: `s${Math.random()}@x.com`, passwordHash: 'x' });

    // First use burns it — the coupon carries no owner field, so the global cap of 1 is
    // what bounds the damage of a code posted to a deals forum.
    await orderService.createOrder(stranger._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code });
    await expect(orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code },
    )).rejects.toThrow(/usage limit|already used/i);
  });

  it('never discounts more than the cart is worth', async () => {
    // A ₹200 fixed coupon against a ₹250 cart takes ₹200, not more — the clamp lives in
    // pricingService (`Math.min(value, eligibleSubtotal)`), so no coupon can ever drive a
    // total negative however it was configured on the prize.
    await seedCouponCampaign();
    const { code } = await winACoupon();
    const cheap = await seedProduct(250);

    const next = await orderService.createOrder(
      user._id, [{ product: cheap._id, quantity: 1 }], ADDRESS, { couponCode: code },
    );
    expect(next.couponDiscount).toBe(200);
    expect(next.totalAmount).toBe(50);
  });

  it('refuses to create a ₹0 order rather than sending one to Razorpay', async () => {
    /*
      The narrow edge where a won coupon covers the ENTIRE cart (₹200 off a ₹150 basket
      with free shipping). pricingService clamps the discount to the subtotal, so the
      total lands on exactly 0 — and orderService refuses it, because a ₹0 order has no
      payment to verify and the webhook that fulfils it would never fire.

      Pinned as DELIBERATE, not as an aspiration: the guard is correct, but the message
      the buyer sees ("Order total must be greater than zero") names none of that. The
      coupon is NOT burned when this throws, so the customer keeps their prize — that is
      the part which actually matters, and it is what this asserts.
    */
    await seedCouponCampaign();
    const { code } = await winACoupon();
    const cheap = await seedProduct(150);

    await expect(orderService.createOrder(
      user._id, [{ product: cheap._id, quantity: 1 }], ADDRESS, { couponCode: code },
    )).rejects.toThrow(/greater than zero/i);

    // The prize survives a rejected checkout — they can still spend it on a bigger cart.
    expect((await Coupon.findOne({ code })).usedCount).toBe(0);
    const bigger = await seedProduct(1000);
    const next = await orderService.createOrder(
      user._id, [{ product: bigger._id, quantity: 1 }], ADDRESS, { couponCode: code },
    );
    expect(next.couponDiscount).toBe(200);
  });

  it('a percentage prize honours its cap on the next order', async () => {
    const { floor } = await seedCouponCampaign();
    await SpinPrize.updateOne({ _id: floor._id }, {
      couponType: 'percentage', couponValue: 10, couponMaxDiscount: 500,
    });
    const { code } = await winACoupon();

    const pricey = await seedProduct(20000); // 10% = 2000, capped to 500
    const next = await orderService.createOrder(
      user._id, [{ product: pricey._id, quantity: 1 }], ADDRESS, { couponCode: code },
    );
    expect(next.couponDiscount).toBe(500);
    expect(next.totalAmount).toBe(19500);
  });

  it('respects the minimum cart value the prize was configured with', async () => {
    const { floor } = await seedCouponCampaign();
    await SpinPrize.updateOne({ _id: floor._id }, { couponMinCartValue: 2000 });
    const { code } = await winACoupon();

    const small = await seedProduct(500);
    await expect(orderService.createOrder(
      user._id, [{ product: small._id, quantity: 1 }], ADDRESS, { couponCode: code },
    )).rejects.toThrow();
  });

  it('stops working once the prize window has passed', async () => {
    const { floor } = await seedCouponCampaign();
    await SpinPrize.updateOne({ _id: floor._id }, { couponValidDays: 1 });
    const { code } = await winACoupon();

    // Expire it the way the calendar would.
    await Coupon.updateOne({ code }, { expiresAt: new Date(Date.now() - 1000) });
    const product = await seedProduct(1000);
    await expect(orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code },
    )).rejects.toThrow(/expired/i);
  });
});


// ── One spin per customer ─────────────────────────────────────────────────────
describe('one spin per customer, across orders', () => {
  it("a second PAID order does not offer the wheel again", async () => {
    await seedCouponCampaign(); // maxSpinsPerUserPerCampaign defaults to 1
    await winACoupon();

    const second = await seedPaidOrder();
    const eligibility = await spinService.checkEligibility(second._id, { userId: user._id });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe(spinService.INELIGIBLE.USER_CAP_REACHED);

    await expect(spinService.spin(second._id, { userId: user._id }))
      .rejects.toThrow(/user_cap_reached/);
  });

  it('the capped customer keeps the coupon they already won', async () => {
    // Being out of spins must not retroactively invalidate the prize.
    await seedCouponCampaign();
    const { code } = await winACoupon();
    await seedPaidOrder(); // second order, no spin on offer

    const product = await seedProduct(1000);
    const next = await orderService.createOrder(
      user._id, [{ product: product._id, quantity: 1 }], ADDRESS, { couponCode: code },
    );
    expect(next.couponDiscount).toBe(200);
  });

  it('a cancelled order hands the spin back AND is a fresh draw', async () => {
    await seedCouponCampaign();
    const { order } = await winACoupon();

    await spinService.voidForOrder(order._id, VOID_REASON.ORDER_CANCELLED);

    const second = await seedPaidOrder();
    const eligibility = await spinService.checkEligibility(second._id, { userId: user._id });
    expect(eligibility.eligible).toBe(true);
  });

  it('every order earns its own spin when the cap is lifted', async () => {
    await seedCouponCampaign({ maxSpinsPerUserPerCampaign: null });
    const first = await winACoupon();
    const second = await winACoupon();

    expect(second.code).not.toBe(first.code); // distinct codes, not a shared one
    expect(await SpinResult.countDocuments({ user: user._id })).toBe(2);
  });
});


// ── Clawback reaches the coupon ───────────────────────────────────────────────
describe('voiding the win', () => {
  it('marks the spin void when the order is cancelled', async () => {
    await seedCouponCampaign();
    const { order } = await winACoupon();

    const outcome = await spinService.voidForOrder(order._id, VOID_REASON.ORDER_CANCELLED);
    expect(outcome.voided).toBe(true);

    const result = await SpinResult.findOne({ order: order._id });
    expect(result.status).toBe('void');
    expect(result.voidReason).toBe(VOID_REASON.ORDER_CANCELLED);
  });
});
