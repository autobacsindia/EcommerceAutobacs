/**
 * Affiliate service — the application → approval → suspension lifecycle.
 *
 * ── WHAT THIS SERVICE IS RESPONSIBLE FOR ─────────────────────────────────────────
 * Keeping the Affiliate and its MANAGED COUPON in lockstep. The affiliate owns the
 * decisions; the coupon is the money path (see models/Affiliate.js). Every state
 * change that could make those two disagree happens inside ONE transaction:
 *
 *   approve   → mint the coupon AND flip to active
 *   suspend   → deactivate the coupon AND flip to suspended
 *   reinstate → reactivate the coupon AND flip to active
 *   updateTerms → mirror the buyer discount onto the coupon
 *
 * Splitting any of those would leave a window where a suspended affiliate's code still
 * discounts (we keep paying for promotion we have withdrawn), or an active affiliate
 * has no coupon at all (their code 404s and they think the program is broken).
 *
 * This service does NOT compute commission. That is affiliateCommissionService, which
 * reads the SNAPSHOT on the order, never this document — see the note on
 * Affiliate.commissionPercent.
 */

import mongoose from 'mongoose';
import affiliateRepository from '../repositories/affiliateRepository.js';
import { enqueueNotification } from '../queue/queues.js';
import { CURRENT_AFFILIATE_TERMS_VERSION } from '../config/legalDocuments.js';
import AppError from '../utils/AppError.js';
import {
  AFFILIATE_STATUS,
  CODE_REGEX,
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_DISCOUNT_PERCENT,
} from '../config/affiliate.js';

/** Fields an applicant may set on themselves. Everything else is admin-only. */
const APPLICATION_FIELDS = ['name', 'email', 'phone', 'website', 'pitch', 'gstin'];

/** Payout fields collected on the application. Encrypted by the schema setter on write. */
const PAYOUT_FIELDS = ['accountHolderName', 'accountNumber', 'ifsc'];

/**
 * Derive a candidate code from a name: "Rahul Nair" → "RAHULNAIR".
 *
 * Only a starting point — `mintUniqueCode` resolves collisions. Falls back to a random
 * suffix when the name yields nothing usable (non-Latin scripts, punctuation-only).
 */
const codeFromName = (name) => {
  const base = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
  return base.length >= 3 ? base : `AFF${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
};

/**
 * Is this code free across BOTH namespaces?
 *
 * The coupon namespace is shared with hand-made and campaign coupons, so a code free
 * among affiliates can still be taken. Checking both is what stops an affiliate
 * silently inheriting an unrelated coupon's discount rules and expiry.
 */
const codeIsFree = (candidate, session) => affiliateRepository.codeIsFree(candidate, session);

/**
 * Resolve the code to issue.
 *
 * ⚠️ An EXPLICIT code is used exactly or the approval FAILS. It is never auto-suffixed.
 *
 * That distinction matters commercially, not just technically: an admin types a
 * specific code because it has been agreed with the affiliate and will be printed on
 * their marketing. Quietly issuing `RAHUL101` because `RAHUL10` was taken means every
 * link and card they publish points at a code that does not exist, and nobody finds out
 * until the affiliate asks why they have earned nothing. A 409 is recoverable; a
 * silently different code is not.
 *
 * A DERIVED code (no explicit one given) has no such expectation attached, so a numeric
 * suffix is the right way to resolve a collision between two people with similar names.
 *
 * Either way this is a TOCTOU pre-check, not the guarantee: two admins approving at the
 * same instant can both see a code as free. The sparse unique index on `Affiliate.code`
 * (config/db.js) is what actually prevents a duplicate, and `approve` turns the
 * resulting E11000 into a 409.
 */
const resolveCode = async ({ explicit, name }, session) => {
  if (explicit) {
    const candidate = String(explicit).toUpperCase().trim();
    if (!CODE_REGEX.test(candidate)) {
      throw new AppError('That affiliate code is not a valid format.', 400, { expose: true });
    }
    if (!(await codeIsFree(candidate, session))) {
      throw new AppError(`The code ${candidate} is already taken.`, 409, { expose: true });
    }
    return candidate;
  }

  const base = codeFromName(name);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 20)}${attempt}`;
    if (!CODE_REGEX.test(candidate)) continue;
    if (await codeIsFree(candidate, session)) return candidate;
  }
  throw new AppError('Could not generate a unique affiliate code. Please supply one.', 409);
};

