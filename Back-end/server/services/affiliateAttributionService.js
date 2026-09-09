/**
 * Who gets credited for a sale — resolved server-side, at order time, once.
 *
 * ── THE PRECEDENCE RULE ──────────────────────────────────────────────────────────
 *   1. the coupon that ACTUALLY PRICED the cart, if an affiliate owns it   → 'coupon'
 *   2. otherwise the `ab_ref` cookie                                        → 'link'
 *   3. otherwise nobody
 *
 * A typed code beats the cookie, always. Someone who deliberately entered Rahul's code
 * meant Rahul, whatever link they happened to click three weeks ago.
 *
 * Step 1 keys off the code pricingService actually applied — never the raw request
 * body. A coupon the server REJECTED must not attribute anything, or a buyer could
 * credit an affiliate by typing a code that did nothing.
 *
 * ── THE FAILURE THIS ORDERING PREVENTS ───────────────────────────────────────────
 * If the typed affiliate's code were rejected (suspended, expired) and we then fell
 * back to the cookie, we would silently pay affiliate B for a sale the buyer explicitly
 * credited to A. Instead a suspended affiliate's coupon is refused by pricingService
 * BEFORE this runs, the buyer is told plainly, and no attribution happens at all.
 *
 * ── WHAT THIS MODULE MUST NOT IMPORT ─────────────────────────────────────────────
 * It is called from pricingService and orderService, so it may not import either.
 * Keep the import list to repositories only — the repository pattern is eslint-enforced
 * here (no direct model imports outside repositories/).
 */

import affiliateRepository from '../repositories/affiliateRepository.js';
import couponRepository from '../repositories/couponRepository.js';
import userRepository from '../repositories/userRepository.js';
import { AFFILIATE_STATUS, ATTRIBUTION_SOURCE } from '../config/affiliate.js';

