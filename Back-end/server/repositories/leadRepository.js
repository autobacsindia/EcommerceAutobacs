import BaseRepository from './baseRepository.js';
import Lead from '../models/Lead.js';

/**
 * Lead data access. Adds CRM-specific atomic operations on top of the generic
 * BaseRepository — notably a race-safe self-claim so two reps hitting "Claim"
 * on the same pool lead can't both win.
 */
class LeadRepository extends BaseRepository {
  constructor() {
    super(Lead);
  }

  /** Find by canonical dedup key (email:… / phone:…). */
  async findByIdentityKey(identityKey, session = null) {
    let q = Lead.findOne({ identityKey });
    if (session) q = q.session(session);
    return q;
  }

  async save(lead, session = null) {
    if (session) return lead.save({ session });
    return lead.save();
  }

  /**
   * Atomic self-claim: assign an UNCLAIMED lead to `adminId`. The `assignedTo: null`
   * filter makes this compare-and-set — a second concurrent claim matches no
   * document and returns null. Also logs a `claim` activity in the same write.
   * @returns the claimed lead, or null if it was already claimed.
   */
  async claimIfUnassigned(leadId, adminId) {
    const now = new Date();
    return Lead.findOneAndUpdate(
      { _id: leadId, assignedTo: null },
      {
        $set: { assignedTo: adminId, assignedAt: now },
        $push: { activities: { type: 'claim', by: adminId, at: now } },
      },
      { new: true }
    );
  }

  /**
   * Release a lead back to the shared pool. Guarded on current owner so a rep
   * can only release their own lead (admins pass force=true to release any).
   * @returns the released lead, or null if not owned / already unassigned.
   */
  async releaseIfOwner(leadId, adminId, { force = false } = {}) {
    const filter = force ? { _id: leadId } : { _id: leadId, assignedTo: adminId };
    const now = new Date();
    return Lead.findOneAndUpdate(
      filter,
      {
        $set: { assignedTo: null, assignedAt: null },
        $push: { activities: { type: 'assignment', by: adminId, at: now, notes: 'Released to pool' } },
      },
      { new: true }
    );
  }

  /** Status counts for list tab badges. */
  async statusCounts(baseQuery = {}) {
    const rows = await Lead.aggregate([
      { $match: baseQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    return rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
  }
}

export default new LeadRepository();
