/**
 * Roav Points — the owner-approved defaults (policy PDF "Roav Points: one
 * currency, six slabs, no ceiling", 2026-11).
 *
 * These seed version 1 of the rule set (models/IncentiveRuleSet.js). After that
 * every number lives in the database and is edited from /admin/incentives; this
 * file is never read for a month that already has a rule version.
 *
 * Money is rupees, points are points. `null` as an upper bound means "no limit".
 */
export const INCENTIVE_DEFAULT_RULES = Object.freeze({
  // 1,960 points per ₹1,00,000 billed (after discount, excluding GST).
  basePointsPerRupee: 0.0196,

  // GST is embedded in our prices. Used only when an order carries no `tax`
  // figure of its own (legacy rows); otherwise ex-GST = goods − order.tax.
  gstRate: 0.18,

  // Invoice multipliers, applied to each PORTION of the ex-GST billed value
  // (like income-tax brackets): the first ₹1.7L at 1.0×, the next part at 1.1×…
  brackets: [
    { upTo: 170000, multiplier: 1.0 },
    { upTo: 450000, multiplier: 1.1 },
    { upTo: 870000, multiplier: 1.2 },
    { upTo: 1400000, multiplier: 1.3 },
    { upTo: null, multiplier: 1.0 },
  ],

  // How much of the order's points survive the discount the seller gave,
  // measured against the website price (B2C) or the dealer price (B2B).
  // A discount of exactly 5% keeps 85%; exactly 10% keeps 60%.
  discountKeep: [
    { maxPercent: 0, keep: 1.0 },
    { maxPercent: 5, keep: 0.85 },
    { maxPercent: 10, keep: 0.6 },
    { maxPercent: null, keep: 0.4 },
  ],
  // Rounding noise (paise) below this percent counts as "no discount".
  discountTolerancePercent: 0.01,

  // There is no dealer price in the catalogue. For a B2B order the dealer price
  // is taken as website price × (1 − this %). 0 = same as the website price.
  // ⚠ Owner to confirm the real dealer margin.
  b2bDealerDiscountPercent: 0,

  // Air-urgent / sub-dealer orders keep this share of their order points.
  specialSourcingKeep: 0.75,

  // Flat points per paid order…
  perOrderBonus: 200,
  // …only when the order's value (after discount, excluding GST) is at least this
  // many rupees. Stops ₹10 test or token orders from collecting the bonus
  // (owner, 2026-11-12, after the backtest found four ₹10 orders).
  perOrderBonusMinValue: 1000,

  // Priority products: flat points per unit sold, by buyer type. The admin
  // picks the exact products on the settings screen.
  priorityProducts: [
    { key: 'profender-bundle', label: 'Profender website bundle', productIds: [], b2c: 5400, b2b: 3200 },
    { key: 'f150-kit', label: 'F-150 kit', productIds: [], b2c: 5000, b2b: 3000 },
  ],

  // A return opened within this many days of payment reverses the line.
  returnWindowDays: 30,
  // If more than this % of a person's month orders were returned, the month total × penalty.
  returnRateThresholdPercent: 10,
  returnPenaltyMultiplier: 0.95,

  // Customer feedback (OrderRating). Needs at least `minCount` ratings in the month.
  rating: { minCount: 3, highAvg: 4.5, highMultiplier: 1.05, lowAvg: 3.5, lowMultiplier: 0.9 },

  // Slabs: the slab reached by FINAL month points sets the rate for ALL points.
  // Below the first slab pays ₹0. No ceiling.
  slabs: [
    { name: 'Crank', minPoints: 11500, ratePerPoint: 0.28 },
    { name: 'Ignition', minPoints: 18700, ratePerPoint: 0.42 },
    { name: 'Torque', minPoints: 27900, ratePerPoint: 0.5 },
    { name: 'Turbo', minPoints: 38600, ratePerPoint: 0.55 },
    { name: 'Nitro', minPoints: 67300, ratePerPoint: 0.7 },
    { name: 'Apex', minPoints: 96800, ratePerPoint: 0.85 },
  ],

  // ⚠ Open question for the owner: the PDF says invoice multipliers "apply up
  // to TURBO". null = multipliers apply at every slab (the formula as written).
  // A slab name here = a person whose month lands ABOVE that slab is paid on
  // points without the invoice multipliers.
  multiplierSlabCap: null,

  // How many days from the 1st the Incentive Champion banner shows.
  championBannerDays: 7,
});
