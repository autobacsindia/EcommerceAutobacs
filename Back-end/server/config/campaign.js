/**
 * Campaign constants — single source of truth for the promotional-campaign engine.
 *
 * A "campaign" is a reusable, occasion-scoped discount (festival card, public sale)
 * that decides WHO qualifies and HOW MUCH they get. It deliberately does NOT compute
 * or store money itself: the resolved discount is applied through the existing coupon
 * path so that Order.discount, the invoice, and refundMathService all keep reading one
 * set of numbers. A second money pipeline is how a discounted order gets refunded at
 * full price (see the refund-vs-list-price incident) — so campaigns gate and price a
 * coupon, they never replace it.
 *
 * Import these everywhere (model, service, validators, admin) so a status string or
 * audience name can never drift between call sites.
 */

/**
 * Lifecycle. Deliberately richer than a boolean so a campaign can be live on the real
 * site while reaching only named testers — the only way to prove a money path end to
 * end on production before customers (or 200 printed cards) can touch it.
 *
 *   draft   — being configured. Never applies, to anyone.
 *   testing — applies ONLY to campaign.testerEmails. Real site, real payment, no risk.
 *   live    — applies to the configured audience.
 *   off     — the kill switch. Instant, admin-flippable, no deploy.
 */
export const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: 'draft',
  TESTING: 'testing',
  LIVE: 'live',
  OFF: 'off',
});

export const CAMPAIGN_STATUSES = Object.freeze(Object.values(CAMPAIGN_STATUS));

/**
 * Who a campaign is for.
 *
 *   list     — an explicit allowlist of emails (CampaignMember rows). The email list,
 *              NOT the QR code, is the security boundary: a QR printed on 200 cards is
 *              a shared secret at best and will be photographed into a WhatsApp group.
 *   everyone — any authenticated customer. A public sale.
 *
 * A 'segment' audience (rule-driven, e.g. "spent over ₹1 lakh") is a deliberate future
 * addition; it is intentionally absent because the customer spend data it would key on
 * is currently absent for most customers, so a rule would confidently exclude the very
 * people it was meant to reward.
 */
export const CAMPAIGN_AUDIENCE = Object.freeze({
  LIST: 'list',
  EVERYONE: 'everyone',
});

export const CAMPAIGN_AUDIENCES = Object.freeze(Object.values(CAMPAIGN_AUDIENCE));

/**
 * A member's progress through the funnel. Reporting only — never the enforcement
 * point for "once per customer". That is enforced atomically by the coupon's
 * per-user usage counter (CouponUserUsage's guarded upsert on a unique index),
 * because a status field read-then-written is not atomic and two concurrent
 * checkouts would both pass it.
 */
export const CAMPAIGN_MEMBER_STATUS = Object.freeze({
  INVITED: 'invited',   // on the list, has not yet been identified as a logged-in user
  CLAIMED: 'claimed',   // matched to a verified account; eligible to redeem
  REDEEMED: 'redeemed', // has placed a discounted order
});

export const CAMPAIGN_MEMBER_STATUSES = Object.freeze(Object.values(CAMPAIGN_MEMBER_STATUS));

/**
 * Buyer-facing rejection reasons. Surfaced through the same reported-not-thrown
 * channel pricingService uses for coupons, so an ineligible cart explains itself
 * instead of silently pricing at full value.
 */
export const CAMPAIGN_REASON = Object.freeze({
  INACTIVE: 'This offer is not currently running',
  NOT_STARTED: 'This offer has not started yet',
  ENDED: 'This offer has ended',
  EXHAUSTED: 'This offer has been fully claimed',
  LOGIN: 'Please log in with the email your offer was sent to',
  NOT_INVITED: 'This offer is reserved for invited customers',
  UNVERIFIED: 'Please confirm your email address to use this offer',
  ALREADY_USED: 'You have already used this offer',
  NO_TIER: 'Add more to your cart to unlock this offer',
  TESTING: 'This offer is still being tested',
});

/**
 * Eligibility requires a CONFIRMED email by default, and this is load-bearing rather
 * than cautious: registration creates accounts with `isVerified: false` and the login
 * handler does not gate on it, so without this check anyone who guessed an invited
 * customer's address could register it and take the offer without ever opening that
 * inbox. Redemption must prove mailbox control.
 */
export const CAMPAIGN_REQUIRE_VERIFIED_EMAIL_DEFAULT = true;

/**
 * An 'everyone' campaign has no natural ceiling on payout — it is bounded only by how
 * many customers exist. A redemption cap is therefore mandatory before such a campaign
 * may go live; enforced in campaignService.assertPublishable, not merely advised.
 */
export const CAMPAIGN_REQUIRES_CAP_FOR_EVERYONE = true;
