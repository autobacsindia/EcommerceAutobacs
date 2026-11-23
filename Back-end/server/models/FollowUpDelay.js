import mongoose from 'mongoose';

/**
 * One follow-up step on an order that the engine is watching: an order line (or a
 * parcel in transit) sitting in one workflow stage since one moment.
 * services/followUp/* writes it; nothing else does.
 *
 * ── Append-only ─────────────────────────────────────────────────────────────
 * A row is created when the step reaches its reminder point (75% of its SLA) and
 * is never deleted. Once it went late (`lateAt`), the owner AT THAT MOMENT is
 * frozen in `ownerAtLate` and never rewritten — whoever touches the order later,
 * the delay stays with the person whose step it was. Reasons, ladder levels and
 * the excuse are only ever appended or set once. `open` → false when the step
 * moved on (`resolvedAt`); a resolved row is history, not deleted.
 *
 * A row with `lateAt: null` was reminded (or explained in advance) and finished
 * on time: it is not a delay. Delay lists read `lateAt != null`.
 *
 * ── Keys ────────────────────────────────────────────────────────────────────
 * `key` = `order:<orderId>:<stage>:<itemOrParcelId>:<enteredAt ms>` — unique, so
 * two sweeps (replicas, retries) can never create two rows for one step.
 * `levels.<level>` holds the ladder cycle (a Date) that level was CLAIMED for:
 * the sweep claims a level with a compare-and-set before sending, so each level
 * goes out once per cycle. A reason with a next date starts a new cycle.
 */
export const FOLLOWUP_SUBJECTS = Object.freeze(['order']);
export const FOLLOWUP_ITEM_KINDS = Object.freeze(['line', 'parcel']);
export const OWNER_SOURCES = Object.freeze(['mover', 'parcel', 'team_head', 'admins']);
export const RESOLVED_HOW = Object.freeze(['moved_on']);

const person = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, default: '' },
  team: { type: String, default: '' },
  /** How the owner was found: the person who moved it in, the parcel's person, or a fallback. */
  source: { type: String, enum: OWNER_SOURCES, required: true },
};

const FollowUpDelaySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 160 },
    subject: { type: String, enum: FOLLOWUP_SUBJECTS, required: true, default: 'order' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, default: '' },
    stage: { type: String, required: true },
    /** The team whose queue the step is in (operations for parcels in transit). */
    team: { type: String, required: true },
    itemKind: { type: String, enum: FOLLOWUP_ITEM_KINDS, required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    itemName: { type: String, default: '', maxlength: 200 },
    enteredAt: { type: Date, required: true },
    /** The deadline. Updated only while the step is not late yet (a parcel's date can move). */
    dueAt: { type: Date, required: true },
    remindAt: { type: Date, required: true },
    /** Who the step belongs to now (reminder recipient). */
    owner: { type: person, required: true },
    /** Set once, the first sweep after the deadline. */
    lateAt: { type: Date, default: null },
    ownerAtLate: { type: person, default: undefined },
    open: { type: Boolean, default: true },
    resolvedAt: { type: Date, default: null },
    resolvedHow: { type: String, enum: RESOLVED_HOW, default: undefined },
    /** The ladder waits until this moment (a reason's next date, or a later deadline). */
    pausedUntil: { type: Date, default: null },
    levels: {
      remind: { type: Date, default: null },
      due: { type: Date, default: null },
      head: { type: Date, default: null },
      admin: { type: Date, default: null },
    },
    /** Every level claimed, in order (cycle it belonged to, who it went to, live or shadow). */
    levelsReached: {
      type: [{
        level: { type: String, required: true },
        cycle: { type: Date, required: true },
        at: { type: Date, required: true },
        mode: { type: String, enum: ['shadow', 'live'], required: true },
        recipients: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        /** People it went out to (live); 0 in shadow. */
        sent: { type: Number, default: 0 },
        _id: false,
      }],
      default: [],
    },
    reasons: {
      type: [{
        at: { type: Date, required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        byName: { type: String, default: '' },
        code: { type: String, required: true },
        control: { type: String, enum: ['outside', 'inside'], required: true },
        note: { type: String, default: '', maxlength: 300 },
        nextAt: { type: Date, default: null },
        /** Given after the deadline had already passed. */
        givenLate: { type: Boolean, required: true },
        attachment: {
          type: {
            key: String, name: String, mime: String, size: Number, uploadedAt: Date,
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          },
          default: undefined,
          _id: false,
        },
        _id: false,
      }],
      default: [],
    },
    /** A head or admin excused it (with a note). Set once; the row itself stays. */
    excused: {
      type: {
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        byName: { type: String, default: '' },
        note: { type: String, required: true, maxlength: 300 },
        at: { type: Date, required: true },
      },
      default: undefined,
      _id: false,
    },
  },
  { timestamps: true, collection: 'followupdelays' },
);

// Built by scripts/create-followup-indexes.js (prod runs autoIndex off).
FollowUpDelaySchema.index({ key: 1 }, { unique: true, name: 'followup_key' });
// The sweep's keyset walk over open rows (a few dozen at a time).
FollowUpDelaySchema.index({ open: 1, _id: 1 }, { partialFilterExpression: { open: true }, name: 'followup_open' });
// My delays / team / date lists (newest first), late rows only.
FollowUpDelaySchema.index({ 'ownerAtLate.user': 1, lateAt: -1, _id: -1 }, { partialFilterExpression: { lateAt: { $type: 'date' } }, name: 'followup_owner_late' });
FollowUpDelaySchema.index({ team: 1, lateAt: -1, _id: -1 }, { partialFilterExpression: { lateAt: { $type: 'date' } }, name: 'followup_team_late' });
FollowUpDelaySchema.index({ lateAt: -1, _id: -1 }, { partialFilterExpression: { lateAt: { $type: 'date' } }, name: 'followup_late' });
// One order's rows (resolve on order change, order page).
FollowUpDelaySchema.index({ order: 1, stage: 1 }, { name: 'followup_order' });

// Append-only: no row is ever deleted through the model.
const refuseDelete = function refuseDelete() {
  throw new Error('FollowUpDelay rows are append-only and cannot be deleted.');
};
FollowUpDelaySchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], refuseDelete);

export default mongoose.models.FollowUpDelay || mongoose.model('FollowUpDelay', FollowUpDelaySchema);
