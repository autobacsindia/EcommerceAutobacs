/**
 * Karma points service — earning, reversal, manual adjustment, and reads.
 *
 * The KarmaLedger is the immutable source of truth; User.karmaPoints is a
 * denormalised running balance moved only here, always inside a transaction and
 * always alongside a ledger row. Every mutation is idempotent (safe to retry from
 * a queue) — earning via the partial-unique {order,'earn'} index, reversals/clawbacks
 * by checking for an existing ledger row first.
 */

import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import karmaLedgerRepository from '../repositories/karmaLedgerRepository.js';
import AppError from '../utils/AppError.js';
import { getLoyaltyConfig } from './loyaltyConfigService.js';

class KarmaService {
  /** Points earned for an order's subtotal under the current config. */
  _earnedPointsFor(subtotal, cfg) {
    if (!cfg.enabled || cfg.earnRatePercent <= 0 || cfg.pointValueInRupees <= 0) return 0;
    return Math.floor((subtotal * cfg.earnRatePercent) / 100 / cfg.pointValueInRupees);
  }

  /**
   * Credit earned points when an order is delivered. Idempotent: the unique
   * {order,'earn'} index makes a duplicate award abort harmlessly.
   */
  async awardForDelivery(orderId) {
    const order = await orderRepository.findById(orderId);
    // Guard: only a genuinely delivered, not-yet-awarded order earns (safe against
    // a job enqueued for a transition that later rolled back).
    if (!order || order.status !== 'delivered' || order.karmaAwarded || !order.user) return { awarded: 0 };

    const cfg = await getLoyaltyConfig();
    const earned = this._earnedPointsFor(order.subtotal, cfg);
    if (earned <= 0) {
      await orderRepository.markKarmaAwarded(order._id);
      return { awarded: 0 };
    }

    const expiresAt = cfg.pointsExpiryDays
      ? new Date(Date.now() + cfg.pointsExpiryDays * 86_400_000)
      : null;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await userRepository.incrementKarma(order.user, earned, session);
        // Ledger insert carries the idempotency guard; if it dup-keys the whole txn aborts.
        await karmaLedgerRepository.create({
          user: order.user, type: 'earn', points: earned,
          balanceAfter: updated.karmaPoints, order: order._id,
          description: `Earned on order ${order._id}`, expiresAt
        }, session);
        await orderRepository.markKarmaAwarded(order._id, session);
      });
    } catch (err) {
      if (err?.code === 11000) return { awarded: 0 }; // already awarded concurrently
      throw err;
    } finally {
      await session.endSession();
    }
    return { awarded: earned };
  }

  /**
   * Restore points that were redeemed on an order (order cancelled/refunded).
   * Idempotent via the presence of a positive `reverse` ledger row for the order.
   */
  async reverseRedemption(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order || !order.user || !order.karmaPointsUsed) return;

    const already = await karmaLedgerRepository.findOneBy({ order: order._id, type: 'reverse', points: { $gt: 0 } });
    if (already) return;

    const points = order.karmaPointsUsed;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await userRepository.incrementKarma(order.user, points, session);
        await karmaLedgerRepository.create({
          user: order.user, type: 'reverse', points,
          balanceAfter: updated.karmaPoints, order: order._id,
          description: `Restored redeemed points (order ${order._id})`
        }, session);
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Claw back points EARNED on an order that was later refunded. Balance is floored
   * at 0 (the buyer may have already spent them). Idempotent via a negative
   * `reverse` ledger row referencing the original earn.
   */
  async clawbackEarned(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order || !order.user) return;

    const earn = await karmaLedgerRepository.findOneBy({ order: order._id, type: 'earn' });
    if (!earn) return;
    const already = await karmaLedgerRepository.findOneBy({ order: order._id, type: 'reverse', points: { $lt: 0 } });
    if (already) return;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const user = await userRepository.getKarma(order.user, session);
        const deduct = Math.min(earn.points, user?.karmaPoints || 0); // floor at 0
        const updated = await userRepository.incrementKarma(order.user, -deduct, session);
        await karmaLedgerRepository.create({
          user: order.user, type: 'reverse', points: -deduct,
          balanceAfter: updated.karmaPoints, order: order._id, reversalOf: earn._id,
          description: `Clawed back earned points (order ${order._id} refunded)`
        }, session);
      });
    } finally {
      await session.endSession();
    }
  }

  /** Manual admin correction (signed points). Balance is floored at 0 for debits. */
  async adjust(userId, points, description, adminId) {
    const delta = parseInt(points, 10);
    if (!Number.isInteger(delta) || delta === 0) throw new AppError('Adjustment must be a non-zero integer', 400);

    const session = await mongoose.startSession();
    let balanceAfter;
    try {
      await session.withTransaction(async () => {
        const user = await userRepository.getKarma(userId, session);
        if (!user) throw new AppError('User not found', 404);
        const applied = delta < 0 ? -Math.min(-delta, user.karmaPoints) : delta; // never below 0
        const updated = await userRepository.incrementKarma(userId, applied, session);
        balanceAfter = updated.karmaPoints;
        await karmaLedgerRepository.create({
          user: userId, type: 'adjust', points: applied, balanceAfter,
          description: description || `Manual adjustment by admin ${adminId || ''}`.trim()
        }, session);
      });
    } finally {
      await session.endSession();
    }
    return { balance: balanceAfter };
  }

  async getBalance(userId) {
    const user = await userRepository.getKarma(userId);
    return user?.karmaPoints || 0;
  }

  async getHistory(userId, { page = 1, limit = 20 } = {}) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [entries, total] = await Promise.all([
      karmaLedgerRepository.findByUser(userId, { skip, limit }),
      karmaLedgerRepository.countByUser(userId)
    ]);
    return { entries, total, page: Number(page), pages: Math.ceil(total / limit) };
  }
}

export default new KarmaService();
