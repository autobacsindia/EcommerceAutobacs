/**
 * Campaign service — eligibility gate and tier pricing for promotional campaigns.
 *
 * Two responsibilities, and deliberately nothing else:
 *   1. evaluate()  — may THIS user use THIS campaign right now, and at what tier?
 *   2. lifecycle   — create/update/publish a campaign, import an allowlist, report.
 *
 * It does not compute totals, persist money, or touch orders. pricingService calls
 * evaluate() and applies the returned tier through the existing coupon path, so
 * Order.discount / the invoice / refundMathService all keep reading a single set of
 * figures. Standing up a parallel discount pipeline is how a discounted order gets
 * refunded at list price — the exact failure that made refundMathService the SSOT.
 *
 * Rejections are RETURNED, not thrown ({ reason }), matching how pricingService
 * reports coupon ineligibility so a cart can explain itself inline instead of 500ing.
 */

import campaignRepository from '../repositories/campaignRepository.js';
import campaignMemberRepository from '../repositories/campaignMemberRepository.js';
import userRepository from '../repositories/userRepository.js';
import couponRepository from '../repositories/couponRepository.js';
import AppError from '../utils/AppError.js';
import { resolveTier, validateTiers, assertMonotonic } from '../utils/campaignTiers.js';
import { validateProductTiers } from '../utils/productTiers.js';
import {
  CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE, CAMPAIGN_REASON,
  CAMPAIGN_REQUIRES_CAP_FOR_EVERYONE,
} from '../config/campaign.js';

const EDITABLE_FIELDS = [
  'name', 'description', 'status', 'audience', 'testerEmails', 'requireVerifiedEmail',
  'startsAt', 'endsAt', 'tiers', 'resolution', 'maxDiscountPerOrder', 'couponCode', 'productTiers',
  'allowKarmaStacking', 'maxRedemptions', 'landingPath', 'allowNonMonotonicTiers',
];

