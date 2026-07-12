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
   * Atomic claim for a name-only rep: assign an UNCLAIMED lead to `repId`. The
   * `assignedRep: null` filter makes this compare-and-set — a second concurrent
   * claim matches no document and returns null, so two browser tabs (or two
   * people on the shared admin login) can't both grab the same pool lead. Logs a
   * `claim` activity crediting the rep, with the operating admin as `by` (audit).
   * @returns the claimed lead, or null if it was already claimed.
   */
  async claimRepIfUnassigned(leadId, repId, adminId) {
    const now = new Date();
    return Lead.findOneAndUpdate(
      { _id: leadId, assignedRep: null },
      {
        $set: { assignedRep: repId, assignedTo: adminId, assignedAt: now },
        $push: { activities: { type: 'claim', by: adminId, rep: repId, at: now, notes: 'Claimed' } },
      },
      { new: true }
    );
  }

  /**
   * Release a lead back to the shared pool (clear the named owner). Admin-guarded
   * at the route; there is no per-rep login to guard on, so any admin can release.
   * @returns the released lead, or null if it doesn't exist.
   */
  async releaseRep(leadId, adminId) {
    const now = new Date();
    // Only clear + log when there is actually an owner to release; the
    // `assignedRep: { $ne: null }` filter makes a release of an already-pooled
    // lead a no-op (no spurious "Released to pool" activity).
    const released = await Lead.findOneAndUpdate(
      { _id: leadId, assignedRep: { $ne: null } },
      {
        $set: { assignedRep: null, assignedTo: null, assignedAt: null },
        $push: { activities: { type: 'assignment', by: adminId, at: now, notes: 'Released to pool' } },
      },
      { new: true }
    );
    if (released) return released;
    // Already unassigned → return current state (idempotent success); null only
    // when the lead genuinely doesn't exist, so the caller still 404s correctly.
    return Lead.findById(leadId);
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
