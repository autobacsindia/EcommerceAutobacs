/**
 * Campaign tier resolution — the pure discount ladder.
 *
 * A campaign carries a ladder of tiers ("20% up to ₹20,000", "10% above ₹1 lakh")
 * and this module turns a cart value into the winning tier + its rupee discount.
 * Kept free of Mongo and config lookups so the money maths can be property-tested
 * directly; every caller passes plain values in.
 *
 * All arithmetic is integer paise (see utils/money.js) because the resolved discount
 * feeds Order.discount and must reconcile exactly with what Razorpay charges.
 *
 * ── Two resolution modes ────────────────────────────────────────────────────────
 *
 * BEST (default, and what the festival campaign uses):
 *   Every tier whose `minCartValue` is met is evaluated and the LARGEST discount
 *   wins. `maxCartValue` is deliberately IGNORED in this mode — see the monotonicity
 *   note below, it is the whole reason the mode exists.
 *
 * WINDOW:
 *   Strict brackets. The first tier whose [minCartValue, maxCartValue] window
 *   contains the cart value wins, in declared order. Faithful to a "0–1L gets 20%,
 *   above 1L gets 10%" reading, and NOT monotonic — a cart crossing a boundary can
 *   lose discount. Supported because a future occasion may genuinely want brackets,
 *   but it must be chosen deliberately.
 *
 * ── The monotonicity guarantee (BEST mode) ──────────────────────────────────────
 *
 * In BEST mode the resolved discount is guaranteed non-decreasing as the cart grows.
 * Proof sketch, which is also why `maxCartValue` must be ignored here:
 *   - each tier's discount, min(floor(v·p/100), cap), is non-decreasing in v;
 *   - the set of qualifying tiers only ever GROWS as v grows (a min-only gate is
 *     monotone; an upper bound would let a tier drop out and the max could fall);
 *   - a max over a growing set of non-decreasing functions is non-decreasing;
 *   - the absolute ceiling and the clamp to the cart value are both min() with a
 *     non-decreasing bound, which preserves the property.
 *
 * This matters commercially, not just mathematically: the cart shows the saving live
 * as items are added. A ladder that can drop means a customer adding a ₹2 item watches
 * ₹10,000 of saving vanish, which reads as the site cheating them and rewards smaller
 * carts. `assertMonotonic` below is the executable form of this guarantee and is what
 * the property test drives, so an admin editing tiers later cannot reintroduce a cliff.
 */

import { toPaise } from './money.js';

export const TIER_RESOLUTION = Object.freeze({
  BEST: 'best',
  WINDOW: 'window',
});

export const TIER_RESOLUTIONS = Object.freeze(Object.values(TIER_RESOLUTION));

/**
 * Discount a single tier would grant, in integer paise.
 * `percent` is 0–100; `maxDiscount` is an optional rupee cap (null/0 = uncapped).
 */
function tierDiscountPaise(tier, eligiblePaise) {
  const percent = Number(tier?.percent) || 0;
  if (percent <= 0) return 0;
  let paise = Math.floor((eligiblePaise * percent) / 100);
  if (tier?.maxDiscount) paise = Math.min(paise, toPaise(tier.maxDiscount));
  return Math.max(0, paise);
}

/** Tiers whose minimum is met, preserving declared order. */
function qualifyingByMinimum(tiers, eligiblePaise) {
  return (tiers || []).filter(t => eligiblePaise >= toPaise(t?.minCartValue || 0));
}

/**
 * Resolve the winning tier for a cart.
 *
 * @param {Object}  campaign                     plain object or Mongoose doc
 * @param {Array}   campaign.tiers               [{ id, label, minCartValue, maxCartValue, percent, maxDiscount }]
 * @param {string}  [campaign.resolution]        'best' (default) | 'window'
 * @param {number}  [campaign.maxDiscountPerOrder] absolute rupee ceiling across all tiers
 * @param {number}  eligiblePaise                cart value the discount applies to, in paise
 * @returns {{ tierId, label, percent, discountPaise }|null} null when no tier applies
 *          or the winning discount rounds to zero (nothing to show the buyer).
 */