class AffiliateService {
  /**
   * Public application. Anyone may apply; nothing is granted here.
   *
   * A `pending` affiliate attributes nothing and earns nothing — it has no coupon at
   * all — so this endpoint being unauthenticated grants no capability. It is still
   * rate-limited (routes/affiliates.js) because it is an unauthenticated write.
   *
   * @param {object} body
   * @param {string|null} [userId] - the applicant's account, when they are signed in
   */
  async apply(body, { userId = null, ipHash = null } = {}) {
    const data = {};
    for (const key of APPLICATION_FIELDS) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (!data.name) throw new AppError('Name is required', 400);
    if (!data.email) throw new AppError('Email is required', 400);

    const email = String(data.email).trim().toLowerCase();

    /*
      Re-applying must be idempotent from the applicant's point of view.

      Someone who submits twice — a double-click, a back button, a "did that go
      through?" retry a week later — should not get an error they cannot act on, and
      must not create a second row that an admin then has to reconcile. So an existing
      application is returned as-is, and an already-approved affiliate is told plainly
      that they are already in.
    */
    const existing = await affiliateRepository.findByEmail(email);
    if (existing) {
      /*
        ⚠️ EVERY OUTCOME LOOKS THE SAME FROM OUTSIDE.

        This used to throw a distinct 409 for active vs rejected and return quietly for
        pending — which made an unauthenticated endpoint a membership oracle: POST any
        email, read the status code, learn whether that person is an affiliate and
        whether they were turned down. The controller's response body was carefully
        contentless while the STATUS CODE leaked the same thing.

        So a repeat submission is now indistinguishable from a first one, whatever state
        the existing row is in. Nothing is mutated — an admin decision is never undone by
        someone re-submitting a form — and the existing record is returned so the
        controller's generic "received" response is truthful.
      */
      console.log(`[Affiliate] Duplicate application for an existing ${existing.status} affiliate (${existing._id})`);
      return existing;
    }

    /*
      `user` is only set when we can prove the applicant owns the account, i.e. they
      were authenticated. It is never taken from the body: it is a self-referral match
      key, and letting an applicant name their own user id would let them point it at
      somebody else and defeat the check.

      Assigned conditionally rather than as null — the sparse unique index on `user`
      indexes stored nulls, so a null here would block the SECOND account-less
      application. See the field note on models/Affiliate.js.
    */
    const doc = { ...data, email, status: AFFILIATE_STATUS.PENDING };
    if (userId) doc.user = userId;

    // Bank details + PAN. Assigned through the schema, whose setter encrypts them —
    // they are never written anywhere in plaintext, including this object's lifetime
    // in memory beyond the assignment.
    const payoutDetails = {};
    for (const key of PAYOUT_FIELDS) {
      if (body[key] !== undefined) payoutDetails[key] = body[key];
    }
    if (body.panNumber !== undefined) payoutDetails.panNumber = body.panNumber;
    // Derived from the plaintext here, because after assignment it is ciphertext.
    if (body.accountNumber) {
      payoutDetails.accountLast4 = String(body.accountNumber).replace(/\D/g, '').slice(-4);
    }
    if (Object.keys(payoutDetails).length) doc.payoutDetails = payoutDetails;

    if (body.address) {
      doc.address = {
        line1: body.address.line1,
        line2: body.address.line2,
        city: body.address.city,
        state: body.address.state,
        postalCode: body.address.postalCode,
        country: 'India',
      };
    }

    /*
      The accepted VERSION comes from server config, never from the request. The client
      only asserts that the box was ticked; which contract that box bound them to is our
      determination. Recorded at application time because that is when the person
      actually read and agreed to it.
    */
    doc.termsAcceptance = {
      version: CURRENT_AFFILIATE_TERMS_VERSION,
      acceptedAt: new Date(),
      ipHash,
    };

    try {
      return await affiliateRepository.create(doc);
    } catch (err) {
      if (err?.code === 11000) {
        throw new AppError('You already have an affiliate application.', 409, { expose: true });
      }
      throw err;
    }
  }

