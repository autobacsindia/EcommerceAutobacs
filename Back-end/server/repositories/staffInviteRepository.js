import BaseRepository from './baseRepository.js';
import StaffInvite from '../models/StaffInvite.js';

/**
 * StaffInvite data access. Redemption is a single conditional update so a link
 * can be used exactly once even when two tabs submit at the same moment.
 */
class StaffInviteRepository extends BaseRepository {
  constructor() {
    super(StaffInvite);
  }

  /** Open (not accepted, not revoked) invites for a team, newest first. */
  async findPendingByTeam(team) {
    return StaffInvite.find({ team, acceptedAt: null, revokedAt: null })
      .sort({ createdAt: -1 })
      .lean();
  }

  /** A redeemable invite by token hash — not accepted, not revoked, not expired. */
  async findRedeemable(tokenHash, now = new Date()) {
    return StaffInvite.findOne({
      tokenHash,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { $gt: now },
    }).lean();
  }

  /**
   * Atomically claim an invite for redemption. Returns the invite, or null if it
   * was already used, revoked or expired (including by a concurrent request).
   */
  async claim(tokenHash, now = new Date()) {
    return StaffInvite.findOneAndUpdate(
      { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { acceptedAt: now } },
      { new: true }
    ).lean();
  }

  /** Undo a claim when the account write that should follow it failed. */
  async unclaim(inviteId) {
    return StaffInvite.updateOne({ _id: inviteId }, { $set: { acceptedAt: null, acceptedUser: null } });
  }

  async setAcceptedUser(inviteId, userId) {
    return StaffInvite.updateOne({ _id: inviteId }, { $set: { acceptedUser: userId } });
  }

  /** Revoke every open invite for an address (a newer invite supersedes them). */
  async revokeOpenForEmail(email, revokedBy, now = new Date()) {
    return StaffInvite.updateMany(
      { email, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: now, revokedBy } }
    );
  }

  /** Revoke one open invite. Returns the updated invite, or null if not open. */
  async revokeOpen(inviteId, revokedBy, now = new Date()) {
    return StaffInvite.findOneAndUpdate(
      { _id: inviteId, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: now, revokedBy } },
      { new: true }
    ).lean();
  }
}

export default new StaffInviteRepository();
