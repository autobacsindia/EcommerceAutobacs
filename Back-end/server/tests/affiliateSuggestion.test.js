/**
 * The cart's referral suggestion, end to end over HTTP.
 *
 * This is the one place the `ab_ref` cookie has to survive a full round trip: browser →
 * Next rewrite → Express → pricingService → back. Every unit in that chain was already
 * tested in isolation and all of them passed while the box did not appear on the cart,
 * which is exactly the gap an integration test exists to close.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Affiliate from '../models/Affiliate.js';
import Coupon from '../models/Coupon.js';
import CouponUserUsage from '../models/CouponUserUsage.js';
import { AFFILIATE_STATUS } from '../config/affiliate.js';

const BASE = '/api/v1';

const csrfFrom = (setCookie = []) => {
  const x = (setCookie || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};

/** `name=value` pairs from a Set-Cookie array, ready to send back as one Cookie header. */
const jarFrom = (setCookie = []) => (setCookie || []).map((c) => c.split(';')[0]);

describe('cart referral suggestion', () => {
  let product;
  let authJar;
  let csrf;

  const shopper = { name: 'Buyer', email: 'buyer@example.com', password: 'SecurePass123!' };

  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    product = await Product.create({
      name: 'Alloy Wheel', slug: 'alloy-wheel', price: 1000,
      description: 'x', isActive: true, stockStatus: 'in',
    });

    const salt = await bcrypt.genSalt(10);
    await User.create({
      name: shopper.name, email: shopper.email, role: 'customer',
      passwordHash: await bcrypt.hash(shopper.password, salt),
    });

    const login = await request(app).post(`${BASE}/auth/login`)
      .send({ email: shopper.email, password: shopper.password });
    authJar = jarFrom(login.headers['set-cookie']);
    csrf = csrfFrom(login.headers['set-cookie']);
  });

  /** An approved affiliate with a working managed coupon. */
  const seedActiveAffiliate = async ({ discountPercent = 10 } = {}) => {
    const affiliate = await Affiliate.create({
      code: 'RAHUL10', name: 'Rahul', email: 'rahul@example.com',
      status: AFFILIATE_STATUS.ACTIVE, commissionPercent: 10, discountPercent,
    });
    const coupon = await Coupon.create({
      code: 'RAHUL10', type: 'percentage', value: discountPercent,
      visibility: 'hidden', affiliate: affiliate._id,
      isActive: discountPercent > 0,
      // The real default. Left ON so the guest case below is the real one.
      firstOrderOnly: true,
    });
    affiliate.coupon = coupon._id;
    await affiliate.save();
    return affiliate;
  };

  /*
    POST a quote as the signed-in shopper, optionally carrying an ab_ref cookie.

    The Cookie header is built by hand rather than using supertest's agent: the agent
    owns its own jar, so `.set('Cookie', …)` would REPLACE the session cookies and the
    request would 401 — which looks exactly like "the referral did not work".
  */
  const quote = (refCookie, body = {}) => {
    const jar = refCookie ? [...authJar, `ab_ref=${refCookie}`] : authJar;
    return request(app).post(`${BASE}/checkout/quote`)
      .set('X-XSRF-TOKEN', csrf)
      .set('Cookie', jar.join('; '))
      .send({ items: [{ product: product._id.toString(), quantity: 1 }], ...body });
  };

  it('suggests the affiliate coupon when the buyer arrived on a referral link', async () => {
    await seedActiveAffiliate({ discountPercent: 10 });

    const res = await quote('RAHUL10');

    expect(res.status).toBe(200);
    expect(res.body.quote.suggestedCoupon).toEqual({
      code: 'RAHUL10',
      estimatedDiscount: 100, // 10% of ₹1,000 — computed by the same code that would apply it
      freeShipping: false,
    });
  });

  it('suggests nothing without the cookie', async () => {
    await seedActiveAffiliate();
    expect((await quote()).body.quote.suggestedCoupon).toBeNull();
  });

  /*
    ⚠️ The case that looked like a bug during testing. A pending affiliate has no coupon
    at all, so evaluation throws and the suggestion is silently skipped — correct, but
    indistinguishable on the cart from "the feature is broken".
  */
  it('suggests nothing while the affiliate is still pending approval', async () => {
    await Affiliate.create({
      code: 'RAHUL10', name: 'Rahul', email: 'rahul@example.com',
      status: AFFILIATE_STATUS.PENDING, commissionPercent: 10,
    });

    expect((await quote('RAHUL10')).body.quote.suggestedCoupon).toBeNull();
  });

  /*
    ⚠️ The second half of the same confusion. An affiliate approved with a 0% buyer
    discount gets an INACTIVE coupon, so there is nothing to suggest — by design, because
    a code that says "applied" and saves ₹0 is worse than no code.
  */
  it('suggests nothing when the affiliate gives a 0% discount', async () => {
    await seedActiveAffiliate({ discountPercent: 0 });
    expect((await quote('RAHUL10')).body.quote.suggestedCoupon).toBeNull();
  });

  it('suggests nothing for a code that does not exist', async () => {
    expect((await quote('NOSUCHCODE')).body.quote.suggestedCoupon).toBeNull();
  });

  it('suggests nothing once a coupon is already applied — there is only one slot', async () => {
    await seedActiveAffiliate();
    await Coupon.create({ code: 'SALE20', type: 'percentage', value: 20 });

    const res = await quote('RAHUL10', { couponCode: 'SALE20' });

    expect(res.body.quote.appliedCoupon.code).toBe('SALE20');
    expect(res.body.quote.suggestedCoupon).toBeNull();
  });

  /*
    ⚠️ A REAL LIMITATION, asserted so it is a known behaviour rather than a surprise.

    The managed coupon defaults to firstOrderOnly, and pricingService cannot evaluate
    that without an identified user — so a LOGGED-OUT shopper carrying a valid referral
    cookie is shown nothing. The suggestion appears once they sign in.
  */
  it('shows nothing to a logged-out shopper while firstOrderOnly is set', async () => {
    await seedActiveAffiliate();

    const seed = await request(app).get(`${BASE}/csrf-token`);
    const res = await request(app).post(`${BASE}/checkout/quote`)
      .set('X-XSRF-TOKEN', csrfFrom(seed.headers['set-cookie']))
      .set('Cookie', [...jarFrom(seed.headers['set-cookie']), 'ab_ref=RAHUL10'].join('; '))
      .send({ items: [{ product: product._id.toString(), quantity: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.quote.suggestedCoupon).toBeNull();
  });

  it('DOES show it to a logged-out shopper when firstOrderOnly is off', async () => {
    const affiliate = await seedActiveAffiliate();
    await Coupon.updateOne({ _id: affiliate.coupon }, { $set: { firstOrderOnly: false } });

    const seed = await request(app).get(`${BASE}/csrf-token`);
    const res = await request(app).post(`${BASE}/checkout/quote`)
      .set('X-XSRF-TOKEN', csrfFrom(seed.headers['set-cookie']))
      .set('Cookie', [...jarFrom(seed.headers['set-cookie']), 'ab_ref=RAHUL10'].join('; '))
      .send({ items: [{ product: product._id.toString(), quantity: 1 }] });

    expect(res.body.quote.suggestedCoupon.code).toBe('RAHUL10');
  });

  /*
    ── THE CART REMEMBERS A CODE THAT BOUGHT NOTHING ─────────────────────────────

    A returning buyer has spent their one discount from this affiliate. Applying the
    code on /cart used to 400 and drop it, which quietly cost the affiliate the credit
    they earned for sending that buyer — the code is their identity tag, not only a
    discount. It is now kept, flagged `discountApplied: false`, and checkout lets the
    order through at full price.
  */
  describe('applying an affiliate code the buyer has already used', () => {
    /** Put this shopper at the coupon's per-user cap without placing a real order. */
    const exhaustDiscount = async (affiliate) => {
      const user = await User.findOne({ email: shopper.email });
      await Coupon.updateOne(
        { _id: affiliate.coupon },
        { $set: { firstOrderOnly: false, usageLimitPerUser: 1 } },
      );
      await CouponUserUsage.create({ coupon: affiliate.coupon, user: user._id, count: 1 });
    };

    const applyToCart = async (code) => {
      await request(app).post(`${BASE}/cart/add`)
        .set('X-XSRF-TOKEN', csrf).set('Cookie', authJar.join('; '))
        .send({ productId: product._id.toString(), quantity: 1 });

      return request(app).put(`${BASE}/cart/coupon`)
        .set('X-XSRF-TOKEN', csrf).set('Cookie', authJar.join('; '))
        .send({ code });
    };

    it('keeps the code on the cart and says plainly that nothing came off', async () => {
      const affiliate = await seedActiveAffiliate({ discountPercent: 10 });
      await exhaustDiscount(affiliate);

      const res = await applyToCart('RAHUL10');

      expect(res.status).toBe(200);
      expect(res.body.discountApplied).toBe(false);
      expect(res.body.couponErrorCode).toBe('affiliate_no_discount');
      expect(res.body.cart.couponCode).toBe('RAHUL10');
    });

    /*
      ⚠️ The narrowness of the exemption, asserted at the HTTP boundary. A typo must
      still fail loudly and must NOT be remembered — unlike the repeat-customer case,
      the buyer can fix a typo, and a silently-kept bad code would have them checking
      out believing in a discount that never existed.
    */
    it('still rejects a mistyped code and does not remember it', async () => {
      await seedActiveAffiliate({ discountPercent: 10 });

      const res = await applyToCart('RAHUL1O');

      expect(res.status).toBe(400);
      const cart = await request(app).get(`${BASE}/cart`)
        .set('Cookie', authJar.join('; '));
      expect(cart.body.cart.couponCode).toBeFalsy();
    });
  });
});