function pick(body) {
  const out = {};
  for (const k of EDITABLE_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  if (Array.isArray(out.testerEmails)) {
    out.testerEmails = out.testerEmails
      .map(e => String(e || '').toLowerCase().trim())
      .filter(Boolean);
  }
  return out;
}

class CampaignService {
  /**
   * Can `userId` use `campaign` on a cart worth `eligiblePaise`?
   *
   * @returns {{ tier: Object }}   eligible — tier carries { tierId, label, percent, discountPaise }
   *       or {{ reason: string }} not eligible — buyer-facing text from CAMPAIGN_REASON
   */
  async evaluate(campaign, userId, eligiblePaise, session = null, now = new Date()) {
    if (!campaign) return { reason: CAMPAIGN_REASON.INACTIVE };

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    if (campaign.status === CAMPAIGN_STATUS.OFF || campaign.status === CAMPAIGN_STATUS.DRAFT) {
      return { reason: CAMPAIGN_REASON.INACTIVE };
    }
    if (campaign.startsAt && now < campaign.startsAt) return { reason: CAMPAIGN_REASON.NOT_STARTED };
    if (campaign.endsAt && now > campaign.endsAt) return { reason: CAMPAIGN_REASON.ENDED };

    // Budget stop. Checked here for a fast, honest message; enforced atomically at
    // order time by incrementRedemptionGuarded, which is what actually prevents an
    // oversell when two carts race for the last slot.
    if (campaign.maxRedemptions != null && campaign.redeemedCount >= campaign.maxRedemptions) {
      return { reason: CAMPAIGN_REASON.EXHAUSTED };
    }

    // ── Identity ──────────────────────────────────────────────────────────────
    // Every audience needs a known user: "once per customer" cannot be enforced
    // against an anonymous cart. Checkout already requires login, so this only
    // affects the pre-login quote, which correctly shows no campaign discount.
    if (!userId) return { reason: CAMPAIGN_REASON.LOGIN };

    const user = await userRepository.getCampaignIdentity(userId, session);
    if (!user) return { reason: CAMPAIGN_REASON.LOGIN };

    const email = String(user.email || '').toLowerCase().trim();

    // Confirmed email is required by default. Load-bearing: registration sets
    // isVerified:false and login does not gate on it, so without this anyone who
    // guessed an invited address could register it and take the offer without ever
    // opening that inbox. Redemption must prove mailbox control.
    if (campaign.requireVerifiedEmail && !user.isVerified) {
      return { reason: CAMPAIGN_REASON.UNVERIFIED };
    }

    // ── Audience ──────────────────────────────────────────────────────────────
    // 'testing' means live on the real site for named testers only — the way to
    // prove the money path on production before customers can reach it.
    if (campaign.status === CAMPAIGN_STATUS.TESTING) {
      const testers = (campaign.testerEmails || []).map(e => String(e).toLowerCase());
      if (!testers.includes(email)) return { reason: CAMPAIGN_REASON.TESTING };
    }

    if (campaign.audience === CAMPAIGN_AUDIENCE.LIST) {
      const member = await campaignMemberRepository.findByCampaignEmail(campaign._id, email, session);
      if (!member) return { reason: CAMPAIGN_REASON.NOT_INVITED };
    }

    // ── Tier ──────────────────────────────────────────────────────────────────
    // Eligibility is a property of the PERSON; the tier is a property of their CART.
    // Keeping them separate matters: an empty cart earns no tier yet, but the customer
    // is still eligible and must be told so. Conflating the two returned "not eligible"
    // for a zero-value cart, which silently killed the site-wide ribbon and the landing
    // page's success panel — both of which ask about a cart worth nothing.
    return { eligible: true, tier: resolveTier(campaign, eligiblePaise) };
  }

  /**
   * Evaluate by managed coupon code — the pricingService entry point.
   * Returns `{ campaign, tier }` or `{ campaign, reason }`; `campaign` is null when
   * the code belongs to no campaign (an ordinary coupon, priced normally).
   */
  async evaluateByCouponCode(code, userId, eligiblePaise, session = null, now = new Date()) {
    const campaign = await campaignRepository.findByCouponCode(code, session);
    if (!campaign) return { campaign: null };
    const result = await this.evaluate(campaign, userId, eligiblePaise, session, now);
    return { campaign, ...result };
  }

  /**
   * The buyer-facing status a landing page / cart banner renders, for one user.
   * Never cached at the edge — it is per-user by construction.
   */
  async statusForUser(slug, userId, eligiblePaise = 0) {
    const campaign = await campaignRepository.findBySlug(slug);
    if (!campaign) throw new AppError('Campaign not found', 404);

    const result = await this.evaluate(campaign, userId, eligiblePaise);

    // Bind the invite to the account the first time we confirm this person qualifies.
    // Done here rather than in a separate "claim" call because this endpoint is hit on
    // every landing-page and cart render, so the funnel populates itself without the
    // frontend having to remember to report anything. Idempotent, and never demotes a
    // member who has already redeemed.
    // Keyed on eligibility, not on having reached a tier — otherwise an eligible
    // customer who has not yet added anything is never bound to their invite, and the
    // funnel under-reports everyone who browsed before shopping.
    const isEligible = !result.reason;
    if (isEligible && campaign.audience === CAMPAIGN_AUDIENCE.LIST && userId) {
      const user = await userRepository.getCampaignIdentity(userId);
      if (user?.email) {
        await campaignMemberRepository.claimForUser(campaign._id, user.email, userId)
          // Reporting only — a failure here must never cost the buyer their discount.
          .catch(err => console.error('[Campaign] claim failed:', err.message));
      }
    }

    return {
      slug: campaign.slug,
      name: campaign.name,
      endsAt: campaign.endsAt,
      couponCode: isEligible ? campaign.couponCode : null,
      eligible: isEligible,
      reason: result.reason || null,
      tier: result.tier || null,
      // The ladder is safe to publish: it is what the card advertises, and it lets
      // the cart meter show "add ₹X more to save ₹Y more" without a second call.
      tiers: (campaign.tiers || []).map(t => ({
        id: t.id, label: t.label, minCartValue: t.minCartValue,
        percent: t.percent, maxDiscount: t.maxDiscount,
      })),
      maxDiscountPerOrder: campaign.maxDiscountPerOrder,
    };
  }

  /** Bind an invite to the account that proved control of the address. */
  async claim(campaignId, email, userId) {
    return campaignMemberRepository.claimForUser(campaignId, email, userId);
  }

  /**
   * "Am I on the list, and what do I do next?" — the landing page's first step.
   *
   * Returns the ACTION the visitor needs, because the answer differs wildly across the
   * invited set: most of these customers were created by the WooCommerce/Order-Manager
   * import, so they have a confirmed email but have never had a password. Telling them
   * to "log in" would strand them; they need a set-password link.
   *
   *   not_invited   — not on the list (nothing else is revealed)
   *   register      — invited, no account yet
   *   set_password  — invited, account exists, has never set a password  ← the majority
   *   verify_email  — invited, account exists, address not confirmed
   *   login         — invited, account is ready to use
   *
   * This deliberately reveals whether an address is on the list, which is an
   * enumeration oracle. It is a considered trade: the whole point of the campaign UX is
   * an unambiguous "you're in", and an attacker learns only that some address was
   * invited — they still cannot redeem without controlling that mailbox, because
   * eligibility requires a confirmed email and a real session. Mitigated by a strict
   * per-IP rate limit on the route.
   */
  async checkEmail(slug, email) {
    const campaign = await campaignRepository.findBySlug(slug);
    if (!campaign) throw new AppError('Campaign not found', 404);

    const clean = String(email || '').toLowerCase().trim();
    const live = campaign.status === CAMPAIGN_STATUS.LIVE || campaign.status === CAMPAIGN_STATUS.TESTING;

    // An 'everyone' campaign has no allowlist to check, so there is nothing this
    // endpoint can legitimately tell the caller about a specific address. Probing the
    // account here would turn a public, unauthenticated route into an oracle for
    // "does this email have an account, is it verified, and what is the holder's
    // name?" for ANY address — which is exactly what getCampaignAccountState's own
    // contract forbids. The allowlist membership is what earns that disclosure.
    if (campaign.audience !== CAMPAIGN_AUDIENCE.LIST) {
      return { onList: true, action: 'login', campaignLive: live, name: null };
    }

    const member = await campaignMemberRepository.findByCampaignEmail(campaign._id, clean);
    if (!member) {
      return { onList: false, action: 'not_invited', campaignLive: live };
    }

    const account = await userRepository.getCampaignAccountState(clean);
    let action;
    if (!account) action = 'register';
    else if (!account.isVerified) action = 'verify_email';
    else if (account.mustResetPassword) action = 'set_password';
    else action = 'login';

    return {
      onList: true,
      action,
      campaignLive: live,
      // Greeting for the landing page. Falls back to the account name; may legitimately
      // be a business name.
      name: member?.name || account?.name || null,
    };
  }

  // ── Lifecycle / admin ───────────────────────────────────────────────────────

  /**
   * Refuse to save a configuration that would misprice or overspend.
   * Runs on create AND update so a mid-campaign percentage edit is validated too.
   */
  assertValidConfig(data, existing = null) {
    const merged = { ...(existing || {}), ...data };

    // The PER-PRODUCT ladder. Validated whenever it is touched, because the failure it
    // guards against is silent: without exactly one default tier, every product that
    // matched nothing gets no discount at all and nobody is told.
    if (data.productTiers !== undefined) {
      const errors = validateProductTiers(merged.productTiers);
      if (errors.length) throw new AppError(`Invalid product-tier ladder: ${errors.join(' ')}`, 400);

      // The two ladders price the SAME goods on different axes, so running both stacks
      // two discounts on one cart. That is a margin decision, never something to arrive
      // at by leaving a field populated from an earlier configuration.
      const hasCartTiers = Array.isArray(merged.tiers) && merged.tiers.length > 0;
      const hasProductTiers = Array.isArray(merged.productTiers) && merged.productTiers.length > 0;
      if (hasCartTiers && hasProductTiers) {
        throw new AppError(
          'A campaign uses either cart-value tiers or product tiers, not both — together they ' +
          'would apply two discounts to the same goods. Clear one before saving the other.',
          400
        );
      }
    }

    if (merged.tiers !== undefined || !existing) {
      const errors = validateTiers(merged);
      if (errors.length) throw new AppError(`Invalid tier ladder: ${errors.join(' ')}`, 400);

      // A ladder whose discount can FALL as the cart grows is rejected outright. The
      // cart shows the saving live, so a cliff reads as the site cheating the customer
      // and rewards a smaller basket. Checked here, not merely in tests, because tiers
      // are admin-editable long after launch.
      //
      // The escape hatch is `allowNonMonotonicTiers`, NOT switching to 'window'.
      // Bracket ladders are the very thing that produces cliffs, so telling an operator
      // to set resolution:'window' — as this error previously did — sent them to an
      // option that also fails this check, leaving no way forward. Deliberate brackets
      // are legitimate; they just have to be stated explicitly rather than arrived at
      // by accident.
      if (!merged.allowNonMonotonicTiers) {
        const mono = assertMonotonic(merged);
        if (!mono.ok) {
          throw new AppError(
            `This tier ladder would REDUCE a customer's discount as their cart grows ` +
            `(at ₹${(mono.at / 100).toFixed(2)} the saving drops from ` +
            `₹${(mono.from / 100).toFixed(2)} to ₹${(mono.to / 100).toFixed(2)}). ` +
            `A customer adding one cheap item would watch their saving fall. Adjust the ` +
            `tiers, or set allowNonMonotonicTiers if these brackets are intended.`,
            400
          );
        }
      }
    }

    if (merged.startsAt && merged.endsAt && new Date(merged.endsAt) <= new Date(merged.startsAt)) {
      throw new AppError('Campaign end date must be after its start date', 400);
    }
    return merged;
  }

  /**
   * Gate on going LIVE (or into TESTING). Separate from assertValidConfig because a
   * draft is allowed to be incomplete — these are the checks that must hold before
   * anyone can actually be charged a discounted amount.
   */
  async assertPublishable(campaign) {
    if (!campaign.couponCode) {
      throw new AppError('A campaign needs its managed coupon code before it can run', 400);
    }

    /**
     * Verify the managed coupon actually exists and is wired back to this campaign.
     *
     * This is the load-bearing check, not a formality. pricingService only applies the
     * eligibility gate when `coupon.campaign` is set; a coupon with that field null is
     * priced as an ORDINARY coupon at its own static `value`. So a code that looks like
     * the campaign's but isn't linked either silently gives nothing (value 0, the offer
     * appears broken) or — far worse — hands its percentage to every shopper on the
     * site with no allowlist, no verified-email requirement and no per-customer limit.
     * `visibility` matters for the same reason: a public campaign coupon would appear
     * in the cart's suggestion chips for everyone.
     */
    const coupon = await couponRepository.findByCode(String(campaign.couponCode).toUpperCase().trim());
    if (!coupon) {
      throw new AppError(
        `Coupon ${campaign.couponCode} does not exist. Create it before running this campaign.`, 400
      );
    }
    if (!coupon.campaign || String(coupon.campaign) !== String(campaign._id)) {
      throw new AppError(
        `Coupon ${campaign.couponCode} is not linked to this campaign, so the eligibility ` +
        `gate would be bypassed and its own value applied to every customer. Re-link it before going live.`,
        400
      );
    }
    if (!coupon.isActive) {
      throw new AppError(`Coupon ${campaign.couponCode} is inactive, so no discount would apply.`, 400);
    }
    if (coupon.visibility !== 'hidden') {
      throw new AppError(
        `Coupon ${campaign.couponCode} must be hidden, or it will be advertised to every shopper.`, 400
      );
    }
    if (coupon.usageLimitPerUser !== 1) {
      throw new AppError(
        `Coupon ${campaign.couponCode} must have a per-user limit of 1 — it is the only thing ` +
        `enforcing one reward per customer.`,
        400
      );
    }
    if (!campaign.tiers?.length) {
      throw new AppError('A campaign needs at least one discount tier before it can run', 400);
    }
    if (!campaign.endsAt) {
      throw new AppError('A campaign needs an end date before it can run', 400);
    }
    // An 'everyone' campaign has no natural ceiling on payout — it is bounded only by
    // how many customers exist. The cap is mandatory, not advisory.
    if (
      CAMPAIGN_REQUIRES_CAP_FOR_EVERYONE &&
      campaign.audience === CAMPAIGN_AUDIENCE.EVERYONE &&
      campaign.maxRedemptions == null
    ) {
      throw new AppError(
        'A campaign open to everyone must set a maximum number of redemptions before going live',
        400
      );
    }
    if (campaign.status === CAMPAIGN_STATUS.TESTING && !campaign.testerEmails?.length) {
      throw new AppError('Testing mode needs at least one tester email', 400);
    }
    return true;
  }

  async create(body, actorId = null) {
    const data = pick(body);
    if (!body.slug) throw new AppError('Campaign slug is required', 400);
    if (!data.name) throw new AppError('Campaign name is required', 400);

    this.assertValidConfig(data);
    const payload = {
      ...data,
      slug: String(body.slug).toLowerCase().trim(),
      createdBy: actorId,
      updatedBy: actorId,
    };
    if (payload.status && payload.status !== CAMPAIGN_STATUS.DRAFT) {
      await this.assertPublishable(payload);
    }

    try {
      return await campaignRepository.create(payload);
    } catch (err) {
      if (err?.code === 11000) throw new AppError('A campaign with this slug already exists', 409);
      throw err;
    }
  }

  async update(id, body, actorId = null) {
    const existing = await campaignRepository.findById(id);
    if (!existing) throw new AppError('Campaign not found', 404);

    const data = pick(body);
    const merged = this.assertValidConfig(data, existing.toObject ? existing.toObject() : existing);
    if (merged.status && merged.status !== CAMPAIGN_STATUS.DRAFT && merged.status !== CAMPAIGN_STATUS.OFF) {
      await this.assertPublishable(merged);
    }

    return campaignRepository.update(id, { ...data, updatedBy: actorId });
  }

  /** The kill switch. Separate from update() so it can never be blocked by validation. */
  async setStatus(id, status, actorId = null) {
    const campaign = await campaignRepository.findById(id);
    if (!campaign) throw new AppError('Campaign not found', 404);

    if (status === CAMPAIGN_STATUS.LIVE || status === CAMPAIGN_STATUS.TESTING) {
      const merged = campaign.toObject ? campaign.toObject() : campaign;
      await this.assertPublishable({ ...merged, status });
    }
    return campaignRepository.update(id, { status, updatedBy: actorId });
  }

  async getBySlug(slug) {
    const campaign = await campaignRepository.findBySlug(slug);
    if (!campaign) throw new AppError('Campaign not found', 404);
    return campaign;
  }

  /** Import an operations allowlist. Upserts, so a re-import is safe. */
  async importMembers(campaignId, entries) {
    const campaign = await campaignRepository.findById(campaignId);
    if (!campaign) throw new AppError('Campaign not found', 404);

    const seen = new Set();
    const clean = [];
    const rejected = [];
    for (const raw of entries || []) {
      const email = String(raw?.email || '').toLowerCase().trim();
      // Same shape as the login/registration check — an address that cannot receive
      // mail is a wasted card, so it is reported rather than silently stored.
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
        rejected.push({ email: raw?.email ?? '', reason: 'Not a valid email address' });
        continue;
      }
      if (seen.has(email)) {
        rejected.push({ email, reason: 'Duplicate row in the uploaded file' });
        continue;
      }
      seen.add(email);
      clean.push({
        email,
        name: raw?.name,
        reviewNote: raw?.reviewNote,
        // Postal details ride along so a card can actually be addressed. Optional —
        // an allowlist that is only ever emailed does not need them.
        phone: raw?.phone,
        address: raw?.address,
        pincode: raw?.pincode,
        state: raw?.state,
      });
    }

    const result = await campaignMemberRepository.bulkUpsert(campaignId, clean);
    return { ...result, rejected, accepted: clean.length };
  }

  /** Funnel + spend for the admin dashboard. */
  async report(slug) {
    const campaign = await this.getBySlug(slug);
    const counts = await campaignMemberRepository.statusCounts(campaign._id);
    return {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      audience: campaign.audience,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      members: counts,
      redeemedCount: campaign.redeemedCount,
      maxRedemptions: campaign.maxRedemptions,
      discountGivenRupees: campaign.discountGivenRupees,
      // What the campaign could still cost if every remaining slot redeems the max.
      remainingExposureRupees: campaign.maxRedemptions == null
        ? null
        : Math.max(0, campaign.maxRedemptions - campaign.redeemedCount) *
          (campaign.maxDiscountPerOrder || 0),
    };
  }

  /**
   * One page of the allowlist plus the funnel counts, for the admin roster.
   *
   * The counts ride along on the FIRST page only. They describe the whole campaign,
   * not the page, so re-sending them with every scroll would be wasted work — and
   * re-rendering a header total that drifts as pages load is worse than not showing it.
   */
  async listMembers(campaignId, { cursor, limit, status, q } = {}) {
    const campaign = await campaignRepository.findById(campaignId);
    if (!campaign) throw new AppError('Campaign not found', 404);

    const page = await campaignMemberRepository.listPage(campaign._id, { cursor, limit, status, q });
    return {
      ...page,
      counts: cursor ? null : await campaignMemberRepository.statusCounts(campaign._id),
    };
  }

  /**
   * What a given cart value would earn — powers the admin "calculator" so a
   * misconfigured ladder is caught in seconds instead of in a customer's cart.
   */
  simulate(campaign, cartRupees) {
    const tier = resolveTier(campaign, Math.round(Number(cartRupees) * 100) || 0);
    return {
      cartRupees: Number(cartRupees) || 0,
      discountRupees: tier ? tier.discountPaise / 100 : 0,
      tierId: tier?.tierId || null,
      label: tier?.label || null,
      percent: tier?.percent || 0,
    };
  }
}

export default new CampaignService();
export { CampaignService };
