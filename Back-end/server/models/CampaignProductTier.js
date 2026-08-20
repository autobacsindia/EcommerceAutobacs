import mongoose from "mongoose";

/**
 * CampaignProductTier — which pricing tier a product sits in, FOR ONE CAMPAIGN.
 *
 * The materialized output of an admin assignment. Tiers are AUTHORED from search
 * queries ("everything matching `proman` is Bronkz") but only these rows are read at
 * pricing time; see utils/productTiers.js for why a search query cannot itself be the
 * runtime predicate for money.
 *
 * ── Why this is a join collection, not a field on Product ────────────────────────
 *
 * The requirement is "one categorisation per active campaign, the old one goes away".
 * A single `Product.pricingTierCode` would satisfy that literally and cost three things
 * that matter on a money path:
 *
 *   1. HISTORY. Switching campaigns would overwrite the only record of why a product
 *      was discounted at 3% last month. Orders are immutable financial records; the
 *      configuration that produced a charge has to remain answerable.
 *   2. SWITCHING COST. Every campaign change would rewrite ~278 product documents —
 *      a bulkWrite that bypasses Mongoose hooks and so drags in a mandatory explicit
 *      Elasticsearch re-sync plus a catalogue cache purge, on a collection that is
 *      read on every storefront page. Here, activating a campaign touches NO product
 *      document, so there is no ES drift and no cache to purge.
 *   3. ROLLBACK. Undoing a bad assignment would mean re-running the inverse write.
 *      Scoped this way, a campaign is disabled by flipping its status — instant, and
 *      the assignment survives for the next attempt.
 *
 * So "only one per active campaign" is enforced by SCOPE rather than by deletion: the
 * unique {campaign, product} index guarantees a product has at most one tier within a
 * campaign, and a campaign that is not live simply never resolves. Nothing is destroyed
 * to make room. Two campaigns can hold conflicting assignments harmlessly, because at
 * most one of them is ever pricing a cart.
 */
const CampaignProductTierSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },

  /**
   * The WINNING tier code, already resolved through lowest-wins at assignment time
   * (utils/productTiers.js resolveAssignedTierCode). Resolving overlap once, here,
   * rather than on every cart keeps pricing a lookup instead of a computation — and
   * makes the outcome visible to an operator before a customer ever sees it.
   *
   * Never holds the DEFAULT tier's code: "no row" means "everything else", so which
   * tier is default can change without rewriting the catalogue.
   */
  tierCode: { type: String, required: true, trim: true },

  /**
   * Every tier this product matched, winner included. Pure explainability — the answer
   * to "why is this Profender kit at 3% when Thanos is 8%?" is one row, not a
   * re-derivation from queries that may since have been edited.
   */
  matchedCodes: [{ type: String, trim: true }],

  /** Which admin query produced the match, kept so an assignment can be traced back. */
  matchedQueries: [{ type: String, trim: true }],

  // 'query' — committed from a search-query preview; 'manual' — an operator set it by
  // hand and it must survive a re-run of the query that would otherwise overwrite it.
  source: { type: String, enum: ["query", "manual"], default: "query" },

  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

/**
 * One tier per product per campaign — the "only one categorisation" guarantee, held by
 * the database rather than by application convention. The assignment bulkWrite upserts
 * against this key, so re-running a query is idempotent instead of duplicating rows.
 */
CampaignProductTierSchema.index({ campaign: 1, product: 1 }, { unique: true });

/**
 * Tier roster listing, keyset-paginated on `product` (catalog and admin lists only ever
 * grow, so no skip/offset). Also serves the per-tier counts on the admin screen.
 */
CampaignProductTierSchema.index({ campaign: 1, tierCode: 1, product: 1 });

/**
 * Deliberately NO TTL index. This is a business collection: a TTL here would delete the
 * configuration that explains a historical charge, and a TTL over the `matchedCodes`
 * array would expire on its minimum date and take the whole row with it — the exact
 * mechanism that erased shoppers' carts in production.
 */

export default mongoose.model("CampaignProductTier", CampaignProductTierSchema);
