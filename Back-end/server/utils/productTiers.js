/**
 * Product-tier resolution — the pure per-line discount ladder.
 *
 * The sibling of utils/campaignTiers.js, and the distinction is the whole point:
 *
 *   campaignTiers  — ONE percentage for the WHOLE cart, chosen by cart VALUE
 *                    ("spend over ₹1 lakh, get 10%").
 *   productTiers   — a percentage PER LINE, chosen by which tier each PRODUCT
 *                    belongs to ("Profender 8%, Proman 3%, everything else 4%").
 *
 * Kept free of Mongo and config lookups so the money maths can be tested directly;
 * every caller passes plain values in. All arithmetic is integer paise (utils/money.js)
 * because the resolved discount feeds Order.discount and must reconcile exactly with
 * what Razorpay charges.
 *
 * ── Why membership is materialized, not queried ─────────────────────────────────
 *
 * Tiers are AUTHORED from admin search queries ("everything matching `proman`") but
 * membership is committed to CampaignProductTier rows, and only those rows are read
 * at pricing time. A search query is the wrong runtime predicate for money:
 *
 *   - it is fuzzy and synonym-expanded by design (services/searchService.js), so the
 *     matched set is relevance-ranked and moves with the index;
 *   - it is not a brand filter — `proman` returns 39 products of which 15 carry no
 *     brand at all, so no structured field reproduces it;
 *   - Elasticsearch is allowed to be degraded; a price is not;
 *   - it is not auditable six months later, and orders are immutable financial records.
 *
 * The case that settled it: the tier spec contained `cbmcup`, a typo for `comeup`.
 * `comeup` matches 6 products; `cbmcup` fuzzy-matches 928 — the entire catalogue. As a
 * live predicate that one transposed letter would have put every product in the 3% tier
 * and, via LOWEST-WINS below, dragged the 5% and 8% tiers down with it. Silently.
 *
 * ── LOWEST WINS, and why the default must not take part ─────────────────────────
 *
 * A product may match several tiers (the Profender Thar/Jimny/Gypsy kits match both a
 * `profender` tier and a `profender thar` tier). The lowest percentage wins.
 *
 * The default tier ("everything else") is deliberately EXCLUDED from that comparison.
 * It is a FALLBACK, applied only when no explicit tier matched. Let it compete and a
 * 4% default beats a 5% and an 8% tier every time — the premium tiers would silently
 * never fire, correctly, forever. `resolveAssignedTierCode` encodes that, and a test
 * drives it, because the failure is invisible in production.
 */

import { toPaise } from './money.js';

/**
 * Ceiling applied to a line whose product is ALREADY discounted (a live sale window).
 * The buyer gets the smaller of their tier's rate and this — never both in full.
 * Exported so the admin copy and the buyer-facing popup quote one number.
 */
export const ON_SALE_MAX_PERCENT = 2;

/** The tier definition a product falls back to when it matched nothing explicit. */
export function defaultTier(tiers) {
  return (tiers || []).find(t => t?.isDefault) || null;
}

/** Explicit (non-default) tier definitions, in declared order. */
export function explicitTiers(tiers) {
  return (tiers || []).filter(t => t && !t.isDefault);
}

/**
 * ASSIGNMENT TIME: given every tier a product matched, which single tier does it get?
 *
 * Lowest percentage wins; ties keep the earliest-declared tier so the label an operator
 * sees is deterministic. Returns null when nothing explicit matched, which means "use
 * the default at pricing time" — we deliberately do NOT write the default's code onto a
 * product, so changing which tier is default never requires rewriting the catalogue.
 *
 * @param {Array}  tiers        [{ code, label, percent, isDefault }]
 * @param {Array}  matchedCodes codes of every tier this product matched
 * @returns {string|null} the winning tier code, or null for "default"
 */
export function resolveAssignedTierCode(tiers, matchedCodes) {
  const matched = new Set((matchedCodes || []).map(String));
  let winner = null;
  let winnerPercent = Infinity;
  // Only explicit tiers compete — see the header note on why the default must not.
  for (const tier of explicitTiers(tiers)) {
    if (!matched.has(String(tier.code))) continue;
    // An ABSENT percent must be skipped, but an explicit 0 is a legitimate rate that
    // should win. `Number(null)` is 0 and passes Number.isFinite, so a null/blank
    // percent would otherwise resolve to 0%, win lowest-wins, and hand every product
    // in that tier a silent zero discount. Distinguish absent from zero explicitly.
    if (tier.percent === null || tier.percent === undefined || tier.percent === '') continue;
    const percent = Number(tier.percent);
    if (!Number.isFinite(percent)) continue;
    if (percent < winnerPercent) {
      winnerPercent = percent;
      winner = String(tier.code);
    }
  }
  return winner;
}

/**
 * PRICING TIME: the percentage a single cart line earns.
 *
 * `tierCode` is the materialized assignment (null = default). `isOnSale` must be
 * computed LIVE by the caller from pricingService.effectivePrice — never read from a
 * stored flag. Sales are time-boxed by saleEndsAt and revert UPWARD at the expiry
 * instant, ahead of the cron sweep that normalizes the stored fields, so a stored flag
 * is wrong for exactly as long as it takes the sweep to run.
 *
 * @returns {{ percent: number, tierCode: string|null, label: string|null, onSaleCapped: boolean }}
 */
