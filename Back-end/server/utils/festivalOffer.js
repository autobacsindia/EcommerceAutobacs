/**
 * Festival (Diwali) tiered price offer — the ONE place the offer maths lives.
 *
 * Pure: no Mongo, no config reads, no clock. pricingService passes plain values in and
 * gets the line's offer back; the storefront mirrors this exact function in
 * Front-end/web/src/lib/festival/festivalOffer.ts for DISPLAY only, and both sides run
 * the same case table (tests/fixtures/festivalOfferCases.json) so they cannot drift.
 * The charged price is always the server's.
 *
 * ── Rules (owner decision, 2026-11-07) ─────────────────────────────────────────
 *
 *   The Diwali discount is an EXTRA discount ON TOP of the product's current selling
 *   price (after any existing sale — e.g. M.R.P. ₹1,40,625 → ₹1,12,500 (−20%) →
 *   Diwali 3% → ₹1,09,125). The tier is chosen from that SELLING price, per unit,
 *   never the cart total:
 *
 *       selling price  > ₹2,00,000             →  2%
 *       ₹1,00,000 < selling price ≤ ₹2,00,000  →  3%
 *       ₹50,000 ≤ selling price ≤ ₹1,00,000    →  5%
 *       selling price  < ₹50,000               → 10%
 *
 *   Offer price = selling price × (1 − tier%), rounded DOWN to whole rupees. Products
 *   with no M.R.P. / sale get the same treatment on their price.
 *
 * All arithmetic is integer paise (utils/money.js) because the result is charged.
 */

import { toPaise, fromPaise } from './money.js';

export const FESTIVAL_OFFER_CODE = 'diwali';

/**
 * Tier ladder in integer paise, ascending by `minPaise` (inclusive). A price earns the
 * LAST tier whose `minPaise` it reaches. Expressed in paise so the boundaries are exact:
 * ₹1,00,000.00 is 1,00,00,000 paise and stays in the 5% tier; ₹1,00,000.01 is 3%;
 * ₹2,00,000.00 stays 3% and ₹2,00,000.01 is 2%.
 *
 * Frozen and shipped to the storefront verbatim (public offer payload) so the display
 * mirror never hard-codes its own copy.
 */
export const FESTIVAL_OFFER_TIERS = Object.freeze([
  Object.freeze({ minPaise: 0, percent: 10 }),                  // below ₹50,000
  Object.freeze({ minPaise: 50_000_00, percent: 5 }),           // ₹50,000 – ₹1,00,000
  Object.freeze({ minPaise: 1_00_000_00 + 1, percent: 3 }),     // above ₹1,00,000 up to ₹2,00,000
  Object.freeze({ minPaise: 2_00_000_00 + 1, percent: 2 }),     // above ₹2,00,000
]);

/**
 * Per-product control (owner decision, 2026-11-09). Stored on the product as
 * `festivalOfferSetting`; absent means Automatic, so every existing product keeps the
 * tier ladder with no data migration.
 *
 *   absent              → Automatic: the tier ladder above
 *   { mode: 'none' }    → No Diwali offer: the normal selling price
 *   { mode: 'custom', percent } → this whole % instead of the ladder
 */
export const FESTIVAL_SETTING_MODE = Object.freeze({ AUTO: 'auto', NONE: 'none', CUSTOM: 'custom' });
export const FESTIVAL_CUSTOM_PERCENT_MIN = 1;
export const FESTIVAL_CUSTOM_PERCENT_MAX = 30;

/** Whole numbers from the allowed range only — 7.5, 0, 31 and "7" are all refused. */
export function isValidCustomPercent(percent) {
  return Number.isInteger(percent)
    && percent >= FESTIVAL_CUSTOM_PERCENT_MIN
    && percent <= FESTIVAL_CUSTOM_PERCENT_MAX;
}

/**
 * The stored form of an admin's choice: null for Automatic (the field is removed), else
 * the sub-document. Throws RangeError on anything else so no write path can store a
 * value the price calculation would have to second-guess.
 */
export function toStoredSetting(mode, percent) {
  if (mode === FESTIVAL_SETTING_MODE.AUTO) return null;
  if (mode === FESTIVAL_SETTING_MODE.NONE) return { mode };
  if (mode === FESTIVAL_SETTING_MODE.CUSTOM && isValidCustomPercent(percent)) return { mode, percent };
  throw new RangeError('Invalid Diwali offer setting');
}

/**
 * The % this product earns at this price. A stored value that is neither absent nor
 * valid gives 0 (no offer): a corrupted row must fall back to the normal price, never
 * to a guessed discount.
 */
export function offerPercentForSetting(basePaise, setting, tiers = FESTIVAL_OFFER_TIERS) {
  if (setting == null) return tierPercentForPaise(basePaise, tiers);
  if (setting.mode === FESTIVAL_SETTING_MODE.CUSTOM && isValidCustomPercent(setting.percent)) {
    return setting.percent;
  }
  return 0;
}

/**
 * Per-model control (owner decision, 2026-11-11). Stored on the PRODUCT as
 * `festivalOfferVariantSettings: [{ variantId, mode, percent? }]` — on the product, not
 * on the variant rows, because the normal product save rebuilds the variant list and
 * would wipe anything stored there. A model with NO entry follows the product's
 * setting; an entry overrides it, and here 'auto' is stored explicitly because
 * "absent" already means "same as product".
 */
