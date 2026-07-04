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

  /**
   * Denormalize a completed purchase onto the user (drives the CRM "customer"
   * tag). Sets `firstPurchaseAt` only on the first ever purchase, flips
   * `hasPurchased`, and increments the paid-order counter. Called once per order
   * at its first paid transition, so no double-count guard is needed.
   */
  async markPurchased(userId, when = new Date(), session = null) {
    if (!userId) return null;
    await User.updateOne(
      { _id: userId, firstPurchaseAt: null },
      { $set: { firstPurchaseAt: when } },
      session ? { session } : {}
    );
    return User.findByIdAndUpdate(
      userId,
      { $set: { hasPurchased: true }, $inc: { paidOrderCount: 1 } },
      { new: true, ...(session && { session }) }
    );
  }
}

export default new UserRepository();
