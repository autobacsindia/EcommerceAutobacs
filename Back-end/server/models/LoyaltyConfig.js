import mongoose from "mongoose";

/**
 * LoyaltyConfig — singleton settings document for the karma points programme.
 *
 * One document only (key: "default"). Admin-tunable at any time; changing
 * `pointValueInRupees` or `earnRatePercent` affects only FUTURE earn/redeem maths —
 * existing balances are stored in points, valued at redemption time, so there is no
 * retroactive recompute. Read through getLoyaltyConfig() (cached) rather than querying
 * directly.
 */
const LoyaltyConfigSchema = new mongoose.Schema({
  key: { type: String, default: "default", unique: true, immutable: true },

  enabled: { type: Boolean, default: true },

  // ── Earning (credited on delivery) ──────────────────────────────────────────
  // Points earned are worth `earnRatePercent` of the order subtotal, in points.
  earnRatePercent: { type: Number, default: 2, min: 0, max: 100 },
  pointsExpiryDays: { type: Number, default: null, min: 0 }, // null = never expire

  // ── Redemption (spent at checkout) ──────────────────────────────────────────
  pointValueInRupees: { type: Number, default: 1, min: 0 },  // ₹ value of 1 point
  redeemMaxPercent: { type: Number, default: 20, min: 0, max: 100 }, // max % of order points can cover
  minRedeemPoints: { type: Number, default: 100, min: 0 }    // threshold to redeem
}, { timestamps: true });

/** Fetch (or lazily create) the singleton config document. */
LoyaltyConfigSchema.statics.getSingleton = async function () {
  let cfg = await this.findOne({ key: "default" });
  if (!cfg) {
    // Upsert guards against a race where two requests both find none.
    cfg = await this.findOneAndUpdate(
      { key: "default" },
      { $setOnInsert: { key: "default" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return cfg;
};

export default mongoose.model("LoyaltyConfig", LoyaltyConfigSchema);