  /**
   * Approve an application: mint the managed coupon and go active, atomically.
   *
   * The coupon is created in the SAME transaction as the status flip so an `active`
   * affiliate can never exist without its money path. If the coupon insert fails on a
   * duplicate code the whole thing aborts and the affiliate stays pending — which is
   * recoverable — rather than going live with a code that discounts nothing.
   */
  async approve(affiliateId, { code, commissionPercent, discountPercent, firstOrderOnly, adminId } = {}) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const affiliate = await affiliateRepository.findById(affiliateId, [], session);
        if (!affiliate) throw new AppError('Affiliate not found', 404);
        if (affiliate.status === AFFILIATE_STATUS.ACTIVE) {
          // Idempotent: a double-clicked Approve returns the same live affiliate
          // rather than minting a second coupon.
          result = affiliate;
          return;
        }

        if (commissionPercent !== undefined) affiliate.commissionPercent = commissionPercent;
        if (discountPercent !== undefined) affiliate.discountPercent = discountPercent;
        if (firstOrderOnly !== undefined) affiliate.firstOrderOnly = firstOrderOnly;

        /*
          `== null`, NOT a falsy check. `0` is a legitimate, deliberate value for both
          percentages — a link-only affiliate who earns commission but gives the buyer
          no discount, or a goodwill listing at 0% commission. A falsy test silently
          replaces that considered 0 with the default, i.e. starts paying commission
          nobody agreed to.
        */
        if (affiliate.commissionPercent == null) {
          affiliate.commissionPercent = DEFAULT_COMMISSION_PERCENT;
        }
        if (affiliate.discountPercent == null) {
          affiliate.discountPercent = DEFAULT_DISCOUNT_PERCENT;
        }

        affiliate.code = affiliate.code
          || (await resolveCode({ explicit: code, name: affiliate.name }, session));

        /*
          The managed coupon.

          - `visibility: 'hidden'` so it never appears in GET /coupons/available. A code
            listed publicly is a code harvested by coupon-extension sites within days,
            and every one of those redemptions would pay commission on a sale the
            affiliate did nothing to bring.
          - `firstOrderOnly` mirrors the affiliate's setting (default on) — the existing
            Coupon field, already enforced by pricingService. Nothing new evaluates it.
          - `type: 'percentage'`. An affiliate has one flat buyer discount; a cart-value
            tier ladder is what the Campaign engine is for, and building a second one
            here would give us two things to keep in step.
        */
        const coupon = await affiliateRepository.createManagedCoupon(
          {
            code: affiliate.code,
            description: `Affiliate discount — ${affiliate.name}`,
            type: 'percentage',
            value: affiliate.discountPercent,
            visibility: 'hidden',
            firstOrderOnly: affiliate.firstOrderOnly,
            affiliate: affiliate._id,
            isActive: affiliate.discountPercent > 0,
          },
          session,
        );

        affiliate.coupon = coupon._id;
        affiliate.status = AFFILIATE_STATUS.ACTIVE;
        affiliate.approvedAt = new Date();
        affiliate.approvedBy = adminId || null;
        affiliate.suspendedAt = null;
        affiliate.suspendedReason = undefined;