export function resolveLinePercent(tiers, tierCode, isOnSale = false) {
  const explicit = tierCode
    ? explicitTiers(tiers).find(t => String(t.code) === String(tierCode))
    : null;
  const tier = explicit || defaultTier(tiers);

  const basePercent = Math.max(0, Number(tier?.percent) || 0);
  const percent = isOnSale ? Math.min(basePercent, ON_SALE_MAX_PERCENT) : basePercent;

  return {
    percent,
    tierCode: tier ? String(tier.code) : null,
    label: tier?.label || null,
    // True only when the sale ceiling actually REDUCED the rate. A 2% tier on a
    // discounted product is not "capped" — nothing was taken away, and telling the
    // buyer otherwise in the popup would be a lie.
    onSaleCapped: Boolean(isOnSale && basePercent > percent),
  };
}

/** A line's discount in integer paise. Floors — never round a discount up. */
export function lineDiscountPaise(linePaise, percent) {
  const value = Math.max(0, Math.floor(Number(linePaise) || 0));
  const pct = Math.max(0, Number(percent) || 0);
  if (pct <= 0 || value <= 0) return 0;
  return Math.min(value, Math.floor((value * pct) / 100));
}

/**
 * Apportion an order-level ceiling back across the lines that earned the discount.
 *
 * REQUIRED, not cosmetic. Once a cart can hold 3%, 5%, 8% and 2% lines together, the
 * per-line figures are what refundMathService must use to refund a returned line at
 * ITS OWN rate — refundMathService otherwise prorates Order.discount by line gross
 * value, which is exact for a uniform cart percentage and wrong for a blended one
 * (return the 2% item, get refunded at the cart's blended rate). That is the same class
 * of defect as the list-price over-refund fixed on 2026-08-03.
 *
 * So when the ceiling bites, the reduction has to land on the LINES, and the parts must
 * still sum to the whole: Σ apportioned === cap, exactly, with no paise left over. Uses
 * the largest-remainder method — floor each share, then hand out the leftover paise to
 * the largest fractional parts first. Deterministic (index breaks ties), so the same
 * cart always produces the same breakdown.
 *
 * @param {number[]} discounts per-line discount in paise, pre-cap
 * @param {number}   capPaise  the ceiling
 * @returns {number[]} per-line discounts summing to min(Σ discounts, capPaise)
 */
export function apportionCap(discounts, capPaise) {
  const lines = (discounts || []).map(d => Math.max(0, Math.floor(Number(d) || 0)));
  const total = lines.reduce((s, d) => s + d, 0);
  const cap = Math.max(0, Math.floor(Number(capPaise) || 0));
  if (total <= cap) return lines;
  if (cap === 0) return lines.map(() => 0);

  const scaled = lines.map((d, i) => {
    const exact = d * cap;                 // integer; divide once, at the end
    return { i, share: Math.floor(exact / total), rem: exact % total };
  });
  let leftover = cap - scaled.reduce((s, x) => s + x.share, 0);
  // Largest fractional part first; index as a stable tie-break.
  scaled.sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
  for (const entry of scaled) {
    if (leftover <= 0) break;
    entry.share += 1;
    leftover -= 1;
  }

  const out = new Array(lines.length).fill(0);
  for (const { i, share } of scaled) out[i] = share;
  return out;
}

/**
 * Validate a product-tier ladder before it is saved, so the admin screen can refuse a
 * bad configuration rather than discovering it in a live cart.
 * @returns {string[]} human-readable problems; empty means valid.
 */
export function validateProductTiers(tiers) {
  const errors = [];
  const list = Array.isArray(tiers) ? tiers : [];
  if (list.length === 0) return errors;   // no product-tier scheme on this campaign

  const codes = new Set();
  list.forEach((tier, i) => {
    const at = `Tier ${i + 1}${tier?.label ? ` (${tier.label})` : ''}`;
    const code = String(tier?.code || '').trim();
    if (!code) errors.push(`${at}: a code is required.`);
    else if (codes.has(code)) errors.push(`${at}: duplicate tier code "${code}".`);
    codes.add(code);

    const percent = Number(tier?.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      errors.push(`${at}: percent must be between 0 and 100.`);
    }
  });

  const defaults = list.filter(t => t?.isDefault);
  if (defaults.length === 0) {
    errors.push('One tier must be marked as the default ("everything else"), or unlisted products get nothing.');
  } else if (defaults.length > 1) {
    errors.push(`Only one tier can be the default — found ${defaults.length}.`);
  }

  return errors;
}

/** Rupee helper for callers that hold rupees rather than paise. */
export function lineDiscountFromRupees(unitRupees, quantity, percent) {
  return lineDiscountPaise(toPaise(unitRupees) * Math.max(0, Number(quantity) || 0), percent);
}
