/**
 * "Ship before payment" (pay after dispatch) — the owner's limits, 2026-11-24.
 *
 * A rare customer will only pay once they have the tracking details. The admin
 * may let ONE unpaid sales-panel order ship first; the customer then pays a
 * Razorpay link (or a bank transfer accounts confirms). Payment is still only
 * ever confirmed by the verified webhook or by accounts — never by hand.
 *
 * These are the business limits. They are read by services/payLaterService.js,
 * which is the only place that enforces them.
 */
export const PAY_LATER = Object.freeze({
  /** Most one order may be, in rupees. */
  MAX_ORDER_RUPEES: 25000,
  /** Most that may be shipped-and-unpaid at one time, across every customer, in rupees. */
  MAX_OUTSTANDING_RUPEES: 100000,
  /** Days after dispatch before the order counts as overdue. */
  DUE_DAYS: 3,
  /** How long each payment link stays payable. Re-issued when it runs out. */
  LINK_TTL_DAYS: 7,
  /** A link send that crashed mid-way is retried after this long. */
  LINK_CLAIM_STALE_MS: 10 * 60 * 1000,
  /** Reason the admin types: bounds. */
  REASON_MIN: 3,
  REASON_MAX: 300,
});

/** Order states in which a pay-later order is still owed money and can be chased. */
export const PAY_LATER_OPEN_STATUSES = Object.freeze(['processing', 'shipped', 'delivered']);

/** Payment states that mean "not paid yet" on an unpaid sales order. */
export const UNPAID_PAYMENT_STATUSES = Object.freeze(['pending', 'failed']);

/** Is this order a pay-later order that still owes its money? */
export const isPayLaterDue = (order) => !!order?.payLater?.approvedAt
  && order.paymentStatus === 'pending'
  && PAY_LATER_OPEN_STATUSES.includes(order.status);

/** The Mongo filter twin of isPayLaterDue (served by the order_pay_later index). */
export const payLaterDueFilter = () => ({
  'payLater.approvedAt': { $type: 'date' },
  paymentStatus: 'pending',
  status: { $in: [...PAY_LATER_OPEN_STATUSES] },
});
