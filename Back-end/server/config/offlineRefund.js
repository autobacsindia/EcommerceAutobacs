/**
 * Refunds settled OUTSIDE the payment gateway.
 *
 * Single source of truth for how a payout made by hand can be described, shared by the
 * schemas (models/shared/offlineRefundFields.js, ReturnRequest), the request validators,
 * the email copy and the admin UI. One list, so a method added here cannot be accepted
 * by a validator and then rejected by a schema enum.
 */

export const OFFLINE_METHODS = Object.freeze([
  'cash', 'bank_transfer', 'upi', 'cheque', 'other',
]);

/** Human wording, for admin messages and customer email copy. */
export const OFFLINE_METHOD_LABELS = Object.freeze({
  cash: 'cash',
  bank_transfer: 'bank transfer',
  upi: 'UPI',
  cheque: 'cheque',
  other: 'an offline payout',
});

/** @param {string} method @returns {string} */
export const offlineMethodLabel = (method) =>
  OFFLINE_METHOD_LABELS[method] || 'an offline payout';

export default { OFFLINE_METHODS, OFFLINE_METHOD_LABELS, offlineMethodLabel };
