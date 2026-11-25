/**
 * How long delivery takes — the ONE rule every customer-facing estimate uses
 * (product page, listing cards, the order pages' fallback). "Nothing Extra"
 * campaign, 2026-11-23: general delivery is 7–10 days, up to 15 for heavy goods.
 *
 * Honest by construction: the window is a range of WHOLE DAYS that we expect to
 * meet, never a best case. A product we know little about takes the general
 * window; a product whose box is Large or XL (a courier's surface service, or
 * freight) takes the heavy window.
 *
 * The size class comes from the same chain the delivery-fee maths uses
 * (utils/deliveryFees.js `resolveBox`): measured box → online size → stored class →
 * category guess. So the class that prices a parcel is the class that times it.
 *
 * Pure. The frontend never derives a window itself; it renders what
 * GET /delivery-fees/estimates returns (Front-end/web/src/lib/deliveryWindow.ts
 * only formats it).
 */
import { resolveBox } from './deliveryFees.js';
import { chargeableWeightKg, classForChargeableKg } from './shippingClass.js';

export const DELIVERY_WINDOWS = Object.freeze({
  general: Object.freeze({ minDays: 7, maxDays: 10 }),
  heavy: Object.freeze({ minDays: 10, maxDays: 15 }),
});

/** Classes that ship slowly: Large goes by surface courier, XL by freight. */
export const HEAVY_CLASSES = Object.freeze(['large', 'xl']);

/**
 * The product's size class for timing, or null when nothing says (no size, no
 * class, no category signal) — null takes the general window.
 *
 * @param {{ shippingSize?, listedSize?, shippingClass?, categoryClass? }} product
 */
export function sizeClassForTiming(product) {
  const { box, source, cls } = resolveBox(product);
  if (cls) return cls;
  if (source === 'measured' || source === 'listed') return classForChargeableKg(chargeableWeightKg(box));
  return null; // 'fallback': no signal at all
}

/**
 * The delivery window for one product.
 * @returns {{ minDays: number, maxDays: number, heavy: boolean }}
 */
export function deliveryWindowFor(product) {
  const heavy = HEAVY_CLASSES.includes(sizeClassForTiming(product));
  const w = heavy ? DELIVERY_WINDOWS.heavy : DELIVERY_WINDOWS.general;
  return { minDays: w.minDays, maxDays: w.maxDays, heavy };
}

export default { DELIVERY_WINDOWS, HEAVY_CLASSES, sizeClassForTiming, deliveryWindowFor };
