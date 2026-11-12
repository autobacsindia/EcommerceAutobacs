/**
 * Was this order paid in full by VERIFIED money?
 *
 * `order.paymentStatus` alone is not proof: today an admin can set an order to
 * `processing` and the status mirror flips to `paid` with no money at all
 * (docs: order-process review 2026-11-11). So Roav Points counts an order only
 * when the payment RECORDS cover its total:
 *
 *   - Razorpay: Payment rows written by the signature-verified webhook /
 *     verify / reconciliation paths — paymentGateway 'razorpay', a gateway
 *     payment id, status completed (or later refunded: it WAS paid; the refund is
 *     handled as a reversal).
 *   - Bank transfer: a BankTransfer that accounts CONFIRMED for this order (not
 *     one for an extra charge).
 *
 * Pure: the caller loads the rows.
 */
const PAID_PAYMENT_STATUSES = new Set(['completed', 'refunded']);

/** Rupee tolerance for float noise in stored totals. */
const TOLERANCE = 1;

/**
 * @param {object} order       lean Order
 * @param {object[]} payments  lean Payment rows for this order
 * @param {object[]} transfers lean BankTransfer rows for this order
 * @returns {{ verified: boolean, paidAt: Date|null, via: string[], covered: number, due: number }}
 */
export function verifyPaid(order, payments = [], transfers = []) {
  const due = Number(order.gatewayOffer?.amountPaid ?? order.totalAmount) || 0;
  const via = [];
  let covered = 0;
  let paidAt = null;
  const later = (d) => { if (d && (!paidAt || new Date(d) > paidAt)) paidAt = new Date(d); };

  for (const p of payments) {
    if (p.paymentGateway !== 'razorpay') continue;
    if (typeof p.gatewayPaymentId !== 'string' || !p.gatewayPaymentId) continue;
    if (!PAID_PAYMENT_STATUSES.has(p.status)) continue;
    covered += Number(p.amount) || 0;
    later(p.createdAt);
    if (!via.includes('razorpay')) via.push('razorpay');
  }
  for (const t of transfers) {
    if (t.status !== 'confirmed' || t.extraCharge) continue;
    covered += Number(t.amount) || 0;
    later(t.reviewedAt || t.updatedAt || t.paidOn);
    if (!via.includes('bank_transfer')) via.push('bank_transfer');
  }

  const verified = order.paymentStatus === 'paid' || order.paymentStatus === 'refunded'
    ? covered + TOLERANCE >= due && due > 0
    : false;
  // The order's own paidAt is stamped by the same payment paths; prefer it.
  return { verified, paidAt: verified ? (order.paidAt ? new Date(order.paidAt) : paidAt) : null, via, covered, due };
}
