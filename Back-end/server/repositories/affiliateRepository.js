import BaseRepository from './baseRepository.js';
import Affiliate from '../models/Affiliate.js';
import Coupon from '../models/Coupon.js';
import { decryptField } from '../utils/fieldEncryption.js';
import { AFFILIATE_STATUS, CODE_MAX_LENGTH, CODE_REGEX } from '../config/affiliate.js';

/**
 * Affiliate data access.
 *
 * ⚠️ FINANCIAL PII. `payoutDetails.accountNumber` and `payoutDetails.panNumber` are
 * `select: false` on the schema, so they are absent from everything here EXCEPT
 * `findForPayout`, which asks for them by name. Do not add `+payoutDetails.…` to any
 * other method: a list endpoint that leaks bank details leaks them for every affiliate
 * at once, and this repository is the only place that choice is made.
 */
class AffiliateRepository extends BaseRepository {
  constructor() {
    super(Affiliate);
  }

  /**
   * Look up by promo/tracking code.
   *
   * The code arrives from a URL query parameter or a cookie — fully client-controlled —
   * so it is normalised and shape-checked BEFORE it reaches the database. A malformed
   * code is not a query, it is a `null`: refusing early keeps junk out of the index and
   * means a caller can never accidentally match on a partial or lowercased string.
   *
   * @param {string} code
   * @param {{ activeOnly?: boolean, session?: import('mongoose').ClientSession }} [opts]
   */
  async findByCode(code, { activeOnly = false, session = null } = {}) {
    const normalized = String(code ?? '').trim().toUpperCase().slice(0, CODE_MAX_LENGTH);
    if (!CODE_REGEX.test(normalized)) return null;

    const query = { code: normalized };
    if (activeOnly) query.status = AFFILIATE_STATUS.ACTIVE;

    let q = Affiliate.findOne(query);
    if (session) q = q.session(session);
    return q;
  }

  /** The affiliate profile owned by a customer account, if any. */
  async findByUser(userId, session = null) {
    if (!userId) return null;
    let q = Affiliate.findOne({ user: userId });
    if (session) q = q.session(session);
    return q;
  }

  /** Applicant lookup — also the dedup check on a new application. */
  async findByEmail(email, session = null) {
    if (!email) return null;
    let q = Affiliate.findOne({ email: String(email).trim().toLowerCase() });
    if (session) q = q.session(session);
    return q;
  }

