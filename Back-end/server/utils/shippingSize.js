/**
 * A product's packed parcel size — what a courier charges on.
 *
 * Shiprocket (and every courier behind it) prices a parcel on the larger of its
 * dead weight and its volumetric weight (L×B×H / 5000), so it needs all four
 * numbers. They describe the BOXED item, not the bare product.
 *
 * Every field is optional: no product carries a size today, and a missing size
 * must stay visibly missing (null) rather than becoming a guessed default that
 * would quietly under-quote a heavy roof box.
 *
 * Pure — shared by the Product schema (limits) and the admin write path
 * (normalisation). The admin editor mirrors these limits in
 * Front-end/web/src/lib/shippingSize.ts.
 */

export const SHIPPING_SIZE_FIELDS = Object.freeze(['weightKg', 'lengthCm', 'breadthCm', 'heightCm']);

/** Hard caps. Anything bigger is a freight job, not a courier parcel — and almost certainly a typo (grams typed as kg). */
export const SHIPPING_SIZE_LIMITS = Object.freeze({
  weightKg: { min: 0.01, max: 500 },
  lengthCm: { min: 0.5, max: 400 },
  breadthCm: { min: 0.5, max: 400 },
  heightCm: { min: 0.5, max: 400 },
});

/**
 * Normalise the editor's `shippingSize` payload before it is written.
 *
 *  - blank / null / undefined → null (cleared, "not measured yet")
 *  - numeric string → Number
 *  - anything else is passed through UNCHANGED so the schema rejects it with a
 *    400 — silently dropping a bad value would lose what the admin typed and
 *    show them a success.
 *
 * Unknown keys are dropped. Returns undefined when the input is not an object,
 * so the caller can leave the stored size untouched.
 */
export function normalizeShippingSize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out = {};
  for (const key of SHIPPING_SIZE_FIELDS) {
    const raw = input[key];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      out[key] = null;
      continue;
    }
    if (typeof raw === 'number') {
      out[key] = raw;
      continue;
    }
    if (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw)) {
      out[key] = Number(raw);
      continue;
    }
    out[key] = raw; // let the schema reject it
  }
  return out;
}

/** True when all four numbers are present — the courier can quote this product. */
export function hasCompleteShippingSize(size) {
  return !!size && SHIPPING_SIZE_FIELDS.every((k) => typeof size[k] === 'number' && size[k] > 0);
}
