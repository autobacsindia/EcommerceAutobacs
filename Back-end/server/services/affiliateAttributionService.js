/**
 * Who gets credited for a sale — resolved server-side, at order time, once.
 *
 * ── THE PRECEDENCE RULE ──────────────────────────────────────────────────────────
 *   1. the coupon that ACTUALLY PRICED the cart, if an affiliate owns it   → 'coupon'
 *   2. otherwise an affiliate code the buyer TYPED but which gave no discount → 'code'
 *   3. otherwise the `ab_ref` cookie                                        → 'link'
 *   4. otherwise nobody
 *
 * A typed code beats the cookie, always — including at step 2. Someone who deliberately
 * entered Rahul's code meant Rahul, whatever link they happened to click three weeks
 * ago, and whether or not the code saved them anything.
 *
 * ── WHY STEP 2 EXISTS ────────────────────────────────────────────────────────────
 * The affiliate's code is their IDENTITY TAG, not only a discount mechanism. The
 * discount is capped at one per person (the managed coupon's `usageLimitPerUser: 1`),
 * so a returning buyer who types the code correctly gets no money off — but the
 * affiliate still sent them, and is still paid, at the lower repeat rate.
 *
 * Without step 2 the two arrival routes disagreed: the same returning buyer earned the
 * affiliate FULL commission via the cookie, and hard-400'd the whole checkout via the
 * code. Step 2 is what makes the two agree.
 *
 * ── WHAT STEP 2 IS NOT ───────────────────────────────────────────────────────────
 * It is NOT "attribute whatever the request body claims". It runs the SAME two guards
 * as step 1 — the affiliate must be ACTIVE, and `isSelfReferral` must be false — so a
 * suspended affiliate's code and an affiliate's own code still credit nobody. What it
 * drops is only the requirement that the coupon moved money.
 *
 * ── THE FAILURE THIS ORDERING PREVENTS ───────────────────────────────────────────
 * If a typed affiliate's code were unusable and we fell straight through to the cookie,
 * we would silently pay affiliate B for a sale the buyer explicitly credited to A.
 * Steps 1 and 2 both `return` rather than falling through for exactly that reason: once
 * the buyer has named an affiliate, the cookie never gets a turn.
 *
 * ── WHAT THIS MODULE MUST NOT IMPORT ─────────────────────────────────────────────
 * It is called from pricingService and orderService, so it may not import either.
 * Keep the import list to repositories only — the repository pattern is eslint-enforced
 * here (no direct model imports outside repositories/).
 */

import affiliateRepository from '../repositories/affiliateRepository.js';
import couponRepository from '../repositories/couponRepository.js';
import orderRepository from '../repositories/orderRepository.js';
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

/** Uppercase + trim a code for comparison, or null. Codes are stored uppercase. */
const normalizeCode = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return s || null;
};

/**
 * Has this buyer ordered from Autobacs before?
 *
 * "Before Autobacs", NOT "before this affiliate" — this decides acquisition vs
 * reactivation, and reactivating someone who already knows us is worth less however
 * they were reached.
 *
 * Reuses `hasActiveOrder`, the same check `firstOrderOnly` uses, so "prior order" means
 * one consistent thing across pricing and commission. Runs BEFORE the order transaction
 * opens, so the order being created is not yet visible — a genuine first order correctly
 * finds nothing.
 *
 * An unidentifiable buyer is treated as NEW. It should be unreachable (both the
 * authenticated and guest order paths resolve a User before this runs), but of the two
 * ways to be wrong, underpaying an affiliate damages the programme more than the rare
 * overpayment does.
 */
const isNewCustomer = async (userId, session = null) => {
  if (!userId) return true;
  return !(await orderRepository.hasActiveOrder(userId, session));
};

/**
 * Resolve who to credit for an order that is about to be created.
 *
 * @param {object}  args
 * @param {string}  [args.cookieCode]           `ab_ref` value (already shape-validated)
 * @param {string}  [args.appliedCouponCode]    the code that ACTUALLY priced the cart
 * @param {string}  [args.requestedCouponCode]  the code the buyer TYPED, applied or not
 * @param {object}  [args.buyer]                { userId, email, phone }
 * @param {object}  [args.session]              the order transaction
 * @returns {Promise<null|{affiliate, code, source, commissionPercent, newCustomer, attributedAt}>}
 *   Shaped to be written straight onto `Order.affiliate`.
 */
