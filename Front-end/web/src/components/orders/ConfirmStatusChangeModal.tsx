'use client';

import { useState, useEffect } from 'react';
import { X, AlertCircle, ArrowRight, Mail, Paperclip } from 'lucide-react';
import { ORDER_STATUS_COLORS } from '@/lib/constants';
import apiClient from '@/lib/api';
import { OTHER_CARRIER_CODE, type ShippingInput } from '@/lib/orderStatusUpdate';

interface Carrier {
  name: string;
  code: string;
  estimatedDeliveryDays?: number;
  /** Free-text carrier: the admin types the courier's name. */
  custom?: boolean;
}

/** Payload handed back to the caller on confirm. */
export interface ConfirmStatusPayload {
  note?: string;
  shipping?: ShippingInput;
}

interface ConfirmStatusChangeModalProps {
  /** Order number for display. Omitted/undefined in bulk mode. */
  orderNumber?: string;
  currentStatus?: string;
  newStatus: string;
  /** Whether this status change emails the customer (drives the warning). */
  notifiesCustomer: boolean;
  /** When set (>1), renders bulk copy for N orders. */
  count?: number;
  /**
   * Units on the order, for a `shipped` change made from the ORDERS LIST.
   *
   * That screen ships everything in one parcel — the fast path, kept on purpose for
   * working through many orders. Saying how many items that covers is what turns it from
   * a silent decision into a deliberate one; splitting happens on the order's own page.
   *
   * ⚠️ THIS IS NOW A BACKSTOP, NOT THE PRIMARY GUARD. The orders list hands a `shipped`
   * pick on any splittable order (>1 unit, or one that already has parcels) straight to
   * that page's Parcels panel, so this dialog no longer receives a count above 1 and the
   * warning below should not render in practice. It is kept because it is the correct
   * disclosure for what this dialog DOES — one tracking field, everything in one box —
   * and it stays live if that threshold is ever loosened. Do not read its presence as
   * evidence that the list still ships multi-item orders inline; it does not.
   */
  shipsEverythingCount?: number;
  /**
   * Parcels still awaiting delivery, for a `delivered` change.
   *
   * The mirror image of `shipsEverythingCount`. Marking the order delivered runs
   * `deliverAllOutstanding` server-side, which lands EVERY outstanding parcel at once —
   * necessary, because the per-line return window reads parcel dates and would never
   * open otherwise. But on a multi-parcel order that is a real decision (each parcel
   * also emails the customer its own "delivered"), and it was being made silently
   * while the shipping equivalent right above got a warning.
   */
  deliversParcelCount?: number;
  /** Link to the order, so "split into parcels" is one click from the dialog. */
  orderHref?: string;
  /** Runs the actual update. Resolve to close; reject to show an inline error. */
  onConfirm: (payload: ConfirmStatusPayload) => Promise<void>;
  onClose: () => void;
}

const label = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const MAX_SLIP_BYTES = 5 * 1024 * 1024; // mirror backend MAX_PDF_SIZE
const MAX_CARRIER_NAME = 60; // mirror backend MAX_CUSTOM_CARRIER_NAME

