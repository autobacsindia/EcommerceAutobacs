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
}

export default new UserRepository();