export const resolveAttribution = async ({
  cookieCode = null,
  appliedCouponCode = null,
  requestedCouponCode = null,
  buyer = {},
  session = null,
} = {}) => {
  // Resolved ONCE for every limb: they all ask the same question of the same buyer,
  // and doing it here keeps it to a single user read.
  const identity = await resolveBuyerIdentity(buyer, session);

  const snapshot = async (affiliate, source) => {
    const newCustomer = await isNewCustomer(identity.userId, session);

    /*
      SNAPSHOT the rate here, at order time.

      The ledger reads this number and never the live affiliate, so raising someone's
      rate in March cannot retroactively repay January. Same instinct that makes an
      order snapshot its own prices and titles.

      ⚠️ The fallback for an unset repeat rate is the FULL rate, deliberately — NOT the
      configured default. An affiliate approved before repeat rates existed agreed to
      one number, and quietly paying them less than that because a new field defaulted
      low would be a terms change nobody consented to. The config default belongs at
      APPROVAL time, where an admin sees it; here, silence means "no reduction agreed".
    */
    const commissionPercent = newCustomer
      ? affiliate.commissionPercent
      : (affiliate.repeatCommissionPercent ?? affiliate.commissionPercent);

    return {
      affiliate: affiliate._id,
      code: affiliate.code,
      source,
      commissionPercent,
      newCustomer,
      attributedAt: new Date(),
    };
  };

  /**
   * Shared by steps 1 and 2: an affiliate-owned coupon names an affiliate, so decide
   * whether we may credit them. Returns the snapshot, or null meaning "the buyer named
   * someone we cannot pay — credit NOBODY", which both callers propagate rather than
   * falling through to the cookie.
   */
  const creditOwnerOf = async (coupon, source) => {
    const affiliate = await affiliateRepository.findById(coupon.affiliate, [], session);
    if (affiliate?.status === AFFILIATE_STATUS.ACTIVE && !isSelfReferral(affiliate, identity)) {
      return snapshot(affiliate, source);
    }
    return null;
  };

  const applied = normalizeCode(appliedCouponCode);
  const requested = normalizeCode(requestedCouponCode);

  // ── 1. The coupon that actually priced this cart ────────────────────────────
  if (applied) {
    const coupon = await couponRepository.findByCode(applied, session);

    if (coupon?.affiliate) {
      /*
        Whatever this resolves to, it is the answer — including null.

        Reaching a null means the buyer typed an affiliate code that priced their cart
        but whose owner we cannot credit. Crediting whoever the cookie names instead
        would pay a different affiliate for a sale the buyer explicitly attributed —
        the exact silent misdirection this ordering exists to prevent.
      */
      return creditOwnerOf(coupon, ATTRIBUTION_SOURCE.COUPON);
    }
    // A non-affiliate coupon (a sale code, a campaign) priced the cart. That says
    // nothing about who referred the buyer, so the later steps still get their turn.
  }

  // ── 2. An affiliate code the buyer typed that gave them no discount ─────────
  /*
    Skipped when the typed code is the one that applied — step 1 has already given the
    complete answer for it, and repeating the lookup would only cost a second read.
    So this runs exactly when the buyer named a code that did NOT price their cart:
    they had already used their one discount, or a campaign priced the cart instead.
  */
  if (requested && requested !== applied) {
    const coupon = await couponRepository.findByCode(requested, session);
    if (coupon?.affiliate) {
      return creditOwnerOf(coupon, ATTRIBUTION_SOURCE.CODE);
    }
    // Not an affiliate code at all — a typo, or an ordinary coupon that did not apply.
    // Neither says anything about who referred them, so the cookie still gets its turn.
  }

  // ── 3. The tracking link ────────────────────────────────────────────────────
  if (cookieCode) {
    const affiliate = await affiliateRepository.findByCode(cookieCode, {
      activeOnly: true,
      session,
    });
    if (affiliate && !isSelfReferral(affiliate, identity)) {
      return snapshot(affiliate, ATTRIBUTION_SOURCE.LINK);
    }
  }

  // ── 4. Nobody ───────────────────────────────────────────────────────────────
  return null;
};

export default { resolveAttribution, affiliateCouponGate, isSelfReferral, resolveBuyerIdentity };