/** Normalise for comparison: emails are lowercased, phones reduced to digits. */
const normalizeEmail = (v) => (v ? String(v).trim().toLowerCase() : null);
const normalizePhone = (v) => {
  const digits = String(v ?? '').replace(/\D/g, '');
  // Compare on the last 10 digits so +91-98765 43210 and 9876543210 are the same
  // person. Shorter strings are too weak to match on and are treated as absent.
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Every identity we know for this buyer, resolved SERVER-SIDE.
 *
 * ⚠️ THE REQUEST BODY IS NOT ENOUGH, and relying on it left the check blind.
 *
 * The checkout page sends `email`/`phone` only for GUEST orders — a signed-in buyer
 * sends neither, because the server already knows who they are. So for authenticated
 * orders the only key left was `affiliate.user`, which is unset for anyone who applied
 * through the public form while logged out (the common case). A signed-in affiliate
 * could therefore use their own code indefinitely: a permanent private discount, plus
 * commission on their own purchases, with nothing in any report to show it.
 *
 * So when there is a userId we load the account and add ITS email and phone to the
 * candidate set. Body-supplied values are kept as additional candidates rather than
 * replaced — a guest may type an address that differs from the account we later match
 * them to, and both are worth comparing.
 *
 * @returns {Promise<{userId: any, emails: string[], phones: string[]}>}
 */
export const resolveBuyerIdentity = async (buyer = {}, session = null) => {
  const emails = new Set();
  const phones = new Set();

  const addEmail = (v) => { const n = normalizeEmail(v); if (n) emails.add(n); };
  const addPhone = (v) => { const n = normalizePhone(v); if (n) phones.add(n); };

  addEmail(buyer.email);
  addPhone(buyer.phone);

  if (buyer.userId) {
    // Best-effort: a failed lookup must not block an order. It degrades to the
    // body-supplied keys, which is exactly the old behaviour, never worse.
    try {
      const user = await userRepository.findById(buyer.userId, [], session);
      if (user) {
        addEmail(user.email);
        addPhone(user.phone);
      }
    } catch {
      /* fall through with whatever the caller supplied */
    }
  }

  return { userId: buyer.userId ?? null, emails: [...emails], phones: [...phones] };
};

/**
 * Is this buyer the affiliate themselves?
 *
 * Pure. Accepts either a raw `{ userId, email, phone }` or the resolved identity from
 * `resolveBuyerIdentity` — callers on the money path must pass the resolved form, since
 * the raw one is blind for authenticated buyers (see above).
 *
 * Three key types, because one is not enough. A determined self-referrer signs up with
 * a second email, so the account link and the phone number both have to count; and a
 * guest checkout still mints a real User keyed on email/phone, so guests are covered by
 * the same comparison rather than needing a separate path.
 *
 * @returns {boolean} true when the sale must NOT be attributed
 */
export const isSelfReferral = (affiliate, buyer = {}) => {
  if (!affiliate) return false;

  if (affiliate.user && buyer.userId && String(affiliate.user) === String(buyer.userId)) return true;

  const candidateEmails = buyer.emails ?? [buyer.email];
  const candidatePhones = buyer.phones ?? [buyer.phone];

  const affEmail = normalizeEmail(affiliate.email);
  if (affEmail && candidateEmails.some((e) => normalizeEmail(e) === affEmail)) return true;

  const affPhone = normalizePhone(affiliate.phone);
  if (affPhone && candidatePhones.some((p) => normalizePhone(p) === affPhone)) return true;

  return false;
};

/**
 * The gate pricingService runs on an affiliate-managed coupon.
 *
 * ⚠️ Self-referral has to be blocked HERE, on the pricing path, not only at commission
 * time. Blocking only the commission still leaves the affiliate a permanent private
 * discount on their own account, forever, on every order — which is the larger loss and
 * the one nobody would notice.
 *
 * Returns a buyer-facing reason string to reject with, or null to allow.
 *
 * @param {object} coupon  the coupon being evaluated (must carry `affiliate`)
 * @param {object} buyer   { userId, email, phone }
 */
export const affiliateCouponGate = async (coupon, buyer = {}, session = null) => {
  if (!coupon?.affiliate) return null;

  const affiliate = await affiliateRepository.findById(coupon.affiliate, [], session);

  // A coupon pointing at a deleted affiliate is broken config, not a discount. Refuse
  // rather than silently honouring it — nobody would ever be paid for these sales.
  if (!affiliate) return 'This referral code is no longer available';

  if (affiliate.status !== AFFILIATE_STATUS.ACTIVE) {
    return 'This referral code is no longer active';
  }

  // Resolved, not taken on trust — see resolveBuyerIdentity. Done only for an affiliate
  // coupon, so the extra read never touches an ordinary coupon's pricing path.
  const identity = await resolveBuyerIdentity(buyer, session);
  if (isSelfReferral(affiliate, identity)) {
    return 'This referral code can’t be used on your own account';
  }

  return null;
};

/**
 * Resolve who to credit for an order that is about to be created.
 *
 * @param {object}  args
 * @param {string}  [args.cookieCode]         `ab_ref` value (already shape-validated)
 * @param {string}  [args.appliedCouponCode]  the code that ACTUALLY priced the cart
 * @param {object}  [args.buyer]              { userId, email, phone }
 * @param {object}  [args.session]            the order transaction
 * @returns {Promise<null|{affiliate, code, source, commissionPercent, attributedAt}>}
 *   Shaped to be written straight onto `Order.affiliate`.
 */
export const resolveAttribution = async ({
  cookieCode = null,
  appliedCouponCode = null,
  buyer = {},
  session = null,
} = {}) => {
  // Resolved ONCE for both limbs: the coupon branch and the cookie branch ask the same
  // question of the same buyer, and doing it here keeps it to a single user read.
  const identity = await resolveBuyerIdentity(buyer, session);

  const snapshot = (affiliate, source) => ({
    affiliate: affiliate._id,
    code: affiliate.code,
    source,
    /*
      SNAPSHOT the rate here, at order time.

      The ledger reads this number and never the live affiliate, so raising someone's
      rate in March cannot retroactively repay January. Same instinct that makes an
      order snapshot its own prices and titles.
    */
    commissionPercent: affiliate.commissionPercent,
    attributedAt: new Date(),
  });

  // ── 1. The coupon that actually priced this cart ────────────────────────────
  if (appliedCouponCode) {
    const coupon = await couponRepository.findByCode(
      String(appliedCouponCode).trim().toUpperCase(),
      session,
    );

    if (coupon?.affiliate) {
      const affiliate = await affiliateRepository.findById(coupon.affiliate, [], session);
      if (affiliate?.status === AFFILIATE_STATUS.ACTIVE && !isSelfReferral(affiliate, identity)) {
        return snapshot(affiliate, ATTRIBUTION_SOURCE.COUPON);
      }
      /*
        Fall through to NOTHING, not to the cookie.

        Reaching here means the buyer typed an affiliate code that priced their cart but
        whose owner we cannot credit. Crediting whoever the cookie names instead would
        pay a different affiliate for a sale the buyer explicitly attributed — the exact
        silent misdirection this ordering exists to prevent.
      */
      return null;
    }
    // A non-affiliate coupon (a sale code, a campaign) priced the cart. That says
    // nothing about who referred the buyer, so the cookie still gets its turn below.
  }

  // ── 2. The tracking link ────────────────────────────────────────────────────
  if (cookieCode) {
    const affiliate = await affiliateRepository.findByCode(cookieCode, {
      activeOnly: true,
      session,
    });
    if (affiliate && !isSelfReferral(affiliate, identity)) {
      return snapshot(affiliate, ATTRIBUTION_SOURCE.LINK);
    }
  }

  // ── 3. Nobody ───────────────────────────────────────────────────────────────
  return null;
};

export default { resolveAttribution, affiliateCouponGate, isSelfReferral, resolveBuyerIdentity };
