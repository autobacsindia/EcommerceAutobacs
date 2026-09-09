/**
 * Attribution — who gets credited, and who must not be.
 *
 * The invariants here are the ones that cost money quietly rather than loudly. A
 * tampered cookie that attributes anyway pays a stranger. A suspended affiliate's code
 * that falls through to the cookie pays the WRONG affiliate — and the order looks
 * completely normal either way, because attribution changes no total the customer sees.
 */

import mongoose from 'mongoose';
import { extractAffiliateRef } from '../utils/affiliateAttribution.js';
import {
  resolveAttribution,
  affiliateCouponGate,
  isSelfReferral,
} from '../services/affiliateAttributionService.js';
import Affiliate from '../models/Affiliate.js';
import Coupon from '../models/Coupon.js';
import User from '../models/User.js';
import { AFFILIATE_STATUS, ATTRIBUTION_SOURCE } from '../config/affiliate.js';

const oid = () => new mongoose.Types.ObjectId();

/** An active affiliate plus the managed coupon that carries their code. */
const seedAffiliate = async (overrides = {}) => {
  const affiliate = await Affiliate.create({
    code: 'RAHUL10',
    name: 'Rahul',
    email: 'rahul@example.com',
    phone: '+91 98765 43210',
    status: AFFILIATE_STATUS.ACTIVE,
    commissionPercent: 10,
    discountPercent: 8,
    ...overrides,
  });
  const coupon = await Coupon.create({
    code: affiliate.code,
    type: 'percentage',
    value: affiliate.discountPercent,
    visibility: 'hidden',
    affiliate: affiliate._id,
  });
  affiliate.coupon = coupon._id;
  await affiliate.save();
  return { affiliate, coupon };
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure: cookie parsing. No DB.
// ─────────────────────────────────────────────────────────────────────────────
describe('extractAffiliateRef — the cookie is fully client-controlled', () => {
  const req = (ab_ref) => ({ cookies: { ab_ref } });

  it('reads and normalises a well-formed code', () => {
    expect(extractAffiliateRef(req('  rahul10  '))).toBe('RAHUL10');
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['too short', 'AB'],
    ['leading separator', '-RAHUL'],
    ['html', '<script>alert(1)</script>'],
    ['a path traversal', '../../etc/passwd'],
    ['whitespace only', '   '],
  ])('returns null for %s', (_label, value) => {
    expect(extractAffiliateRef(req(value))).toBeNull();
  });

  it('returns null for a non-string cookie value', () => {
    expect(extractAffiliateRef({ cookies: { ab_ref: { $ne: null } } })).toBeNull();
    expect(extractAffiliateRef({})).toBeNull();
    expect(extractAffiliateRef(undefined)).toBeNull();
  });

  /*
    Capping happens BEFORE the regex so a huge cookie is never handed to the matcher.
    The truncated value must then FAIL, not accidentally match a real code's prefix.
  */
  it('does not let an over-long value truncate into a valid code', () => {
    expect(extractAffiliateRef(req(`RAHUL10${'X'.repeat(5000)}`))).toBe('RAHUL10XXXXXXXXXXXXXXXXX');
    // …and that truncation is itself a well-formed but UNKNOWN code, so resolution
    // (below) finds no affiliate. Shape validity is not authority.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isSelfReferral — three keys, because one is not enough', () => {
  const affiliate = {
    user: oid(),
    email: 'rahul@example.com',
    phone: '+91 98765 43210',
  };

  it('matches on the linked account', () => {
    expect(isSelfReferral(affiliate, { userId: affiliate.user })).toBe(true);
  });

  it('matches on email regardless of case or padding', () => {
    expect(isSelfReferral(affiliate, { email: '  RAHUL@example.com ' })).toBe(true);
  });

  /*
    The second-email dodge: sign up as an affiliate with one address, order with
    another. The phone number is what closes it.
  */
  it('matches on phone across different formattings', () => {
    expect(isSelfReferral(affiliate, { email: 'other@example.com', phone: '9876543210' })).toBe(true);
    expect(isSelfReferral(affiliate, { phone: '+919876543210' })).toBe(true);
    expect(isSelfReferral(affiliate, { phone: '098765 43210' })).toBe(true);
  });

  it('does not match a genuinely different buyer', () => {
    expect(isSelfReferral(affiliate, {
      userId: oid(), email: 'someone@example.com', phone: '9000000000',
    })).toBe(false);
  });

  /*
    A short or junk phone must not become a wildcard that matches every other short or
    junk phone — that would block real customers from using a real code.
  */
  it('ignores phone fragments too short to identify anyone', () => {
    const shortPhone = { email: 'a@example.com', phone: '123' };
    expect(isSelfReferral({ email: 'b@example.com', phone: '456' }, shortPhone)).toBe(false);
  });

  it('is false when there is nothing to compare', () => {
    expect(isSelfReferral(affiliate, {})).toBe(false);
    expect(isSelfReferral(null, { email: 'rahul@example.com' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('affiliateCouponGate — blocks the discount, not just the commission', () => {
  it('allows an ordinary coupon through untouched', async () => {
    const plain = await Coupon.create({ code: 'SALE20', type: 'percentage', value: 20 });
    expect(await affiliateCouponGate(plain, { email: 'anyone@example.com' })).toBeNull();
  });

  it('allows a normal buyer to use an affiliate code', async () => {
    const { coupon } = await seedAffiliate();
    expect(await affiliateCouponGate(coupon, { email: 'customer@example.com' })).toBeNull();
  });

  /*
    THE case. Blocking only the commission would leave the affiliate a permanent private
    discount on their own account — a larger, quieter loss than a single mis-paid
    commission, and one no report would ever surface.
  */
  it('refuses an affiliate using their own code', async () => {
    const { affiliate, coupon } = await seedAffiliate();

    expect(await affiliateCouponGate(coupon, { email: affiliate.email }))
      .toMatch(/your own account/i);
    expect(await affiliateCouponGate(coupon, { phone: '9876543210' }))
      .toMatch(/your own account/i);
  });

  it('refuses a suspended affiliate\'s code', async () => {
    const { affiliate, coupon } = await seedAffiliate();
    affiliate.status = AFFILIATE_STATUS.SUSPENDED;
    await affiliate.save();

    expect(await affiliateCouponGate(coupon, { email: 'customer@example.com' }))
      .toMatch(/no longer active/i);
  });

  /*
    Broken config, not a discount: honouring it would give money away for a sale nobody
    could ever be paid for.
  */
  it('refuses a coupon pointing at a deleted affiliate', async () => {
    const orphan = await Coupon.create({
      code: 'ORPHAN10', type: 'percentage', value: 10, affiliate: oid(),
    });
    expect(await affiliateCouponGate(orphan, {})).toMatch(/no longer available/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveAttribution — precedence', () => {
  it('credits nobody when there is neither a cookie nor a coupon', async () => {
    expect(await resolveAttribution({})).toBeNull();
  });

  it('credits the link when only the cookie is present', async () => {
    const { affiliate } = await seedAffiliate();

    const result = await resolveAttribution({ cookieCode: 'RAHUL10', buyer: { userId: oid() } });

    expect(String(result.affiliate)).toBe(String(affiliate._id));
    expect(result.source).toBe(ATTRIBUTION_SOURCE.LINK);
    expect(result.code).toBe('RAHUL10');
  });

  it('credits the coupon when the buyer typed an affiliate code', async () => {
    const { affiliate } = await seedAffiliate();

    const result = await resolveAttribution({
      appliedCouponCode: 'RAHUL10',
      buyer: { userId: oid() },
    });

    expect(String(result.affiliate)).toBe(String(affiliate._id));
    expect(result.source).toBe(ATTRIBUTION_SOURCE.COUPON);
  });

  /*
    A typed code is a deliberate act; a cookie is a three-week-old accident. The person
    the buyer named wins.
  */
  it('lets a typed code beat a different affiliate\'s cookie', async () => {
    const { affiliate: rahul } = await seedAffiliate();
    await seedAffiliate({ code: 'PRIYA10', name: 'Priya', email: 'priya@example.com', phone: '9000000001' });

    const result = await resolveAttribution({
      appliedCouponCode: 'RAHUL10',
      cookieCode: 'PRIYA10',
      buyer: { userId: oid() },
    });

    expect(String(result.affiliate)).toBe(String(rahul._id));
    expect(result.source).toBe(ATTRIBUTION_SOURCE.COUPON);
  });

  /*
    Commission is decoupled from the discount. Rahul did the work of bringing this buyer
    in; the buyer simply had a better code to hand. Refusing to credit him here is what
    would push every affiliate to code-only promotion — the leakier channel.
  */
  it('still credits the link when a NON-affiliate coupon priced the cart', async () => {
    const { affiliate } = await seedAffiliate();
    await Coupon.create({ code: 'SALE20', type: 'percentage', value: 20 });

    const result = await resolveAttribution({
      appliedCouponCode: 'SALE20',
      cookieCode: 'RAHUL10',
      buyer: { userId: oid() },
    });

    expect(String(result.affiliate)).toBe(String(affiliate._id));
    expect(result.source).toBe(ATTRIBUTION_SOURCE.LINK);
  });

  /*
    ⚠️ THE silent-misdirection case.

    The buyer typed Priya's code. Priya cannot be credited (suspended). Falling back to
    the cookie would pay RAHUL for a sale the buyer explicitly attributed to Priya —
    invisible in every report, because the order looks completely ordinary.
  */
  it('credits NOBODY when the typed affiliate cannot be paid, never the cookie', async () => {
    await seedAffiliate(); // RAHUL10, in the cookie
    const { affiliate: priya } = await seedAffiliate({
      code: 'PRIYA10', name: 'Priya', email: 'priya@example.com', phone: '9000000001',
    });
    priya.status = AFFILIATE_STATUS.SUSPENDED;
    await priya.save();

    const result = await resolveAttribution({
      appliedCouponCode: 'PRIYA10',
      cookieCode: 'RAHUL10',
      buyer: { userId: oid() },
    });

    expect(result).toBeNull();
  });

  it.each([
    ['an unknown code', 'NOSUCHCODE'],
    ['a malformed code', 'x'],
    ['a mongo operator', { $ne: null }],
  ])('credits nobody for %s in the cookie', async (_label, cookieCode) => {
    await seedAffiliate();
    expect(await resolveAttribution({ cookieCode, buyer: { userId: oid() } })).toBeNull();
  });

  it('credits nobody when the cookie names a suspended affiliate', async () => {
    const { affiliate } = await seedAffiliate();
    affiliate.status = AFFILIATE_STATUS.SUSPENDED;
    await affiliate.save();

    expect(await resolveAttribution({ cookieCode: 'RAHUL10', buyer: { userId: oid() } })).toBeNull();
  });

  /*
    ⚠️ THE BLIND SPOT. The checkout page sends `email`/`phone` only for GUEST orders, so
    an authenticated buyer arrives with a userId and nothing else. If the affiliate
    applied through the public form while logged out, `affiliate.user` is unset too —
    leaving NO key to match on. A signed-in affiliate could then use their own code for
    ever: a permanent private discount plus commission on their own purchases.

    Fixed by resolving the buyer's email and phone from the User record server-side.
  */
  it('catches a signed-in affiliate using their own code when the body carries no identity', async () => {
    const buyer = await User.create({
      name: 'Rahul', email: 'rahul@example.com', phone: '9876543210',
      passwordHash: 'x', role: 'customer',
    });
    // Applied logged-out, so no `user` link — exactly how the public form leaves it.
    await seedAffiliate();

    const result = await resolveAttribution({
      appliedCouponCode: 'RAHUL10',
      buyer: { userId: buyer._id }, // no email, no phone — what real checkout sends
    });

    expect(result).toBeNull();
  });

  it('catches it on the link limb too, and via the phone on the account', async () => {
    const buyer = await User.create({
      name: 'Rahul', email: 'different@example.com', phone: '9876543210',
      passwordHash: 'x', role: 'customer',
    });
    await seedAffiliate();

    expect(await resolveAttribution({
      cookieCode: 'RAHUL10',
      buyer: { userId: buyer._id },
    })).toBeNull();
  });

  it('still attributes a genuinely different signed-in buyer', async () => {
    const buyer = await User.create({
      name: 'Someone', email: 'someone@example.com', phone: '9000000123',
      passwordHash: 'x', role: 'customer',
    });
    const { affiliate } = await seedAffiliate();

    const result = await resolveAttribution({
      cookieCode: 'RAHUL10',
      buyer: { userId: buyer._id },
    });

    expect(String(result.affiliate)).toBe(String(affiliate._id));
  });

  it('refuses self-referral on both the coupon and the link limb', async () => {
    const { affiliate } = await seedAffiliate({ user: oid() });

    for (const args of [
      { appliedCouponCode: 'RAHUL10' },
      { cookieCode: 'RAHUL10' },
    ]) {
      expect(await resolveAttribution({ ...args, buyer: { userId: affiliate.user } })).toBeNull();
      expect(await resolveAttribution({ ...args, buyer: { email: 'rahul@example.com' } })).toBeNull();
      expect(await resolveAttribution({ ...args, buyer: { phone: '9876543210' } })).toBeNull();
    }
  });

  /*
    The rate is frozen at order time because the ledger reads THIS number, not the live
    affiliate. Without the snapshot, raising someone's rate would retroactively repay
    every order they ever referred.
  */
  it('snapshots the commission rate as it is right now', async () => {
    const { affiliate } = await seedAffiliate({ commissionPercent: 10 });

    const atOrderTime = await resolveAttribution({ cookieCode: 'RAHUL10', buyer: { userId: oid() } });
    expect(atOrderTime.commissionPercent).toBe(10);

    affiliate.commissionPercent = 25;
    await affiliate.save();

    // The already-taken snapshot is unchanged; only NEW orders see the new rate.
    expect(atOrderTime.commissionPercent).toBe(10);
    const later = await resolveAttribution({ cookieCode: 'RAHUL10', buyer: { userId: oid() } });
    expect(later.commissionPercent).toBe(25);
  });

  it('snapshots the code so a later rename cannot rewrite history', async () => {
    const { affiliate } = await seedAffiliate();
    const result = await resolveAttribution({ cookieCode: 'RAHUL10', buyer: { userId: oid() } });

    affiliate.code = 'RAHULNEW';
    await affiliate.save();

    expect(result.code).toBe('RAHUL10');
  });
});
