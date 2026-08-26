import mongoose from "mongoose";
import {
  SPIN_STATUS,
  SPIN_STATUSES,
  DEFAULT_SEGMENT_COUNT,
  MIN_SEGMENT_COUNT,
  MAX_SEGMENT_COUNT,
  SPIN_CACHE_PATTERN,
} from "../config/spin.js";
import cacheService from "../services/cacheService.js";

/**
 * SpinCampaign — one occasion-scoped run of the post-purchase reward wheel.
 *
 * Owns WHEN the wheel is offered and to WHICH orders. It owns no stock and no odds;
 * those live on SpinPrize rows so goodies can be added, retired or restocked from the
 * admin panel without touching the campaign, and without a deploy.
 *
 * `status: 'off'` is the kill switch: eligibility returns false immediately and the
 * storefront renders no wheel. Instant, reversible, no code change.
 */
const SpinCampaignSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },

  status: { type: String, enum: SPIN_STATUSES, default: SPIN_STATUS.DRAFT, index: true },

  startsAt: { type: Date, required: true },

  /**
   * When the wheel stops being offered.
   *
   * ⚠️ NEVER give this field a TTL index. Expiry must stop the wheel RENDERING, not
   * delete the campaign — the SpinResult rows reference it, and the record of who won
   * what is the audit trail for physical stock that left the building. A TTL here
   * would erase last year's campaign and orphan every winner attached to it. This
   * repo has already been bitten by a TTL on a business collection (carts).
   */
  endsAt: { type: Date, required: true },

  /** Campaign-wide floor. Per-prize gates in SpinPrize.minOrderValuePaise stack on top. */
  minOrderValuePaise: { type: Number, default: 0, min: 0 },

  /**
   * How many spins one customer may win across this campaign. `null` = uncapped.
   *
   * Defaults to 1 — one spin per person per campaign window — because that is what an
   * operator means by "a spin with your order", and the un-capped alternative is a
   * quiet cost leak: a customer placing five orders during the window would otherwise
   * take five goodies off the shelf.
   *
   * Note this is a cap on the PERSON, layered on top of the hard one-spin-per-ORDER
   * guarantee (the unique index on SpinResult.order). Set it to null deliberately if you
   * want every order to earn its own spin.
   *
   * ⚠️ SCOPED TO THIS CAMPAIGN DOCUMENT. The count filters on `campaign: _id`, so a NEW
   * campaign row lets previously-capped customers spin again — which is the intent when
   * you run a second window. It also means re-running a campaign by EDITING startsAt/
   * endsAt on this row does NOT reset anybody: every capped customer stays locked out
   * and the wheel silently disappears for your best repeat buyers. Use the clone action
   * (POST /spin/admin/campaigns/:id/clone) to open a new window, never date-editing.
   *
   * Only `granted` spins count — a cancelled or refunded order voids its result and
   * hands the customer their allowance back along with the goodie.
   *
   * ⚠️ NOT RACE-SAFE, by design. This is a read-then-act check with no atomic guard: if
   * one user spins several orders in the same instant, each read sees a count of 0 and
   * all of them pass. Spins are sequential in practice (one per order-success page), and
   * the guarantees that actually protect inventory are unaffected — stock is claimed
   * atomically and can never be oversold, one-spin-per-order is enforced by a unique
   * index, and minOrderValuePaise still gates the expensive goodies. Worst case is a
   * scripted user taking an extra cheap prize, bounded by real stock. Closing it fully
   * needs an atomic per-user counter document; tests/spinService.test.js pins the
   * current behaviour so it stays a known property.
   */
  maxSpinsPerUserPerCampaign: { type: Number, default: 1, min: 1 },

  /**
   * What share of spins should win a REAL goodie rather than the guaranteed floor prize.
   *
   * This is the one number that controls the whole economy, and it exists because
   * stock-proportional weighting alone cannot price the floor prize: the floor prize has
   * unlimited stock, so "weight ∝ stock" would make it infinitely likely and nothing else
   * could ever be won.
   *
   * So the floor prize's weight is DERIVED, not configured:
   *
   *     floorWeight = totalGoodieWeight × (100 − rate) / rate
   *
   * An operator sets one intuitive quantity — "roughly 1 in 5 customers should win
   * something physical" — and stock-proportional weighting distributes the odds WITHIN
   * the goodies from there. Nobody has to hand-tune a weight against an unbounded one.
   *
   * 100 means every spin wins a real goodie while stock lasts (the floor prize then only
   * appears once everything is exhausted), which is a legitimate but fast-burning mode.
   */
  goodieWinRatePercent: { type: Number, default: 20, min: 1, max: 100 },

  /** Visual slices only. Prize count is independent — see spinService.buildSegments. */
  segmentCount: {
    type: Number,
    default: DEFAULT_SEGMENT_COUNT,
    min: MIN_SEGMENT_COUNT,
    max: MAX_SEGMENT_COUNT,
  },

  /**
   * The post-reveal Google review ask.
   *
   * Deliberately NON-CONTINGENT: the prize is granted and persisted before this is
   * ever shown, and dismissing it changes nothing. Google's policy prohibits
   * incentivised reviews and enforces at Business-Profile level, so gating a prize on
   * a review risks the removal of existing legitimate reviews. It is also
   * unenforceable — Google exposes no callback, so the most any implementation can
   * observe is a click.
   */
  reviewCta: {
    enabled: { type: Boolean, default: true },
    headline: { type: String, default: null, maxlength: 160 },
    body: { type: String, default: null, maxlength: 400 },
    url: { type: String, default: null, maxlength: 500 },
  },

  /**
   * States where the wheel is suppressed, matched against the order's shipping state.
   *
   * Prize competitions sit under state gaming law in India, and a few states (TN, AP,
   * TG) are materially stricter than the rest. This exists so legal can carve a state
   * out as a data change rather than an emergency deploy. Empty = offered everywhere.
   */
  excludedStates: { type: [String], default: [] },

  /** T&Cs rendered under the wheel. Required by the same legal posture as above. */
  terms: { type: String, default: null, maxlength: 5000 },
}, { timestamps: true });

