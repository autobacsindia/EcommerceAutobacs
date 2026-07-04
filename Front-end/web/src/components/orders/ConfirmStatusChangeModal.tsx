'use client';

import { useState } from 'react';
import { X, AlertCircle, ArrowRight, Mail } from 'lucide-react';
import { ORDER_STATUS_COLORS } from '@/lib/constants';

interface ConfirmStatusChangeModalProps {
  /** Order number for display. Omitted/undefined in bulk mode. */
  orderNumber?: string;
  currentStatus?: string;
  newStatus: string;
  /** Whether this status change emails the customer (drives the warning). */
  notifiesCustomer: boolean;
  /** When set (>1), renders bulk copy for N orders. */
  count?: number;
  /** Runs the actual update. Resolve to close; reject to show an inline error. */
  onConfirm: (note?: string) => Promise<void>;
  onClose: () => void;
}

const label = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-semibold ${
        ORDER_STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'
      }`}
    >
      {label(status)}
    </span>
  );
}

export default function ConfirmStatusChangeModal({
  orderNumber,
  currentStatus,
  newStatus,
  notifiesCustomer,
  count,
  onConfirm,
  onClose,
}: ConfirmStatusChangeModalProps) {
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBulk = typeof count === 'number' && count > 1;

  const handleConfirm = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm(note.trim() || undefined);
      // On success the parent unmounts this modal; nothing more to do.
    } catch (err: any) {
      setError(err?.message || 'Failed to update status. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-obsidian-deep bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-obsidian rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-hairline sticky top-0 bg-obsidian">
          <div>
            <h3 className="text-xl font-bold text-ink">Confirm status change</h3>
            <p className="text-sm text-ink-muted mt-1">
              {isBulk ? `${count} orders selected` : orderNumber ? `Order #${orderNumber}` : 'Order'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink transition"
            disabled={isSubmitting}
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6">
          {/* Transition preview */}
          <div className="flex items-center justify-center gap-3 mb-6">
            {isBulk ? (
              <>
                <span className="text-sm text-ink-muted">Set all to</span>
                <StatusChip status={newStatus} />
              </>
            ) : (
              <>
                {currentStatus && <StatusChip status={currentStatus} />}
                <ArrowRight className="h-4 w-4 text-ink-muted" />
                <StatusChip status={newStatus} />
              </>
            )}
          </div>

          {/* Customer email warning */}
          {notifiesCustomer && (
            <div className="bg-gold/10 border border-gold/40 rounded-lg p-4 mb-6 flex gap-3">
              <Mail className="h-5 w-5 text-gold flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gold">
                {isBulk
                  ? `The customer for each of these ${count} orders will be emailed about this update.`
                  : 'The customer will be emailed about this update.'}
              </p>
            </div>
          )}

          {/* Optional admin note */}
          <div className="mb-6">
            <label htmlFor="status-note" className="block text-sm font-medium text-ink/80 mb-2">
              Note (optional)
            </label>
            <textarea
              id="status-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal note recorded on the order history…"
              rows={3}
              maxLength={500}
              disabled={isSubmitting}
              className="w-full px-4 py-3 bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-gold resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 mb-6 flex gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 border border-hairline text-ink/80 rounded-lg hover:bg-obsidian-deep font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-gold text-obsidian rounded-lg hover:bg-gold/90 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-obsidian"></div>
                  <span>Updating…</span>
                </>
              ) : (
                `Confirm — set to ${label(newStatus)}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
