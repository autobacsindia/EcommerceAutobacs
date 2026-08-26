import mongoose from "mongoose";
import { PRIZE_KIND, PRIZE_KINDS } from "../config/spin.js";

/**
 * SpinPrize — one goodie (or coupon, or karma grant) that the wheel can award.
 *
 * This is the ONLY place in the codebase that tracks real integer stock, and it is
 * deliberately not the catalogue: a goodie is not a Product, never enters
 * Elasticsearch, and never touches WarehouseInventory. See config/spin.js for why
 * that keeps it clear of the `in/low/out` landmine.
 *
 * Adding a goodie mid-campaign is a row insert from the admin panel. Odds recompute
 * themselves from whatever rows exist at draw time — nothing here is a build input.
 */
const SpinPrizeSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: "SpinCampaign", required: true, index: true },

  kind: { type: String, enum: PRIZE_KINDS, default: PRIZE_KIND.GOODIE },

  name: { type: String, required: true, trim: true, maxlength: 120 },

  /**
   * What the packer looks for on the shelf. Required for goodies because the whole
   * fulfilment story ends with a human matching this string to a physical object;
   * a prize with no SKU is one nobody can reliably pick.
   */
  sku: {
    type: String,
    trim: true,
    maxlength: 60,
    required: function () { return this.kind === PRIZE_KIND.GOODIE; },
  },

  imageUrl: { type: String, default: null, maxlength: 500 },
  /** Short label for the wheel slice — long names are unreadable on a segment. */
  shortLabel: { type: String, default: null, maxlength: 24 },

  active: { type: Boolean, default: true },

  // ── Stock ──────────────────────────────────────────────────────────────────
  /**
   * null on BOTH stockTotal and stockRemaining means unlimited.
   *
   * Only the floor prize may be unlimited, and it must be: "everyone wins" is a lie
   * the moment the last goodie is claimed unless something can always be awarded.
   * The publish gate enforces that pairing, so an operator cannot accidentally ship a
   * campaign whose wheel can run dry.
   */
  stockTotal: { type: Number, default: null, min: 0 },
  stockRemaining: { type: Number, default: null, min: 0 },
  stockAwarded: { type: Number, default: 0, min: 0 },

  // ── Odds ───────────────────────────────────────────────────────────────────
  /**
   * 'stock'  — weight ∝ stockRemaining × weightFactor. Self-balancing: 500 keychains
   *            against 5 dashcams gives the dashcam ~1% without anyone tuning it, and
   *            a goodie's odds fall as it depletes, so the pool drains evenly instead
   *            of one item vanishing on day one.
   * 'manual' — weight = manualWeight. The escape hatch for a prize whose stock is not
   *            a fair proxy for how often it should be won.
   */
  weightMode: { type: String, enum: ["stock", "manual"], default: "stock" },
  manualWeight: { type: Number, default: 0, min: 0 },
  /** Multiplier on the stock-derived weight. Suppress or boost without faking stock. */
  weightFactor: { type: Number, default: 1, min: 0 },

  // ── Gates ──────────────────────────────────────────────────────────────────
  /** Margin protection: a ₹499 order should not be able to win a ₹3,000 dashcam. */
  minOrderValuePaise: { type: Number, default: 0, min: 0 },

  /**
   * Optional burn-rate valve. Stock-proportional weighting controls RELATIVE
   * depletion, not depletion over time — if orders spike, the ratios hold but the
   * calendar does not. Set this on expensive goodies when the campaign must last a
   * fixed window. null = uncapped, which is the default because most campaigns do
   * not need it and an unnecessary cap silently starves the wheel.
   */
  maxWinsPerDay: { type: Number, default: null, min: 1 },

  /**
   * Daily-cap accounting, kept ON the prize document so the stock check and the cap
   * check are ONE atomic findOneAndUpdate. Splitting them across two documents would
   * reopen the read-then-write window the whole design exists to close.
   *
   * capDate is an IST calendar day ("YYYY-MM-DD") from utils/datetime.js — never a
   * UTC-derived date. Railway runs UTC, so a naive date would roll the cap at 05:30
   * IST, which is both wrong and invisible in local development.
   */
  capDate: { type: String, default: null },
  capCount: { type: Number, default: 0, min: 0 },

  /**
   * The guaranteed win. Exactly one per campaign, unlimited stock, minOrderValue 0 —
   * all enforced by the publish gate. This is what makes "everyone wins" true, and
   * what the draw falls back to when contention or exhaustion empties the pool.
   */
  isFloorPrize: { type: Boolean, default: false },

  // ── Non-physical payloads ──────────────────────────────────────────────────
  /**
   * kind='coupon' — the discount the ADMIN allots, minted through the EXISTING coupon
   * engine (models/Coupon.js) so there is never a second discount pipeline.
   *
   * ⚠️ Each winner gets their OWN single-use code, not a shared one. That is a deliberate
   * response to a known production gap: `Coupon.usageLimitPerUser` is NOT enforced (the
   * unique index backing it was never built), so a shared code posted to a deals forum
   * could be redeemed without limit. `usageLimit` — the GLOBAL cap — *is* enforced, by an
   * atomic counter. Minting one coupon per winner with a global limit of 1 therefore
   * makes a leaked code worth exactly one redemption, using only the guarantee that
   * actually holds today.
   */
  couponPrefix: { type: String, default: 'SPIN', trim: true, maxlength: 12, uppercase: true },
  couponType: { type: String, enum: ['percentage', 'fixed', 'free_shipping'], default: 'fixed' },
  /** percentage → 0-100; fixed → rupees off; free_shipping → ignored. */
  couponValue: { type: Number, default: 0, min: 0 },
  /** Caps a percentage coupon's rupee value ("10% off, up to ₹500"). null = uncapped. */
  couponMaxDiscount: { type: Number, default: null, min: 0 },
  /** Minimum cart subtotal before the coupon applies. */
  couponMinCartValue: { type: Number, default: 0, min: 0 },
  /** How long the won coupon stays valid, from the moment it is won. */
  couponValidDays: { type: Number, default: 30, min: 1 },
  /** kind='karma': credited via karmaService, skipped if the programme is disabled. */
  karmaPoints: { type: Number, default: 0, min: 0 },

  /** Display order on the admin screen. Does not affect odds. */
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

// The draw's pool query: active prizes for a campaign that still have stock.
SpinPrizeSchema.index({ campaign: 1, active: 1, stockRemaining: 1 });
// The publish gate's "does exactly one floor prize exist" lookup.
SpinPrizeSchema.index({ campaign: 1, isFloorPrize: 1 });

export default mongoose.models.SpinPrize || mongoose.model("SpinPrize", SpinPrizeSchema);