export const VARIANT_SETTING_MODES = Object.freeze([
  FESTIVAL_SETTING_MODE.AUTO, FESTIVAL_SETTING_MODE.NONE, FESTIVAL_SETTING_MODE.CUSTOM,
]);
/** Admin-only choice: drop the model's own entry so it follows the product again. */
export const FESTIVAL_VARIANT_INHERIT = 'inherit';

/** Stored form of one model's choice, or null for "same as product". Throws RangeError. */
export function toStoredVariantSetting(mode, percent) {
  if (mode === FESTIVAL_VARIANT_INHERIT) return null;
  if (mode === FESTIVAL_SETTING_MODE.AUTO || mode === FESTIVAL_SETTING_MODE.NONE) return { mode };
  if (mode === FESTIVAL_SETTING_MODE.CUSTOM && isValidCustomPercent(percent)) return { mode, percent };
  throw new RangeError('Invalid Diwali offer setting');
}

/**
 * THE one resolver: which setting prices this unit. Cart, checkout, order creation,
 * the Razorpay amount and the shopping feeds all call this (via pricingService /
 * feedFormat); the storefront mirrors it for display only.
 *
 * Returns a value `offerPercentForSetting` understands: null = Automatic,
 * { mode: 'none' } or { mode: 'custom', percent }. A model entry that is present but
 * invalid resolves to { mode: 'none' } — a corrupted row falls back to the normal
 * price, never to a guessed discount. An entry for a model that no longer exists is
 * simply never matched.
 */
export function resolveFestivalSetting(product, variantId = null) {
  const productSetting = product?.festivalOfferSetting ?? null;
  if (variantId == null) return productSetting;
  const entries = Array.isArray(product?.festivalOfferVariantSettings) ? product.festivalOfferVariantSettings : [];
  const id = String(variantId);
  const entry = entries.find((e) => e && String(e.variantId) === id);
  if (!entry) return productSetting;
  if (entry.mode === FESTIVAL_SETTING_MODE.AUTO) return null;
  if (entry.mode === FESTIVAL_SETTING_MODE.NONE) return { mode: FESTIVAL_SETTING_MODE.NONE };
  if (entry.mode === FESTIVAL_SETTING_MODE.CUSTOM && isValidCustomPercent(entry.percent)) {
    return { mode: FESTIVAL_SETTING_MODE.CUSTOM, percent: entry.percent };
  }
  return { mode: FESTIVAL_SETTING_MODE.NONE };
}

/** Entries whose model still exists (by id). Used to prune after a model is deleted. */
export function pruneVariantSettings(entries, variants) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const live = new Set((variants || []).filter((v) => v && v._id != null).map((v) => String(v._id)));
  return entries.filter((e) => e && live.has(String(e.variantId)));
}

/** The percentage a base price (paise) earns, or 0 when it is not a positive price. */
export function tierPercentForPaise(basePaise, tiers = FESTIVAL_OFFER_TIERS) {
  if (!Number.isFinite(basePaise) || basePaise <= 0) return 0;
  let percent = 0;
  for (const tier of tiers) {
    if (basePaise >= tier.minPaise) percent = tier.percent;
  }
  return percent;
}

/**
 * The Diwali offer for one unit of a product/variant, or null when it does not apply.
 *
 * @param {Object} args
 * @param {number} args.unitPrice  rupees — the current selling price WITHOUT the offer
 *                                 (pricingService's effectivePrice, sale expiry honoured)
 * @param {Object} [args.setting]  the product's festivalOfferSetting; absent = Automatic
 * @returns {null | { code, percent, basePrice, finalPrice, discount }}
 *   basePrice  — the price before Diwali (= the selling price the % was taken from)
 *   finalPrice — what one unit costs with the offer, whole rupees
 *   discount   — basePrice − finalPrice, rupees (the Diwali discount amount)
 */
export function applyFestivalOffer({ unitPrice, setting = null }, tiers = FESTIVAL_OFFER_TIERS) {
  const basePaise = toPaise(unitPrice);
  if (!Number.isFinite(basePaise) || basePaise <= 0) return null;

  const percent = offerPercentForSetting(basePaise, setting, tiers);
  if (percent <= 0) return null;

  // Round DOWN to whole rupees: the buyer is never charged more than the advertised %.
  const rawPaise = Math.floor((basePaise * (100 - percent)) / 100);
  const finalPaise = Math.floor(rawPaise / 100) * 100;
  if (finalPaise <= 0 || finalPaise >= basePaise) return null;

  return {
    code: FESTIVAL_OFFER_CODE,
    percent,
    basePrice: fromPaise(basePaise),
    finalPrice: fromPaise(finalPaise),
    discount: fromPaise(basePaise - finalPaise),
  };
}

export default {
  FESTIVAL_OFFER_CODE, FESTIVAL_OFFER_TIERS, FESTIVAL_SETTING_MODE,
  tierPercentForPaise, offerPercentForSetting, isValidCustomPercent, toStoredSetting, applyFestivalOffer,
  VARIANT_SETTING_MODES, FESTIVAL_VARIANT_INHERIT, toStoredVariantSetting, resolveFestivalSetting, pruneVariantSettings,
};
