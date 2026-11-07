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
   * Reverse-lookup: the leads whose `sources[]` reference any of `refs` (e.g. the
   * StockNotificationRequest ids in a Stock Requests drill-down), so each waitlist
   * requester can be paired with its CRM lead + status. Returns lean rows keyed by
   * ref via the returned `sources.ref`.
   */
  async findBySourceRefs(refs) {
    if (!refs?.length) return [];
    return Lead.find({ 'sources.ref': { $in: refs } })
      .select('status sources.ref')
      .lean();
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

  // ── Team panel (/team/leads) ───────────────────────────────────────────────
  // The GTM leads sheet. Every write below is a compare-and-set on the owner the
  // caller saw, so two people acting at once can never both win or log a history
  // line that describes a state the lead was not in.

  static TEAM_FIELDS = {
    name: 1, email: 1, phone: 1, primarySource: 1, 'sources.type': 1, 'sources.snapshot': 1, 'sources.capturedAt': 1,
    // The order / cart behind a signal, to read which products it held.
    'sources.ref': 1, 'sources.refModel': 1,
    followUpStatus: 1, followUpStatusAt: 1,
    status: 1, leadScore: 1, hasPurchased: 1, reopenCount: 1, assignedRep: 1, assignedAt: 1,
    lastContactedAt: 1, nextFollowUpAt: 1, createdAt: 1, updatedAt: 1,
    // Only the newest history line: enough for "last update" and the quiet tag.
    activities: { $slice: -1 },
  };

  /** One keyset page of the team sheet (lean rows, owner name + login populated). */
  async teamPage(query, { sort, limit }) {
    return Lead.find(query, LeadRepository.TEAM_FIELDS)
      .sort(sort).limit(limit)
      .populate('assignedRep', 'name user')
      .lean();
  }

  /** One lead for the team panel, with its whole history (newest `historyLimit` lines). */
  async teamDetail(leadId, historyLimit = 50) {
    return Lead.findById(leadId, { ...LeadRepository.TEAM_FIELDS, activities: { $slice: -historyLimit } })
      .populate('assignedRep', 'name user')
      .populate('activities.by', 'name')
      .populate('activities.rep', 'name')
      .lean();
  }

  /**
   * Follow up: give an UNCLAIMED, OPEN lead to `repId`. Compare-and-set on
   * `assignedRep: null` — of two simultaneous clicks exactly one matches.
   * @returns the updated lead, or null when it was not free (or not open).
   */
  async claimForTeam(leadId, { repId, actorId, openStatuses }) {
    const now = new Date();
    return Lead.findOneAndUpdate(
      { _id: leadId, assignedRep: null, status: { $in: openStatuses } },
      {
        $set: { assignedRep: repId, assignedTo: actorId, assignedAt: now },
        $push: { activities: { type: 'claim', by: actorId, rep: repId, at: now, notes: 'Following up', meta: { via: 'team' } } },
      },
      { new: true, projection: { _id: 1 } }
    ).lean();
  }

  /**
   * Move a lead from `fromRepId` (null = free) to `toRepId` (null = free again),
   * only if it is still with `fromRepId`. Logs one `assignment` line.
   * @returns the updated lead, or null when the owner changed meanwhile.
   */
  async moveOwner(leadId, { fromRepId, toRepId, actorId, notes, action }) {
    const now = new Date();
    return Lead.findOneAndUpdate(
      { _id: leadId, assignedRep: fromRepId },
      {
        $set: { assignedRep: toRepId, assignedTo: toRepId ? actorId : null, assignedAt: toRepId ? now : null },
        $push: {
          activities: {
            type: 'assignment', by: actorId, rep: toRepId, at: now, notes,
            meta: { via: 'team', action, fromRepId, toRepId },
          },
        },
      },
      { new: true, projection: { _id: 1 } }
    ).lean();
  }

  /**
   * Record a follow-up status on the team sheet: push the history line and keep
   * the newest status on the lead. Compare-and-set on the owner the caller saw and
   * on the lead still being open, so a follow-up never lands on a lead that was
   * reassigned, released or closed meanwhile.
   * @returns the updated lead (_id only), or null when it changed.
   */
  async recordTeamFollowUp(leadId, { ownerRepId, openStatuses, entry, set }) {
    return Lead.findOneAndUpdate(
      { _id: leadId, assignedRep: ownerRepId, status: { $in: openStatuses } },
      { $set: set, $push: { activities: entry } },
      { new: true, projection: { _id: 1 } }
    ).lean();
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
