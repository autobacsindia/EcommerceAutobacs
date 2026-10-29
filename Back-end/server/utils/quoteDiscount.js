/**
 * The percentage discount on a GTM quotation (models/SalesQuotation.js `discount`).
 *
 * The seller sends ONLY a percent and a reason. The rupee amount and the total are
 * computed here, on the server, from the quotation's own priced lines — a total or
 * amount sent by the browser is never read.
 *
 *   subtotal  = Σ offer price × quantity          (GST-inclusive, like every price)
 *   amount    = subtotal × percent ÷ 100, rounded to the nearest WHOLE rupee
 *   total     = subtotal − amount
 *
 * Prices include GST, so taking the discount off the inclusive total lowers the
 * GST inside it by the same percent: "before or after GST" gives one answer.
 *
 * Pure: no database, no clock. Integer maths (paise × basis points) so the result
 * is exact and the charged total reconciles with Razorpay's paise.
 */
import AppError from './AppError.js';
import { toPaise, fromPaise } from './money.js';

const fail = (message) => new AppError(message, 400, { expose: true });

export const DISCOUNT_REASON_MIN = 3;
export const DISCOUNT_REASON_MAX = 300;
/** Below 100: a ₹0 order cannot be paid (each payment part is at least ₹1). */
export const DISCOUNT_MAX_PERCENT = 99.99;

/**
 * The discount the form asked for, checked. `null` = no discount (empty, 0, absent).
 * @param {{ percent?: number|string, reason?: string }|null|undefined} input
 * @returns {{ percent: number, reason: string }|null}
 */
export function cleanDiscountInput(input) {
  if (input == null || typeof input !== 'object') return null;
  const raw = input.percent;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0) throw fail('Enter the discount as a percentage, e.g. 5 or 2.5.');
  if (percent === 0) return null;
  // At most two decimals (2.5 or 7.25 — not 7.125).
  const bp = Math.round(percent * 100);
  if (Math.abs(bp - percent * 100) > 1e-6) throw fail('The discount can have at most 2 decimals, e.g. 7.25%.');
  if (percent > DISCOUNT_MAX_PERCENT) throw fail(`The discount must be less than 100% (at most ${DISCOUNT_MAX_PERCENT}%).`);
  const reason = String(input.reason ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < DISCOUNT_REASON_MIN) throw fail('Write the reason for the discount (e.g. "repeat customer").');
  if (reason.length > DISCOUNT_REASON_MAX) throw fail(`Keep the discount reason under ${DISCOUNT_REASON_MAX} characters.`);
  return { percent: bp / 100, reason };
}

/**
 * The rupee discount and the total for a subtotal and a percent.
 * @param {number} subtotal rupees (may carry paise)
 * @param {number|null} percent  0 / null = no discount
 * @returns {{ subtotal: number, amount: number, total: number }} rupees
 */
export function applyDiscount(subtotal, percent) {
  const subtotalPaise = toPaise(subtotal);
  const bp = Math.round(Number(percent || 0) * 100);
  // subtotal (paise) × bp ÷ 10,000 = discount in paise; ÷ 100 more = rupees, rounded half-up.
  // Max magnitude ≈ 1e10 paise × 1e4 = 1e14 — well inside a safe integer.
  const amountRupees = bp > 0 ? Math.round((subtotalPaise * bp) / 1000000) : 0;
  const amountPaise = amountRupees * 100;
  return {
    subtotal: fromPaise(subtotalPaise),
    amount: fromPaise(amountPaise),
    total: fromPaise(subtotalPaise - amountPaise),
  };
}

/**
 * Price a quotation: the checked discount applied to its lines' subtotal. Refuses a
 * discount that would leave less than ₹1 to pay.
 * @param {number} subtotal rupees
 * @param {{ percent, reason }|null} discount  from cleanDiscountInput
 */
export function priceWithDiscount(subtotal, discount) {
  const priced = applyDiscount(subtotal, discount?.percent ?? 0);
  if (discount && toPaise(priced.total) < 100) {
    throw fail('This discount leaves nothing to pay. Lower the discount.');
  }
  return priced;
}

/** The customer-facing label: "Discount (5%)", "Discount (2.5%)". Never the reason or the giver. */
export const discountLabel = (percent) => `Discount (${Number(percent).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%)`;
