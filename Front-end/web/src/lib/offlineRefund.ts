/**
 * Refunds settled outside the payment gateway — the client-side half.
 *
 * Mirrors `Back-end/server/config/offlineRefund.js`. Kept in one module rather than
 * re-declared per screen so the method list cannot drift between the three refund
 * surfaces (whole order, per-line cancellation, return) or from the backend enum that
 * ultimately validates it.
 */

export type OfflineRefundMethod = 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'other';

export const OFFLINE_REFUND_METHODS: { value: OfflineRefundMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer / NEFT' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export const offlineMethodLabel = (method?: string): string =>
  OFFLINE_REFUND_METHODS.find((m) => m.value === method)?.label || 'Offline';

/**
 * Ask for a reason, and refuse to proceed without one.
 *
 * Reverting rewrites what the books say about money, and the reason is the only record
 * of why — the backend rejects a blank one, so catching it here saves a round trip and
 * keeps the message specific.
 *
 * @returns the trimmed reason, or null if the admin cancelled or left it empty.
 */
export const promptRevertReason = (subject: string): string | null => {
  const reason = window.prompt(
    `Withdraw the offline refund record for ${subject}?\n\n`
    + 'This puts it back to "refund due" so it can be refunded properly. '
    + 'Only records marked as settled offline can be withdrawn — a refund that went '
    + 'through Razorpay cannot be undone here.\n\n'
    + 'Reason (required):',
  );
  if (reason === null) return null;
  const trimmed = reason.trim();
  if (!trimmed) {
    window.alert('A reason is required to withdraw a refund record.');
    return null;
  }
  return trimmed;
};
