'use client';

import { useState } from 'react';
import { OFFLINE_REFUND_METHODS, type OfflineRefundMethod } from '@/lib/offlineRefund';

/**
 * Recording a refund that was settled outside Razorpay, and withdrawing such a record.
 *
 * One component for all three refund surfaces (whole order, per-line cancellation,
 * return) so the wording, the mandatory reference and the warnings behave identically
 * wherever an admin meets them. The caller owns the request; this owns the form.
 *
 * Two situations it serves, and they look the same to the admin:
 *   - money genuinely handed back by cash / NEFT / UPI / cheque;
 *   - a refund issued by hand in the Razorpay dashboard, which writes nothing back to
 *     this system and otherwise leaves the order stuck in the refunds queue for ever.
 */

export interface OfflineRefundSubmission {
  offlineMethod: OfflineRefundMethod;
  reference: string;
  amount?: number;
  paidAt?: string;
  notifyCustomer?: boolean;
}

interface Props {
  /**
   * ⚠️ Render this component CONDITIONALLY (`{open && <OfflineRefundDialog … />}`), not
   * permanently with a toggled flag. Every field below seeds itself from props in a
   * `useState` initialiser, and those run once per MOUNT — keep it mounted and a
   * prefilled reference or a changed `maxAmount` is silently ignored on reopen, leaving
   * the admin looking at the previous order's figures.
   */
  open: boolean;
  onClose: () => void;
  onSubmit: (values: OfflineRefundSubmission) => Promise<void>;
  /** What is refundable here, in rupees — shown and used as the default. */
  maxAmount: number;
  /** Label for the thing being refunded, e.g. "order #AB-1234". */
  subject: string;
  /**
   * Whether to offer the "email the customer" checkbox. Off for per-line cancellation
   * refunds, where the gateway path sends no email either — an email that fired only
   * for cash payouts would be worse than none.
   */
  allowNotify?: boolean;
  /** Prefill the reference, e.g. with a Razorpay refund id the admin just saw fail. */
  defaultReference?: string;
}

/** Today in YYYY-MM-DD, for the date input's max (a payout cannot be in the future). */
const today = () => new Date().toISOString().slice(0, 10);

export default function OfflineRefundDialog({
  open, onClose, onSubmit, maxAmount, subject, allowNotify = true, defaultReference = '',
}: Props) {
  const [method, setMethod] = useState<OfflineRefundMethod>('bank_transfer');
  const [reference, setReference] = useState(defaultReference);
  const [amount, setAmount] = useState(String(maxAmount));
  const [paidAt, setPaidAt] = useState(today());
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const parsedAmount = Number(amount);
  const amountInvalid =
    !Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > maxAmount;
  const isPartial = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount < maxAmount;
  const canSubmit = reference.trim().length > 0 && !amountInvalid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        offlineMethod: method,
        reference: reference.trim(),
        amount: parsedAmount,
        paidAt: paidAt || undefined,
        ...(allowNotify ? { notifyCustomer } : {}),
      });
      onClose();
    } catch (err: any) {
      // Kept in the dialog rather than closing behind a toast: the admin usually needs
      // to correct a figure or a reference, and losing the form to do that is hostile.
      setError(err?.message || 'Could not record the refund.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900">Record a refund paid outside Razorpay</h2>
        <p className="mt-1 text-sm text-gray-600">
          For {subject}. This records money that has <strong>already gone back</strong> — nothing is
          sent to the gateway.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="offline-method" className="block text-sm font-medium text-gray-700">
              How was it paid back?
            </label>
            <select
              id="offline-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as OfflineRefundMethod)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {OFFLINE_REFUND_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="offline-reference" className="block text-sm font-medium text-gray-700">
              Reference <span className="text-red-600">*</span>
            </label>
            <input
              id="offline-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              placeholder="UTR, cheque no., receipt no., or the Razorpay refund id"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Required — with no gateway record, this is the only evidence the money moved.
            </p>
          </div>

          <div>
            <label htmlFor="offline-amount" className="block text-sm font-medium text-gray-700">
              Amount (₹)
            </label>
            <input
              id="offline-amount"
              type="number"
              min="0.01"
              max={maxAmount}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Up to ₹{maxAmount.toFixed(2)} is still refundable here.
            </p>
          </div>

          <div>
            <label htmlFor="offline-paid-at" className="block text-sm font-medium text-gray-700">
              When did it go back?
            </label>
            <input
              id="offline-paid-at"
              type="date"
              value={paidAt}
              max={today()}
              onChange={(e) => setPaidAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {allowNotify && (
            <div>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={notifyCustomer}
                  onChange={(e) => setNotifyCustomer(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Email the customer that their refund has been processed</span>
              </label>
              {/*
                The one case worth warning about: reconciling a dashboard refund. Razorpay
                has already emailed them, so ours would be the second refund email for one
                refund — which reliably produces a "am I getting this twice?" phone call.
              */}
              {notifyCustomer && (
                <p className="mt-1 text-xs text-amber-700">
                  Untick this if you refunded in the Razorpay dashboard — Razorpay has already
                  emailed them.
                </p>
              )}
              {notifyCustomer && isPartial && (
                <p className="mt-1 text-xs text-gray-500">
                  No email will be sent for a partial record: an order gets only one refund
                  email, and it is kept for the full refund.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? 'Recording…' : 'Record refund'}
          </button>
        </div>
      </div>
    </div>
  );
}
