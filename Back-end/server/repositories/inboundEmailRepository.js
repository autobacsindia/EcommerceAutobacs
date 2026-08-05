import BaseRepository from './baseRepository.js';
import InboundEmail from '../models/InboundEmail.js';

/**
 * Raw inbound-email data access.
 *
 * Generic CRUD comes from BaseRepository; what lives here are the operational
 * queries — replaying failures and proving the pipe is alive.
 */
class InboundEmailRepository extends BaseRepository {
  constructor() {
    super(InboundEmail);
  }

  /**
   * Emails that were captured but never successfully processed, oldest first.
   * These are customer messages nobody has seen — the replay queue after a bug
   * fix, and the thing an operator should check first when something looks off.
   *
   * `maxAttempts` parks poison payloads so a permanently unparseable message
   * cannot occupy the retry loop forever.
   */
  async findStuck({ maxAttempts = 5, limit = 100 } = {}) {
    return InboundEmail.find({
      status: { $in: ['received', 'processing', 'failed'] },
      attempts: { $lt: maxAttempts },
    })
      .sort({ createdAt: 1 })
      .limit(limit);
  }

  /**
   * Timestamp of the most recently captured email.
   *
   * This backs the liveness alert. A broken inbound webhook is silent — tickets
   * simply stop arriving and the dashboard looks calm — so "when did we last
   * hear anything at all?" is the signal that catches it.
   */
  async lastReceivedAt() {
    const [row] = await InboundEmail.find({})
      .sort({ createdAt: -1 })
      .limit(1)
      .select('createdAt')
      .lean();
    return row?.createdAt || null;
  }

  /** Counts by status over a window, for the ops dashboard. */
  async statusCountsSince(since) {
    return InboundEmail.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
  }
}

export default new InboundEmailRepository();
