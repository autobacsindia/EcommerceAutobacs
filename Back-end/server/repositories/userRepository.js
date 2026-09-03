import BaseRepository from './baseRepository.js';
import User from '../models/User.js';

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  async findByEmail(email, session = null) {
    let q = User.findOne({ email: email.toLowerCase() });
    if (session) q = q.session(session);
    return q;
  }

  async findByPhone(phone, session = null) {
    let q = User.findOne({ phone });
    if (session) q = q.session(session);
    return q;
  }

  async save(user, session = null) {
    if (session) return user.save({ session });
    return user.save();
  }

  /**
   * Store an enterprise buyer's details so the next checkout can prefill them.
   *
   * `runValidators` is on (BaseRepository.update default) so a malformed profile
   * is rejected here too — this path is only ever fed by services/buyerService.js,
   * but a saved profile prefills a future order, and a bad value written once
   * would be re-submitted on every subsequent purchase.
   */
  async setBusinessProfile(userId, profile, session = null) {
    /*
      Conditional on purpose: a repeat B2B customer sends the SAME profile on
      every order, so an unconditional update rewrote identical data each time —
      bumping the user document and adding an oplog entry for nothing.

      The `$or` moves that decision into the query, so an unchanged profile costs
      one match and no write, in the same round trip. Measured against a real
      replica set, 300 repeat saves for an unchanged profile:

          unconditional   2233 ms   (7.44 ms/op)   300 writes
          conditional      241 ms   (0.80 ms/op)     0 writes

      9.3x, and more importantly zero write amplification on the user collection.
      This is DB load rather than buyer-facing latency — the caller fires and
      forgets after the order is already committed — which is exactly why it was
      worth fixing cheaply and not worth fixing expensively.

      ⚠️ `$ne` here is a QUERY operator and is entirely fine. The repo's standing
      warning is about `$ne` inside a `partialFilterExpression`, where MongoDB
      rejects the spec and silently never builds the index. Different thing.

      Returns null when nothing changed. Callers must not read that as failure.
    */
    const next = { ...profile, updatedAt: new Date() };
    const billing = profile.billingAddress || {};

    /*
      EVERY stored field is compared, not just the interesting-looking ones.

      The first version listed only gstin/legalName/addressLine1/city/postalCode,
      so a buyer correcting ONLY their billing addressLine2, phone, country or
      state matched nothing and the edit was silently dropped — and because this
      profile prefills the next checkout, the stale value would then be
      re-submitted on every subsequent order. A comparison that is a subset of
      what it writes is worse than no comparison at all.

      `?? null` because Mongoose strips `undefined` out of a query: a field the
      caller omitted would otherwise vanish from the `$or` and stop being
      compared. Against `null`, a missing stored field correctly reads as equal
      (Mongo treats missing as null), so an omitted-and-absent field is still a
      no-op rather than a spurious write.
    */
    const differs = (path, value) => ({ [path]: { $ne: value ?? null } });
    const query = {
      _id: userId,
      $or: [
        differs('businessProfile.legalName', profile.legalName),
        differs('businessProfile.gstin', profile.gstin),
        differs('businessProfile.stateCode', profile.stateCode),
        differs('businessProfile.billingAddress.addressLine1', billing.addressLine1),
        differs('businessProfile.billingAddress.addressLine2', billing.addressLine2),
        differs('businessProfile.billingAddress.city', billing.city),
        differs('businessProfile.billingAddress.state', billing.state),
        differs('businessProfile.billingAddress.stateCode', billing.stateCode),
        differs('businessProfile.billingAddress.postalCode', billing.postalCode),
        differs('businessProfile.billingAddress.country', billing.country),
        differs('businessProfile.billingAddress.phone', billing.phone),
      ],
    };
    let q = User.findOneAndUpdate(query, { $set: { businessProfile: next } }, {
      new: true,
      runValidators: true,
    });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * The two fields campaign eligibility turns on: which mailbox this account is, and
   * whether that mailbox has been proven. Projected because it runs on every checkout
   * quote, and kept as its own method so the eligibility gate can never accidentally
   * be handed a document missing `isVerified` (which would read as "unverified" and
   * silently deny a legitimate invitee).
   */
  async getCampaignIdentity(userId, session = null) {
    let q = User.findById(userId).select('email isVerified').lean();
    if (session) q = q.session(session);
    return q;
  }

  /**
   * What a campaign landing page needs to decide which door to show someone who has
   * typed their email: register, set a password, confirm the address, or just log in.
   *
   * Returns null when no account exists. Callers must only expose this for an address
   * already known to be on a campaign allowlist — otherwise it is an account-existence
   * oracle for arbitrary emails.
   */
  async getCampaignAccountState(email, session = null) {
    let q = User.findOne({ email: String(email || '').toLowerCase().trim() })
      .select('name email isVerified mustResetPassword isGuest')
      .lean();
    if (session) q = q.session(session);
    return q;
  }

  // ── Karma points ────────────────────────────────────────────────────────────

  async getKarma(userId, session = null) {
    let q = User.findById(userId).select('karmaPoints');
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Guarded karma debit: only succeeds when the balance covers `points`, preventing
   * double-spend across concurrent checkouts. Returns the updated user, or null.
   */
  async debitKarmaGuarded(userId, points, session) {
    return User.findOneAndUpdate(
      { _id: userId, karmaPoints: { $gte: points } },
      { $inc: { karmaPoints: -points } },
      { new: true, session }
    );
  }

  /** Unconditional karma delta (earn / reverse / adjust). Caller floors at 0. */
  async incrementKarma(userId, delta, session = null) {
    return User.findByIdAndUpdate(userId, { $inc: { karmaPoints: delta } }, { new: true, session });
  }

  /** Assignable sales reps for the CRM assign dropdown + reporting. */
  async findSalesReps() {
    return User.find({ isSalesRep: true }).select('name email salesTarget').sort({ name: 1 }).lean();
  }

  /**
   * Ids of users whose name, email, OR phone matches `term` (case-insensitive
   * substring). Backs admin filters that let staff search orders by customer. The
   * term is regex-escaped (untrusted input). The cap is a safety valve against a
   * pathological match (e.g. "a") producing an unbounded `$in`; it's set high enough
   * that a realistic customer search (name / partial email / phone) is never truncated.
   */
  async findIdsByNameOrEmail(term, { limit = 10000 } = {}) {
    const escaped = String(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return [];
    const rx = new RegExp(escaped, 'i');
    const users = await User.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] })
      .select('_id')
      .limit(limit)
      .lean();
    return users.map(u => u._id);
  }

  /**
   * Denormalize a completed purchase onto the user (drives the CRM "customer"
   * tag + lifetime value). Sets `firstPurchaseAt` only on the first ever
   * purchase, flips `hasPurchased`, stamps `lastOrderAt`, increments the
   * paid-order counter, and adds this order's value to net LTV. Called once per
   * order at its first paid transition, so no double-count guard is needed.
   *
   * @param {string} userId
   * @param {{ amountPaise?: number, when?: Date }} [opts] integer paise for LTV
   * @param {import('mongoose').ClientSession|null} [session]
   */
  async markPurchased(userId, { amountPaise = 0, when = new Date() } = {}, session = null) {
    if (!userId) return null;
    await User.updateOne(
      { _id: userId, firstPurchaseAt: null },
      { $set: { firstPurchaseAt: when } },
      session ? { session } : {}
    );
    return User.findByIdAndUpdate(
      userId,
      {
        $set: { hasPurchased: true, lastOrderAt: when },
        $inc: { paidOrderCount: 1, totalSpentPaise: Math.max(0, Math.round(amountPaise)) },
      },
      { new: true, ...(session && { session }) }
    );
  }

  /**
   * Reverse a counted purchase on refund/return: subtract this order's value from
   * net LTV and decrement the paid-order count. Both floor at 0 so a refund can
   * never drive the denorm negative (e.g. a legacy order counted before this guard
   * existed). Single atomic aggregation-pipeline update — no read-then-write race.
   * Caller must gate with orderRepository.markPurchaseReversedOnce so this runs
   * exactly once per order. (PAY-2 / ADR-006)
   *
   * @param {string} userId
   * @param {{ amountPaise?: number }} [opts] integer paise removed from LTV
   * @param {import('mongoose').ClientSession|null} [session]
   */
  async reversePurchase(userId, { amountPaise = 0 } = {}, session = null) {
    if (!userId) return null;
    const dec = Math.max(0, Math.round(amountPaise));
    return User.findByIdAndUpdate(
      userId,
      [
        {
          $set: {
            totalSpentPaise: { $max: [0, { $subtract: [{ $ifNull: ['$totalSpentPaise', 0] }, dec] }] },
            paidOrderCount: { $max: [0, { $subtract: [{ $ifNull: ['$paidOrderCount', 0] }, 1] }] },
          },
        },
        // hasPurchased reflects the post-decrement count (evaluated after the stage above).
        { $set: { hasPurchased: { $gt: ['$paidOrderCount', 0] } } },
      ],
      { new: true, ...(session && { session }) }
    );
  }

  /**
   * Reduce net LTV by a refunded amount WITHOUT touching the paid-order count — for a
   * PARTIAL return refund, where the order still counts as a purchase but the customer
   * got some money back. Spend-only counterpart to reversePurchase (ADR-006).
   * @param {string} userId
   * @param {{ amountPaise: number }} args
   */
  async decrementSpend(userId, { amountPaise = 0 } = {}, session = null) {
    if (!userId) return null;
    const dec = Math.max(0, Math.round(amountPaise));
    if (dec === 0) return null;
    return User.findByIdAndUpdate(
      userId,
      [
        {
          $set: {
            totalSpentPaise: { $max: [0, { $subtract: [{ $ifNull: ['$totalSpentPaise', 0] }, dec] }] },
          },
        },
      ],
      { new: true, ...(session && { session }) }
    );
  }
}

export default new UserRepository();
