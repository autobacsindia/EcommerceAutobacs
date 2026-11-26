/**
 * Money for the supplier app. All amounts are INTEGER PAISE — the same unit the
 * API stores (`SupplierListing.costPaise`). Typed rupees are converted by
 * reading the digits, never by multiplying a float (0.29 * 100 = 28.999…).
 *
 * This file only ever handles the SUPPLIER'S OWN cost. There is deliberately no
 * selling price, margin or customer price anywhere in this app.
 *
 * No imports, so `node --test` can run it directly.
 */

/** Same ceiling as the API (config/supplierPortal.js MAX_COST_PAISE = ₹10,00,000). */
export const MAX_COST_PAISE = 100_000_000;
export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

export type ParseResult = { ok: true; paise: number } | { ok: false; error: string };

/**
 * "1,800" → 180000, "1800.5" → 180050, "₹ 12.05" → 1205.
 * Rejects negatives, letters, more than 2 decimals, zero and amounts over the cap.
 */
export function rupeesToPaise(input: string): ParseResult {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (cleaned === '') return { ok: false, error: 'Enter your cost' };
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!m) {
    return /^\d*\.\d{3,}$/.test(cleaned)
      ? { ok: false, error: 'Use at most 2 digits after the point' }
      : { ok: false, error: 'Enter an amount in rupees, like 1800 or 1800.50' };
  }
  const rupees = Number(m[1]);
  const paiseDigits = (m[2] ?? '').padEnd(2, '0');
  const paise = rupees * 100 + Number(paiseDigits);
  if (!Number.isSafeInteger(paise)) return { ok: false, error: 'Amount is too large' };
  if (paise <= 0) return { ok: false, error: 'Cost must be more than ₹0' };
  if (paise > MAX_COST_PAISE) return { ok: false, error: 'Cost can be at most ₹10,00,000 per unit' };
  return { ok: true, paise };
}

/** 180050 → "1800.50", 180000 → "1800" (for putting a saved cost back in a text box). */
export function paiseToInput(paise: number): string {
  const r = Math.trunc(paise / 100);
  const p = paise % 100;
  return p === 0 ? String(r) : `${r}.${String(p).padStart(2, '0')}`;
}

/** Indian grouping: 1234567 → "12,34,567". Integer only. */
function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** 180050 → "₹1,800.50", 180000 → "₹1,800". */
export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const r = Math.trunc(abs / 100);
  const p = abs % 100;
  const body = p === 0 ? groupIndian(r) : `${groupIndian(r)}.${String(p).padStart(2, '0')}`;
  return `${neg ? '−' : ''}₹${body}`;
}

/**
 * GST on the supplier's cost, rounded half-up to the paisa. Integer arithmetic:
 * costPaise * pct is exact for every allowed cost (≤ 1e8 × 28).
 */
export function gstOnPaise(costPaise: number, gstPct: number): number {
  return Math.floor((costPaise * gstPct + 50) / 100);
}

/** What the supplier receives per unit: their cost plus GST on it. */
export function supplierPayout(costPaise: number, gstPct: number) {
  const gst = gstOnPaise(costPaise, gstPct);
  return { cost: costPaise, gst, total: costPaise + gst };
}