// Always offered, even if the carriers endpoint fails, so a shipment is never
// blocked on the lookup — the admin can type the courier's name instead.
const OTHER_CARRIER: Carrier = { name: 'Other courier', code: OTHER_CARRIER_CODE, custom: true };

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
  shipsEverythingCount,
  deliversParcelCount,
  orderHref,
  onConfirm,
  onClose,
}: ConfirmStatusChangeModalProps) {
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBulk = typeof count === 'number' && count > 1;
  // Shipping details are only captured for a single order moving to `shipped`.
  const isShipping = !isBulk && newStatus === 'shipped';
  // Bulk excluded deliberately: a bulk delivered-change spans many orders with
  // different parcel counts, so there is no single honest number to quote.
  const isDelivering = !isBulk && newStatus === 'delivered';

  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrierCode, setCarrierCode] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [slipFile, setSlipFile] = useState<File | null>(null);

  // The API already lists the "Other" carrier; append it defensively so the
  // option survives an older backend or a failed carriers fetch.
  const carrierOptions = carriers.some((c) => c.code === OTHER_CARRIER_CODE)
    ? carriers
    : [...carriers, OTHER_CARRIER];
  const isOtherCarrier = carrierCode === OTHER_CARRIER_CODE;

  useEffect(() => {
    if (!isShipping) return;
    let cancelled = false;
    apiClient
      .get<{ carriers: Carrier[] }>('/orders/tracking/carriers')
      .then((res) => {
        if (!cancelled) setCarriers(res.carriers || []);
      })
      .catch(() => {
        /* dropdown stays empty; the admin sees a "couldn't load carriers" hint */
      });
    return () => {
      cancelled = true;
    };
  }, [isShipping]);

  const handleSlipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0] || null;
    if (file) {
      if (file.type !== 'application/pdf') {
        setError('The shipping slip must be a PDF file.');
        e.target.value = '';
        return;
      }
      if (file.size > MAX_SLIP_BYTES) {
        setError('The shipping slip must be 5 MB or smaller.');
        e.target.value = '';
        return;
      }
    }
    setSlipFile(file);
  };

  const handleConfirm = async () => {
    setError(null);

    let shipping: ShippingInput | undefined;
    if (isShipping) {
      if (!trackingNumber.trim()) {
        setError('Enter a tracking number to mark this order as shipped.');
        return;
      }
      if (!carrierCode) {
        setError('Select a carrier to mark this order as shipped.');
        return;
      }
      const trimmedCarrierName = carrierName.trim();
      if (isOtherCarrier && !trimmedCarrierName) {
        setError('Enter the courier name for the "Other" carrier.');
        return;
      }
      shipping = {
        trackingNumber: trackingNumber.trim(),
        carrierCode,
        carrierName: isOtherCarrier ? trimmedCarrierName : undefined,
        slipFile,
      };
    }

    setIsSubmitting(true);
    try {
      await onConfirm({ note: note.trim() || undefined, shipping });
      // On success the parent unmounts this modal; nothing more to do.
    } catch (err: any) {
      setError(err?.message || 'Failed to update status. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Confirm status change</h3>
            <p className="text-sm text-gray-500 mt-1">
              {isBulk ? `${count} orders selected` : orderNumber ? `Order #${orderNumber}` : 'Order'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 transition"
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
                <span className="text-sm text-gray-500">Set all to</span>
                <StatusChip status={newStatus} />
              </>
            ) : (
              <>
                {currentStatus && <StatusChip status={currentStatus} />}
                <ArrowRight className="h-4 w-4 text-gray-500" />
                <StatusChip status={newStatus} />
              </>
            )}
          </div>

          {/*
            Shipping from the ORDERS LIST puts every outstanding unit in ONE parcel.
            That is the intended fast path for this screen, but on a multi-item order it
            is only right by accident — so say what it will do, and offer the split.
          */}
          {isShipping && (shipsEverythingCount ?? 0) > 1 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This ships <strong>all {shipsEverythingCount} items</strong> together in one parcel.
              {orderHref && (
                <>
                  {' '}Sending them separately?{' '}
                  <a href={orderHref} className="font-medium underline hover:no-underline">
                    Open the order
                  </a>{' '}
                  and use the Parcels panel.
                </>
              )}
            </div>
          )}

          {/*
            Delivering from a LIST marks every outstanding parcel delivered in one go.
            Same fast path as shipping, same obligation to say so — and the same escape
            hatch, since the Parcels panel can land them one at a time.
          */}
          {isDelivering && (deliversParcelCount ?? 0) > 1 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This marks <strong>all {deliversParcelCount} parcels</strong> delivered, and emails
              the customer once per parcel.
              {orderHref && (
                <>
                  {' '}Only some of them arrived?{' '}
                  <a href={orderHref} className="font-medium underline hover:no-underline">
                    Open the order
                  </a>{' '}
                  and mark them one at a time.
                </>
              )}
            </div>
          )}

          {/* Shipping details (tracking + carrier + optional slip) */}
          {isShipping && (
            <div className="mb-6 space-y-4">
              <div>
                <label htmlFor="tracking-number" className="block text-sm font-medium text-gray-700 mb-2">
                  Tracking number <span className="text-red-400">*</span>
                </label>
                <input
                  id="tracking-number"
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="e.g. 123456789012"
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="carrier" className="block text-sm font-medium text-gray-700 mb-2">
                  Carrier <span className="text-red-400">*</span>
                </label>
                <select
                  id="carrier"
                  value={carrierCode}
                  onChange={(e) => setCarrierCode(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled>
                    {carriers.length ? 'Select a carrier…' : 'Loading carriers…'}
                  </option>
                  {carrierOptions.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Free-text courier name — only for the "Other" carrier. */}
              {isOtherCarrier && (
                <div>
                  <label htmlFor="carrier-name" className="block text-sm font-medium text-gray-700 mb-2">
                    Courier name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="carrier-name"
                    type="text"
                    value={carrierName}
                    onChange={(e) => setCarrierName(e.target.value)}
                    placeholder="e.g. Trackon Couriers"
                    maxLength={MAX_CARRIER_NAME}
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Shown to the customer with the tracking number. We have no tracking link for
                    couriers outside the list, so the email won&apos;t include a &ldquo;track&rdquo; button.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="slip" className="block text-sm font-medium text-gray-700 mb-2">
                  Shipping slip (PDF, optional)
                </label>
                <input
                  id="slip"
                  type="file"
                  accept="application/pdf"
                  onChange={handleSlipChange}
                  disabled={isSubmitting}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-50 file:text-gray-900 hover:file:bg-white"
                />
                {slipFile && (
                  <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    {slipFile.name} — attached to the customer email
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Customer email warning */}
          {notifiesCustomer && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex gap-3">
              <Mail className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-600">
                {isBulk
                  ? `The customer for each of these ${count} orders will be emailed about this update.`
                  : isShipping
                    ? 'The customer will be emailed the tracking details' +
                      (slipFile ? ' and the shipping slip.' : '.')
                    : 'The customer will be emailed about this update.'}
              </p>
            </div>
          )}

          {/* Optional admin note */}
          <div className="mb-6">
            <label htmlFor="status-note" className="block text-sm font-medium text-gray-700 mb-2">
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
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 mb-6 flex gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              {/* whitespace-pre-line: a bulk update reports one line per order it could
                  not change, and without it they collapse into an unreadable run-on. */}
              <p className="text-sm text-red-400 whitespace-pre-line">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-100 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-200"></div>
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
