import FollowUpDelay from '../models/FollowUpDelay.js';

/**
 * Data access for follow-up rows (models/FollowUpDelay.js). Append-only: there is
 * no delete here, past reasons and ladder entries are only ever $push-ed, and
 * every "set once" field is written with a filter that it is still unset.
 * Who/when/why lives in services/followUp/*.
 */
const LIST_MAX = 100;

const followUpDelayRepository = {
  model: FollowUpDelay,

  /**
   * The row for one step, created on first sight. A concurrent creator with the
   * same key loses on the unique index and reads the winner's row instead.
   */
  async ensure(key, fields) {
    try {
      return await FollowUpDelay.findOneAndUpdate(
        { key },
        { $setOnInsert: { key, ...fields } },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
      return FollowUpDelay.findOne({ key }).lean();
    }
  },

  /** Keep a not-yet-late row's deadline and owner in step with the order. */
  refreshBeforeLate: (id, { dueAt, remindAt, owner }) => FollowUpDelay.findOneAndUpdate(
    { _id: id, open: true, lateAt: null },
    { $set: { dueAt, remindAt, owner } },
    { new: true, lean: true },
  ),

  /** The step went late: freeze who owned it. Once only. */
  markLate: (id, { lateAt, ownerAtLate }) => FollowUpDelay.findOneAndUpdate(
    { _id: id, open: true, lateAt: null },
    { $set: { lateAt, ownerAtLate } },
    { new: true, lean: true },
  ),

  /** A later deadline (the parcel's date moved): the ladder waits for it. Never earlier. */
  pauseUntilAtLeast: (id, until) => FollowUpDelay.findOneAndUpdate(
    { _id: id, open: true },
    { $max: { pausedUntil: until } },
    { new: true, lean: true },
  ),

  /**
   * Claim one ladder level for one cycle. Compare-and-set on the level AND on the
   * pause the sweep read, so a reason saved mid-sweep (a new cycle) wins. True
   * when this caller won and must send.
   */
  async claimLevel(id, level, cycle, pausedUntil) {
    const res = await FollowUpDelay.updateOne(
      { _id: id, open: true, pausedUntil: pausedUntil ?? null, [`levels.${level}`]: { $ne: cycle } },
      { $set: { [`levels.${level}`]: cycle } },
    );
    return res.modifiedCount === 1;
  },

  recordLevel: (id, entry) => FollowUpDelay.updateOne({ _id: id }, { $push: { levelsReached: entry } }),

  /** Append a reason; its next date (if any) becomes the pause. */
  addReason: (id, reason) => FollowUpDelay.findOneAndUpdate(
    { _id: id },
    {
      $push: { reasons: reason },
      ...(reason.nextAt ? { $set: { pausedUntil: reason.nextAt } } : {}),
    },
    { new: true, lean: true },
  ),

  /** Excuse a delay. Once only: an existing excuse is never replaced. */
  excuse: (id, excused) => FollowUpDelay.findOneAndUpdate(
    { _id: id, lateAt: { $type: 'date' }, excused: { $exists: false } },
    { $set: { excused } },
    { new: true, lean: true },
  ),

  resolve: (id, at, how) => FollowUpDelay.findOneAndUpdate(
    { _id: id, open: true },
    { $set: { open: false, resolvedAt: at, resolvedHow: how } },
    { new: true, lean: true },
  ),

  findById: (id) => FollowUpDelay.findById(id).lean(),
  findByKey: (key) => FollowUpDelay.findOne({ key }).lean(),

  /** Open rows after `afterId`, oldest first — keyset on `followup_open`. */
  openPage: (afterId, limit) => FollowUpDelay.find({ open: true, ...(afterId ? { _id: { $gt: afterId } } : {}) })
    .sort({ open: 1, _id: 1 })
    .limit(limit)
    .select('key order itemId stage levelsReached open')
    .lean(),

  /**
   * Late rows, newest first, keyset on (lateAt, _id). One of `owner` / `team`
   * picks the index; neither → all teams (admin). `state` open | resolved | all.
   */
  listLate({ owner = null, team = null, from = null, to = null, state = 'all', before = null, limit = 50 } = {}) {
    const q = { lateAt: { $type: 'date' } };
    if (owner) q['ownerAtLate.user'] = owner;
    else if (team) q.team = team;
    if (from || to) {
      q.lateAt = { $type: 'date', ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
    }
    if (state === 'open') q.open = true;
    else if (state === 'resolved') q.open = false;
    if (before) {
      q.$or = [
        { lateAt: { $lt: before.lateAt } },
        { lateAt: before.lateAt, _id: { $lt: before.id } },
      ];
    }
    // Equality on owner/team + this sort is one range on its index.
    return FollowUpDelay.find(q).sort({ lateAt: -1, _id: -1 }).limit(Math.min(Math.max(1, limit), LIST_MAX)).lean();
  },

  forOrder: (orderId) => FollowUpDelay.find({ order: orderId }).sort({ enteredAt: 1 }).limit(200).lean(),
};

export default followUpDelayRepository;
