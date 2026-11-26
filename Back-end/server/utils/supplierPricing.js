/**
 * Selling-price maths for supplier-listed products. Pure, integer-only.
 *
 *   • Cost is whole PAISE without GST (what the supplier typed).
 *   • Product.price is whole RUPEES including GST (what the customer pays).
 *   • Margin is BASIS POINTS of the selling price WITHOUT GST
 *     (profit ÷ price ex-GST) — the procurement calculator's definition.
 *   • A suggested price rounds UP at every step: it must never land below the
 *     target margin. A measured margin rounds DOWN: it must never overstate.
 *
 * Every product here stays below 2^53 (cost ≤ ₹10 lakh × 10⁴ bp), so plain
 * Number integer arithmetic is exact.
 */
import { GST_RATES, MAX_MARGIN_BP } from '../config/supplierPortal.js';

const BP = 10000;
const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);

const assertInt = (name, v, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} must be a whole number from ${min} to ${max}`);
};
const assertGst = (gstPct) => {
  if (!GST_RATES.includes(gstPct)) throw new RangeError(`gstPct must be one of ${GST_RATES.join(', ')}`);
};

/** Whole-rupee price (incl. GST) that gives at least `marginBp` on `costPaise`. */
export function suggestSellingPrice({ costPaise, gstPct, marginBp }) {
  assertInt('costPaise', costPaise, 1, Number.MAX_SAFE_INTEGER / BP);
  assertGst(gstPct);
  assertInt('marginBp', marginBp, 0, MAX_MARGIN_BP);
  const exGstPaise = ceilDiv(costPaise * BP, BP - marginBp);
  const inclPaise = ceilDiv(exGstPaise * (100 + gstPct), 100);
  return ceilDiv(inclPaise, 100);
}

/** Margin (bp, may be negative) that a whole-rupee price incl. GST gives on `costPaise`. */
export function marginOfPrice({ costPaise, gstPct, priceRupees }) {
  assertInt('costPaise', costPaise, 1, Number.MAX_SAFE_INTEGER / BP);
  assertGst(gstPct);
  if (!Number.isFinite(priceRupees) || priceRupees <= 0) throw new RangeError('priceRupees must be above 0');
  const inclPaise = Math.round(priceRupees * 100);
  const exGstPaise = Math.round((inclPaise * 100) / (100 + gstPct));
  return Math.floor(((exGstPaise - costPaise) * BP) / exGstPaise);
}

/** Is a proposed price safe? `belowFloor` must be explicitly overridden by procurement. */
export function checkPrice({ costPaise, gstPct, priceRupees, floorBp }) {
  const marginBp = marginOfPrice({ costPaise, gstPct, priceRupees });
  return { marginBp, belowCost: marginBp < 0, belowFloor: marginBp < floorBp };
}
