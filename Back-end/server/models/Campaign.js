import mongoose from "mongoose";
import {
  CAMPAIGN_STATUS, CAMPAIGN_STATUSES,
  CAMPAIGN_AUDIENCE, CAMPAIGN_AUDIENCES,
  CAMPAIGN_REQUIRE_VERIFIED_EMAIL_DEFAULT,
} from "../config/campaign.js";
import { TIER_RESOLUTION, TIER_RESOLUTIONS } from "../utils/campaignTiers.js";

/**
 * Campaign — a reusable, occasion-scoped promotion (festival thank-you card, public sale).
 *
 * Owns the DECISIONS: who qualifies, how much, for how long, capped at what, on or off.
 * Owns no money. The resolved discount is applied via the campaign's managed Coupon
 * (`couponCode`), so Order.discount / the invoice / refundMathService keep reading a
 * single set of figures. Editing tiers here changes future carts only — placed orders
 * snapshot what the buyer was actually charged and are never recomputed.
 *
 * Everything an operator needs to tune mid-campaign (percentages, thresholds, caps,
 * dates, status) is a field on this document, so changes take effect immediately with
 * no deploy. Tier maths lives in utils/campaignTiers.js.
 */

/**
 * One rung of the discount ladder. `maxCartValue` is only meaningful under 'window'
 * resolution; under 'best' it is rejected at validation time because an upper bound
 * lets a tier drop out as a cart grows, which is precisely what reintroduces a
 * discount cliff (see utils/campaignTiers.js).
 */
const CampaignTierSchema = new mongoose.Schema({
  id: { type: String, required: true, trim: true },     // stable key, e.g. 'festive20'
  label: { type: String, trim: true },                 // buyer-facing, e.g. 'Festive 20'
  minCartValue: { type: Number, min: 0, default: 0 },  // rupees; tier applies at or above
  maxCartValue: { type: Number, min: 0, default: null },
  percent: { type: Number, required: true, min: 0, max: 100 },
  maxDiscount: { type: Number, min: 0, default: null }, // rupee cap on this tier, null = uncapped
}, { _id: false });

/**
 * One product-pricing tier: a named set of products and the rate they earn.
 *
 * The other axis to CampaignTierSchema above, and the two are independent:
 * CampaignTierSchema picks ONE rate for the WHOLE cart from its VALUE; this picks a
 * rate PER LINE from which tier the PRODUCT is in. Membership is not stored here — it
 * lives in CampaignProductTier rows, because a tier can hold hundreds of products and
 * an unbounded array on a hot document is not a membership index.
 *
 * `matchQueries` are the admin search queries the tier was AUTHORED from. They are kept
 * for two jobs only: re-previewing an assignment, and reporting products that match a
 * query but have no row yet (the drift report that stops a materialized scheme rotting
 * as the catalogue grows). They are never evaluated to price a cart.
 */
const CampaignProductTierSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },   // stable key, e.g. 'bronkz'
  label: { type: String, trim: true },                  // operator-facing, e.g. 'Bronkz'
  percent: { type: Number, required: true, min: 0, max: 100 },
  /**
   * The fallback tier — "everything else". Exactly one tier carries this, and it is
   * EXCLUDED from the lowest-wins comparison at assignment time. Letting it compete
   * would make a 4% default beat a 5% and an 8% tier every time, so those tiers would
   * silently never pay out. See utils/productTiers.js.
   */
  isDefault: { type: Boolean, default: false },
  matchQueries: [{ type: String, trim: true }],
}, { _id: false });

const CampaignSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },

  status: { type: String, enum: CAMPAIGN_STATUSES, default: CAMPAIGN_STATUS.DRAFT, index: true },

  // ── Audience ────────────────────────────────────────────────────────────────
  audience: { type: String, enum: CAMPAIGN_AUDIENCES, default: CAMPAIGN_AUDIENCE.LIST },
  /*
    `testerEmails` lived here, alongside a `testing` status that reached only those
    addresses. Both are gone — the test ENVIRONMENT already provides that separation
    with its own database and its own Razorpay keys, and carrying a second, campaign-
    shaped notion of "testing" only produced a state an operator could switch on and
    correctly see nothing happen.

    Deliberately NOT declared as `strict: false` leftovers: the field is simply dropped
    from the schema, so Mongoose stops reading and writing it. Any stray arrays left on
    existing documents are inert and need no migration.
  */
  // Redemption requires a confirmed email. See config/campaign.js — login does not
  // gate on isVerified, so this is what forces proof of mailbox control.
  requireVerifiedEmail: { type: Boolean, default: CAMPAIGN_REQUIRE_VERIFIED_EMAIL_DEFAULT },

  // ── Window ──────────────────────────────────────────────────────────────────
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },

  // ── The discount ladder ─────────────────────────────────────────────────────
  tiers: { type: [CampaignTierSchema], default: undefined },
  resolution: { type: String, enum: TIER_RESOLUTIONS, default: TIER_RESOLUTION.BEST },
  // Absolute rupee ceiling per order, applied after the winning tier's own cap.
  // Guards the uncapped upper tier: 10% of a ₹8 lakh cart is ₹80,000 otherwise.
  maxDiscountPerOrder: { type: Number, min: 0, default: null },

  /**
   * The PER-PRODUCT discount ladder (Bronkz 3% / Sora 5% / Thanos 8% / Ismpor 4%).
   *
   * Independent of `tiers` above: that one reads cart VALUE, this one reads which tier
   * each PRODUCT is in, and yields a different rate per cart line. A campaign uses one
   * axis or the other — running both would stack two discounts on the same goods, which
   * is a margin decision nobody would arrive at by accident.
   *
   * Membership lives in CampaignProductTier (campaign-scoped), so activating this
   * campaign writes no product document: no Elasticsearch re-sync, no catalogue cache
   * purge, and the previous campaign's assignment survives for audit.
   */
  productTiers: { type: [CampaignProductTierSchema], default: undefined },

  /**
   * Opt out of the "discount must never fall as the cart grows" guard.
   *
   * Off by default, and should stay off: a ladder that can drop means a customer
   * watches their saving shrink after adding an item. Exists only so a genuinely
   * intended bracket scheme can be saved — an explicit, recorded decision rather
   * than something an operator stumbles into.
   */
  allowNonMonotonicTiers: { type: Boolean, default: false },

  // The managed Coupon this campaign prices. Hidden-visibility and not hand-editable
  // in the coupon admin — the campaign is the authority for its value.
  couponCode: { type: String, uppercase: true, trim: true, default: null },

  // Stacking: karma on top of a campaign discount is off by default so a festival
  // percentage cannot be compounded with loyalty points.
  allowKarmaStacking: { type: Boolean, default: false },

  // ── Budget guards ───────────────────────────────────────────────────────────
  // Hard stop. `redeemedCount` is incremented with a guarded atomic $inc inside the
  // order transaction, so a limited campaign can never be oversold under concurrency.
  maxRedemptions: { type: Number, min: 0, default: null },
  redeemedCount: { type: Number, default: 0, min: 0 },
  // Running total of discount actually given, for the admin dashboard. Reporting only.
  discountGivenRupees: { type: Number, default: 0, min: 0 },

  // Where the QR code points, e.g. '/festive'. Stored so the landing route and the
  // printed card can be reconciled after the fact — a printed QR can never change.
  landingPath: { type: String, trim: true, default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

// Resolving the active campaign(s) for a cart on every quote.
CampaignSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
// Looking a campaign up from its managed coupon during pricing.
CampaignSchema.index({ couponCode: 1 });

// Deliberately no isWithinWindow()/isExhausted() helpers here. campaignService.evaluate
// needs to distinguish "not started" from "ended" from "fully claimed" to tell the buyer
// which it is, so a boolean helper cannot serve it — and a second copy of the same rule
// on the model is precisely how the two drift apart. The gate lives in one place.

export default mongoose.model("Campaign", CampaignSchema);
export { CampaignTierSchema, CampaignProductTierSchema };