// "Is a campaign live right now" — runs on every eligible order-success render that
// misses the cache. autoIndex is off in prod, so config/db.js builds this for real.
SpinCampaignSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

/**
 * Drop the cached "which campaign is live" answer after ANY write to this collection.
 *
 * The read cache re-checks a cached row's own status and date window, which catches a
 * campaign that simply ran out of time. It cannot catch a row that CHANGED underneath
 * it — flipping status to `off` is the kill switch, and an operator who hits it expects
 * the wheel to stop now, not up to a TTL later.
 *
 * The admin controller also purges `public:spin:*` after its writes. This hook is the
 * one that cannot be bypassed: a migration script, a cron, or a future controller that
 * writes the model directly gets correct invalidation for free, and a stale campaign
 * here means prizes offered on a promotion that is over. Same reasoning as the ES-sync
 * hooks on Product, and the same caveat — `updateMany`/`bulkWrite` skip Mongoose
 * middleware entirely, so any bulk path must invalidate explicitly.
 *
 * Invalidation is best-effort and never blocks or fails the write: the cached entry is
 * short-lived, whereas rejecting an admin's save because Redis hiccuped is a real
 * outage.
 */
function invalidateLiveCampaignCache() {
  cacheService.invalidatePattern(SPIN_CACHE_PATTERN).catch((err) => {
    console.error('[SpinCampaign] cache invalidation failed:', err?.message);
  });
}

SpinCampaignSchema.post('save', invalidateLiveCampaignCache);
SpinCampaignSchema.post('findOneAndUpdate', invalidateLiveCampaignCache);
SpinCampaignSchema.post('updateOne', invalidateLiveCampaignCache);
SpinCampaignSchema.post('updateMany', invalidateLiveCampaignCache);
SpinCampaignSchema.post('findOneAndDelete', invalidateLiveCampaignCache);
SpinCampaignSchema.post('deleteOne', invalidateLiveCampaignCache);
SpinCampaignSchema.post('deleteMany', invalidateLiveCampaignCache);
SpinCampaignSchema.post('insertMany', invalidateLiveCampaignCache);

export default mongoose.models.SpinCampaign || mongoose.model("SpinCampaign", SpinCampaignSchema);