export function resolveTier(campaign, eligiblePaise) {
  const value = Math.max(0, Math.floor(Number(eligiblePaise) || 0));
  const tiers = Array.isArray(campaign?.tiers) ? campaign.tiers : [];
  if (tiers.length === 0 || value <= 0) return null;

  const mode = campaign?.resolution === TIER_RESOLUTION.WINDOW
    ? TIER_RESOLUTION.WINDOW
    : TIER_RESOLUTION.BEST;

  let winner = null;
  let winnerPaise = 0;

  if (mode === TIER_RESOLUTION.WINDOW) {
    // First bracket that contains the value, in declared order.
    for (const tier of tiers) {
      const min = toPaise(tier?.minCartValue || 0);
      const max = tier?.maxCartValue == null ? null : toPaise(tier.maxCartValue);
      if (value >= min && (max === null || value <= max)) {
        winner = tier;
        winnerPaise = tierDiscountPaise(tier, value);
        break;
      }
    }
  } else {
    // Largest discount among every tier the cart has earned. Ties keep the
    // earliest-declared tier so the label shown to the buyer is deterministic.
    for (const tier of qualifyingByMinimum(tiers, value)) {
      const paise = tierDiscountPaise(tier, value);
      if (paise > winnerPaise) {
        winner = tier;
        winnerPaise = paise;
      }
    }
  }

  if (!winner) return null;

  // Campaign-wide ceiling, then never discount more than the cart is worth.
  if (campaign?.maxDiscountPerOrder) {
    winnerPaise = Math.min(winnerPaise, toPaise(campaign.maxDiscountPerOrder));
  }
  winnerPaise = Math.min(winnerPaise, value);

  if (winnerPaise <= 0) return null;

  return {
    tierId: winner.id || null,
    label: winner.label || null,
    percent: Number(winner.percent) || 0,
    discountPaise: winnerPaise,
  };
}

/**
 * Validate a tier ladder before it is saved. Returns an array of human-readable
 * problems (empty === valid) so the admin screen can refuse a bad configuration
 * rather than discovering it in a live cart.
 */
export function validateTiers(campaign) {
  const errors = [];
  const tiers = Array.isArray(campaign?.tiers) ? campaign.tiers : [];
  if (tiers.length === 0) {
    errors.push('At least one tier is required.');
    return errors;
  }

  const mode = campaign?.resolution || TIER_RESOLUTION.BEST;
  const seen = new Set();

  tiers.forEach((tier, i) => {
    const at = `Tier ${i + 1}${tier?.label ? ` (${tier.label})` : ''}`;
    const percent = Number(tier?.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      errors.push(`${at}: percent must be between 0 and 100.`);
    }
    if (Number(tier?.minCartValue || 0) < 0) errors.push(`${at}: minimum cart value cannot be negative.`);
    if (tier?.maxDiscount != null && Number(tier.maxDiscount) < 0) {
      errors.push(`${at}: maximum discount cannot be negative.`);
    }
    if (tier?.maxCartValue != null && Number(tier.maxCartValue) < Number(tier?.minCartValue || 0)) {
      errors.push(`${at}: maximum cart value is below its minimum.`);
    }
    if (tier?.id) {
      if (seen.has(tier.id)) errors.push(`${at}: duplicate tier id "${tier.id}".`);
      seen.add(tier.id);
    }
    // An upper bound is meaningless in BEST mode and signals the author expected
    // brackets. Flag it loudly rather than silently ignoring the field, since the
    // difference between the two readings is thousands of rupees per order.
    if (mode === TIER_RESOLUTION.BEST && tier?.maxCartValue != null) {
      errors.push(
        `${at}: maxCartValue is ignored in "best" resolution (it would break the ` +
        `never-decreasing discount guarantee). Remove it, or switch to "window".`
      );
    }
  });

  if (mode === TIER_RESOLUTION.WINDOW && tiers.length > 0) {
    // Brackets must cover from zero upward or a small cart silently gets nothing.
    const lowest = Math.min(...tiers.map(t => Number(t?.minCartValue || 0)));
    if (lowest > 0) errors.push(`No tier covers carts below ₹${lowest}.`);
  }

  return errors;
}

/**
 * Assert the ladder's discount never decreases as the cart grows.
 *
 * Exported (not test-only) so the admin save path can run it against a proposed
 * configuration and refuse a cliff before it reaches a customer's cart. Walks a
 * spread of cart values plus every tier boundary ±1 paise, which is exactly where
 * a cliff hides.
 *
 * @returns {{ ok: boolean, at?: number, from?: number, to?: number }}
 */
export function assertMonotonic(campaign, maxRupees = 1_000_000) {
  const probes = new Set();
  for (let r = 0; r <= maxRupees; r += Math.max(1, Math.floor(maxRupees / 400))) {
    probes.add(toPaise(r));
  }
  for (const tier of campaign?.tiers || []) {
    for (const bound of [tier?.minCartValue, tier?.maxCartValue]) {
      if (bound == null) continue;
      const p = toPaise(bound);
      probes.add(Math.max(0, p - 1));
      probes.add(p);
      probes.add(p + 1);
    }
  }

  const ordered = [...probes].sort((a, b) => a - b);
  let prev = 0;
  for (const paise of ordered) {
    const discount = resolveTier(campaign, paise)?.discountPaise || 0;
    if (discount < prev) return { ok: false, at: paise, from: prev, to: discount };
    prev = discount;
  }
  return { ok: true };
}
