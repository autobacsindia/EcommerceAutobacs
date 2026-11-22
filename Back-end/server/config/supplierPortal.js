/**
 * Autobacs Partner (supplier app) — shared constants. One place so the supplier
 * API, the procurement API, the tests and the mobile app agree.
 */
export const SUPPLIER_TOKEN_AUDIENCE = 'autobacs-partner';
export const SUPPLIER_TOKEN_TTL = '30d';
// Domain-separation label for the supplier signing key (middleware/supplierAuth.js).
export const SUPPLIER_KEY_LABEL = 'autobacs-partner-token-v1';

// What a supplier may set. `backorder` is a staff-only status.
export const SUPPLIER_AVAILABILITY = Object.freeze(['in', 'low', 'out']);
export const GST_RATES = Object.freeze([0, 5, 12, 18, 28]);

// Margin = profit ÷ selling price WITHOUT GST, in basis points (1% = 100 bp) —
// the same definition as the procurement price calculator
// (Front-end/web/src/components/procurement/pricing.ts, priceBy 'margin').
// Used when no MarginRule row exists. Owner-approved starting point 2026-11-22.
export const DEFAULT_MARGIN_BP = 3000; // 30%
export const DEFAULT_FLOOR_BP = 1000;  // 10% — selling below this needs an explicit override
export const MAX_MARGIN_BP = 9000;

export const MAX_LISTING_IMAGES = 6;
export const MAX_COST_PAISE = 100_000_000; // ₹10,00,000 per unit — anything above is a typo