  /** The affiliate that owns a managed coupon. Used when pricing resolves attribution. */
  async findByCoupon(couponId, session = null) {
    if (!couponId) return null;
    let q = Affiliate.findOne({ coupon: couponId });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Admin list — keyset-paginated on createdAt, newest first, bounded.
   *
   * No skip/offset: the house rule admits no exceptions, and offset would in any case
   * duplicate and skip rows while applications are arriving. Fetching one extra row is
   * how the caller learns there is a next page without a second count query.
   */
  async findPage({ limit = 50, before = null, status = null, search = null } = {}) {
    const query = {};
    if (before) query.createdAt = { $lt: before };
    if (status) query.status = status;
    if (search) {
      // Anchored, escaped prefix match: unanchored user input in a regex is a CPU
      // denial-of-service against a growing collection.
      const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (safe) {
        const rx = new RegExp(`^${safe}`, 'i');
        query.$or = [{ code: rx }, { email: rx }, { name: rx }];
      }
    }

    return Affiliate.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  }

  /**
   * Set the managed coupon's active flag, inside the caller's transaction.
   *
   * Lives here rather than on couponRepository because the caller is always an
   * affiliate lifecycle change (approve / suspend / reinstate / retune) and the
   * affiliate and its coupon must move together or not at all.
   */
  async setCouponActive(couponId, isActive, session = null) {
    const res = await Coupon.updateOne(
      { _id: couponId },
      { $set: { isActive } },
      session ? { session } : {},
    );
    return res.modifiedCount === 1;
  }

  /**
   * Mirror the affiliate's buyer-facing terms onto its managed coupon.
   *
   * Only the discount's SIZE and active flag are terms. The discount RULE — one per
   * person, per code — is fixed for every affiliate and set at creation, so this
   * deliberately does not touch `usageLimitPerUser` or `firstOrderOnly`.
   */
  async syncCouponTerms(couponId, { value, isActive }, session = null) {
    const res = await Coupon.updateOne(
      { _id: couponId },
      { $set: { value, isActive } },
      session ? { session } : {},
    );
    return res.modifiedCount === 1;
  }

  /** Is this code free in BOTH namespaces? Affiliate codes share the coupon namespace. */
  async codeIsFree(code, session = null) {
    const [affiliateClash, couponClash] = await Promise.all([
      Affiliate.findOne({ code }).session(session).select('_id').lean(),
      Coupon.findOne({ code }).session(session).select('_id').lean(),
    ]);
    return !affiliateClash && !couponClash;
  }

  /** Mint the affiliate's managed coupon inside the approval transaction. */
  async createManagedCoupon(doc, session) {
    const [coupon] = await Coupon.create([doc], { session });
    return coupon;
  }

  /**
   * Delete the financial PII from an application we are not going to pay.
   *
   * `$unset`, not a null assignment: an absent field cannot be decrypted, cannot be
   * partially cleared by a later save, and reads as unambiguously gone in a database
   * dump — which is the only place anyone would look to check.
   *
   * `accountLast4` and the IFSC go too. On their own they identify a bank branch and four
   * digits, but kept beside a name and address they are still a fragment of someone's
   * banking identity that we have no reason to hold.
   */
  async purgePayoutSecrets(affiliateId) {
    const res = await Affiliate.updateOne(
      { _id: affiliateId },
      {
        $unset: {
          'payoutDetails.accountNumber': '',
          'payoutDetails.panNumber': '',
          'payoutDetails.accountLast4': '',
          'payoutDetails.ifsc': '',
          'payoutDetails.upiId': '',
          'payoutDetails.accountHolderName': '',
        },
      },
    );
    return res.modifiedCount === 1;
  }

  /**
   * Atomically claim the right to send one notification.
   *
   * `$ne` on the key is the guard, so two concurrent workers cannot both pass a
   * read-then-send check. Returns true only for the caller that won — the loser sends
   * nothing. Mirrors orderRepository.claimInvoiceEmail.
   */
  async claimNotification(affiliateId, key) {
    const res = await Affiliate.updateOne(
      { _id: affiliateId, notifiedEvents: { $ne: key } },
      { $addToSet: { notifiedEvents: key } },
    );
    return res.modifiedCount === 1;
  }

  /** Release a claimed notification key so a failed send can be retried. */
  async releaseNotification(affiliateId, key) {
    await Affiliate.updateOne({ _id: affiliateId }, { $pull: { notifiedEvents: key } });
  }

  /**
   * Load an affiliate WITH its bank details, for building a payout snapshot.
   *
   * The only method that reads the `select: false` fields. Keep it that way, and keep
   * its result off any response body — models/Affiliate.js's toJSON strips them, but
   * a `.lean()` document has no toJSON, so this deliberately returns a hydrated doc.
   */
  async findForPayout(affiliateId, session = null) {
    let q = Affiliate.findById(affiliateId)
      .select('+payoutDetails.accountNumber +payoutDetails.panNumber');
    if (session) q = q.session(session);
    return q;
  }

  /**
   * The DECRYPTED bank details, for the one place that genuinely needs them: assembling
   * a payout or a TDS filing.
   *
   * Returns a plain object, never a document — so there is nothing that can accidentally
   * be saved back with plaintext in it, and nothing that will serialise into a response
   * because it happened to be attached to something that got returned.
   *
   * ⚠️ The ONLY function in the codebase that yields these values in the clear. If you
   * are adding a second one, you almost certainly want `accountLast4` instead.
   */
  async readPayoutSecrets(affiliateId) {
    const affiliate = await this.findForPayout(affiliateId);
    if (!affiliate) return null;

    return {
      accountHolderName: affiliate.payoutDetails?.accountHolderName ?? null,
      ifsc: affiliate.payoutDetails?.ifsc ?? null,
      upiId: affiliate.payoutDetails?.upiId ?? null,
      accountLast4: affiliate.payoutDetails?.accountLast4 ?? null,
      accountNumber: decryptField(affiliate.payoutDetails?.accountNumber) ?? null,
      panNumber: decryptField(affiliate.payoutDetails?.panNumber) ?? null,
    };
  }
}

export default new AffiliateRepository();