        await affiliate.save({ session });
        result = affiliate;
      });
      /*
        Post-commit, and fire-and-forget: the affiliate is approved whether or not the
        email leaves. Enqueued rather than sent inline so a Postmark outage cannot fail
        an approval that has already been written, and the worker's own once-only claim
        makes a duplicate enqueue harmless.
      */
      if (result?.status === AFFILIATE_STATUS.ACTIVE) {
        enqueueNotification('send-affiliate-approved', { affiliateId: String(result._id) });
      }

      return result;
    } catch (err) {
      if (err?.code === 11000) {
        throw new AppError('That affiliate code is already taken.', 409, { expose: true });
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Decline an application — and PURGE the financial PII it carried.
   *
   * ⚠️ THE PURGE IS NOT OPTIONAL. The application form collects a PAN and a bank account
   * number before anyone has decided to accept the applicant, so a declined application
   * leaves us holding sensitive identifiers for a person we have no relationship with and
   * no reason to pay. That is exactly the stranded-PII shape as the careers uploads that
   * had to be purged after the fact — and the affiliate T&C states plainly that we delete
   * these on rejection, so not doing it would make the document false.
   *
   * The application record itself is KEPT: an admin needs to know this email was already
   * considered and declined, and the public form's duplicate handling depends on it. Only
   * the money-and-identity fields go.
   */
  async reject(affiliateId, notes) {
    const affiliate = await affiliateRepository.findById(affiliateId);
    if (!affiliate) throw new AppError('Affiliate not found', 404);
    if (affiliate.status === AFFILIATE_STATUS.ACTIVE) {
      throw new AppError('Suspend an active affiliate rather than rejecting them.', 400);
    }

    affiliate.status = AFFILIATE_STATUS.REJECTED;
    if (notes !== undefined) affiliate.notes = notes;
    await affiliate.save();

    // $unset rather than assigning null: an absent field cannot be decrypted, cannot be
    // half-cleared, and reads as unambiguously gone in a database dump.
    await affiliateRepository.purgePayoutSecrets(affiliateId);

    return affiliateRepository.findById(affiliateId);
  }

  /**
   * The kill switch. Stops new attribution immediately, in both directions.
   *
   * Deactivating the coupon matters as much as the status flip: without it the code
   * keeps discounting, so we would go on giving away margin for promotion we have
   * explicitly withdrawn — and pricingService would reject the coupon only at the
   * later affiliate gate, which is a worse error message and one more thing to keep
   * in step. Both writes share one transaction so they cannot diverge.
   *
   * ⚠️ Deliberately does NOT touch commissions already attributed. Those orders were
   * genuinely referred and the work was done; voiding them is a separate, explicit
   * admin action that writes an `adjust` row, so the ledger shows a human decided it.
   */
  async suspend(affiliateId, reason) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const affiliate = await affiliateRepository.findById(affiliateId, [], session);
        if (!affiliate) throw new AppError('Affiliate not found', 404);

        affiliate.status = AFFILIATE_STATUS.SUSPENDED;
        affiliate.suspendedAt = new Date();
        if (reason !== undefined) affiliate.suspendedReason = reason;
        await affiliate.save({ session });

        if (affiliate.coupon) {
          await affiliateRepository.setCouponActive(affiliate.coupon, false, session);
        }
        result = affiliate;
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /** Undo a suspension — reactivates the coupon in the same transaction. */
  async reinstate(affiliateId) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const affiliate = await affiliateRepository.findById(affiliateId, [], session);
        if (!affiliate) throw new AppError('Affiliate not found', 404);
        if (!affiliate.coupon) {
          throw new AppError('This affiliate was never approved — approve them instead.', 400);
        }

        affiliate.status = AFFILIATE_STATUS.ACTIVE;
        affiliate.suspendedAt = null;
        affiliate.suspendedReason = undefined;
        await affiliate.save({ session });

        await affiliateRepository.setCouponActive(
          affiliate.coupon,
          affiliate.discountPercent > 0,
          session,
        );
        result = affiliate;
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Change commercial terms.
   *
   * The buyer discount is mirrored onto the coupon in the same transaction — that is
   * the whole point of the coupon being "managed". The commission rate is NOT mirrored
   * anywhere: it is snapshotted per order at creation, so changing it here affects
   * future orders only. Retroactively repricing settled orders is precisely what the
   * snapshot exists to prevent.
   */
  async updateTerms(affiliateId, { commissionPercent, discountPercent, firstOrderOnly, notes, tdsPercent } = {}) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const affiliate = await affiliateRepository.findById(affiliateId, [], session);
        if (!affiliate) throw new AppError('Affiliate not found', 404);

        if (commissionPercent !== undefined) affiliate.commissionPercent = commissionPercent;
        if (discountPercent !== undefined) affiliate.discountPercent = discountPercent;
        if (firstOrderOnly !== undefined) affiliate.firstOrderOnly = firstOrderOnly;
        if (notes !== undefined) affiliate.notes = notes;
        if (tdsPercent !== undefined) affiliate.tdsPercent = tdsPercent;
        await affiliate.save({ session });

        if (affiliate.coupon && (discountPercent !== undefined || firstOrderOnly !== undefined)) {
          await affiliateRepository.syncCouponTerms(
            affiliate.coupon,
            {
              value: affiliate.discountPercent,
              firstOrderOnly: affiliate.firstOrderOnly,
              // A 0% discount would otherwise leave an active coupon that applies
              // nothing — the buyer types the code, sees "applied", and saves ₹0.
              isActive:
                affiliate.status === AFFILIATE_STATUS.ACTIVE && affiliate.discountPercent > 0,
            },
            session,
          );
        }
        result = affiliate;
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Record bank details.
   *
   * ⚠️ Writes financial PII. `accountLast4` is derived here so that every reader — the
   * admin list, the payout snapshot, the affiliate's own dashboard — can identify the
   * account without the full number ever being selected. See models/Affiliate.js.
   */
  async updatePayoutDetails(affiliateId, details = {}) {
    const affiliate = await affiliateRepository.findForPayout(affiliateId);
    if (!affiliate) throw new AppError('Affiliate not found', 404);

    const next = affiliate.payoutDetails || {};
    for (const key of ['accountHolderName', 'ifsc', 'upiId', 'accountNumber', 'panNumber']) {
      if (details[key] !== undefined) next[key] = details[key];
    }
    /*
      Derived from the PLAINTEXT in the request, before the schema setter encrypts it.
      Deriving it from the stored value would mean decrypting on every read just to show
      four digits — which is the opposite of the point.
    */
    if (details.accountNumber !== undefined) {
      const digits = String(details.accountNumber || '').replace(/\D/g, '');
      next.accountLast4 = digits.slice(-4);
    }

    affiliate.payoutDetails = next;
    await affiliate.save();
    // Re-read WITHOUT the sensitive projection so the caller cannot accidentally
    // serialise what it just wrote.
    return affiliateRepository.findById(affiliateId);
  }

  /** Admin list — cursor-paginated, bounded, PII-free (see the repository). */
  async listAdmin({ limit = 50, before = null, status = null, search = null } = {}) {
    const capped = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = await affiliateRepository.findPage({
      limit: capped + 1, // one extra reveals a next page without a count query
      before,
      status,
      search,
    });
    const hasMore = rows.length > capped;
    const affiliates = hasMore ? rows.slice(0, capped) : rows;
    return {
      affiliates,
      nextCursor: hasMore ? affiliates.at(-1).createdAt : null,
    };
  }

  async getById(affiliateId) {
    const affiliate = await affiliateRepository.findById(affiliateId, [
      { path: 'coupon', select: 'code value isActive usedCount' },
    ]);
    if (!affiliate) throw new AppError('Affiliate not found', 404);
    return affiliate;
  }
}

export default new AffiliateService();
export { codeFromName, resolveCode };
