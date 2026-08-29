'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, IndianRupee, PackageX, RotateCcw } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatLongDateIST } from '@/lib/datetime';

/**
 * Admin — lines cancelled before delivery, and the money going back for them.
 *
 * Cancelling is DELIBERATELY two steps: record the cancellation, then send its refund.
 * Recording is a local write that always succeeds; the gateway call can fail, time out,
 * or succeed with the response lost. Splitting them means a failed refund leaves the
 * cancellation intact and retryable from the same button instead of forcing an undo.
 *
 * ⚠️ Every rupee shown here is computed SERVER-SIDE by refundMathService. This
 * component never multiplies a price by a quantity: the line's list value is not what
 * the customer paid once a coupon or karma is in play, and refunding the list value
 * hands back money that was never taken. The preview below asks the server.
 *
 * ⚠️ The order's own totals are never rewritten — an order records what was CHARGED and
 * the refund records the adjustment. So "₹1,250" stays on screen next to a ₹400 refund,
 * and that is correct.
 */

interface CancellationLine {
  itemId: string;
  quantity: number;
}

export interface Cancellation {
  _id: string;
  sequence: number;
  lines: CancellationLine[];
  reason?: string;
  notes?: string;
  cancelledAt?: string;
  refund?: {
    productValuePaise: number;
    amountPaise: number;
    status: 'not_applicable' | 'pending' | 'processing' | 'completed' | 'failed';
    razorpayRefundId?: string;
    completedAt?: string;
    failureReason?: string;
  };
}

interface RemainingLine {
  itemId: string;
  name: string | null;
  quantity: number;
  /** How many of these units are sitting in an unshipped parcel that will be edited. */
  packed: number;
}

interface CancellationSummary {
  orderedUnits: number;
  cancelledUnits: number;
  liveUnits: number;
  cancellationCount: number;
  fullyCancelled: boolean;
  partial: boolean;
  label: string | null;
}

interface Props {
  orderId: string;
  /** Order line names, so a record can show what died rather than raw ids. */
  itemNames: Record<string, string>;
  /** Called after any change, so the parent can refetch the order's derived status. */
  onChanged?: () => void;
}

const REFUND_STYLE: Record<string, string> = {
  not_applicable: 'bg-gray-100 text-gray-700',
  pending: 'bg-amber-100 text-amber-900',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const REFUND_LABEL: Record<string, string> = {
  not_applicable: 'No refund due',
  pending: 'Refund not sent',
  processing: 'Refund processing',
  completed: 'Refunded',
  failed: 'Refund failed',
};

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OrderCancellations({ orderId, itemNames, onChanged }: Props) {
  const [cancellations, setCancellations] = useState<Cancellation[]>([]);
  const [remaining, setRemaining] = useState<RemainingLine[]>([]);
  const [summary, setSummary] = useState<CancellationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('out_of_stock');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{
        cancellations: Cancellation[]; remaining: RemainingLine[]; summary: CancellationSummary;
      }>(API_ENDPOINTS.ORDER_CANCELLATIONS(orderId));
      setCancellations(res.cancellations || []);
      setRemaining(res.remaining || []);
      setSummary(res.summary || null);
      // Default every quantity to ZERO — the opposite of the parcel form, which
      // pre-fills "everything left". Shipping the wrong thing is recoverable; cancelling
      // and refunding the wrong thing takes money out of the business and has to be an
      // explicit choice for every unit.
      setQty({});
    } catch {
      /* the panel simply shows nothing; the order page still works */
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const chosenLines = remaining
    .map((l) => ({ itemId: l.itemId, quantity: Number(qty[l.itemId] || 0) }))
    .filter((l) => l.quantity > 0);

  // Units chosen that are currently inside an unshipped parcel — that box gets edited.
  const packedAffected = remaining.reduce(
    (n, l) => n + Math.min(Number(qty[l.itemId] || 0), l.packed), 0);

  const cancelsEverything =
    chosenLines.length > 0 &&
    remaining.every((l) => Number(qty[l.itemId] || 0) >= l.quantity);

  const handleCreate = async () => {
    if (!chosenLines.length) {
      toast.error('Choose how many of each item to cancel.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiClient.post<{ message: string; refund?: { amountRupees: number } }>(
        API_ENDPOINTS.ORDER_CANCELLATIONS(orderId),
        { lines: chosenLines, reason, notes: notes.trim() || undefined },
      );
      toast.success(res.message || 'Lines cancelled.');
      setOpen(false);
      setNotes('');
      await load();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not cancel those lines.');
    } finally {
      setSaving(false);
    }
  };

  const handleRefund = async (cancellation: Cancellation) => {
    setBusyId(cancellation._id);
    try {
      const res = await apiClient.post<{ message: string }>(
        API_ENDPOINTS.ORDER_CANCELLATION_REFUND(orderId, cancellation._id), {});
      toast.success(res.message || 'Refund sent.');
      await load();
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not send the refund.');
    } finally {
      setBusyId(null);
    }
  };

  const describe = (cancellation: Cancellation) =>
    cancellation.lines.map((l) => ({
      key: String(l.itemId),
      label: `${itemNames[String(l.itemId)] || 'Item'} × ${l.quantity}`,
    }));

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  // Nothing cancelled and nothing cancellable: an order this panel has no business on.
  if (!cancellations.length && !remaining.length) return null;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex flex-wrap items-center gap-3 border-b p-6">
        <h2 className="text-xl font-semibold">Cancellations</h2>
        {summary?.label && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
            {summary.label}
          </span>
        )}
        {remaining.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            {open ? 'Cancel' : 'Cancel items'}
          </button>
        )}
      </div>

      {open && (
        <div className="border-b bg-gray-50 p-6">
          <p className="mb-3 text-sm font-medium text-gray-700">How many of each should be cancelled?</p>
          <div className="space-y-2">
            {remaining.map((line) => (
              <div key={line.itemId} className="flex items-center gap-3">
                <input
                  type="number"
                  aria-label={`Quantity of ${line.name || 'item'} to cancel`}
                  min={0}
                  max={line.quantity}
                  value={qty[line.itemId] ?? 0}
                  onChange={(e) =>
                    setQty((q) => ({
                      ...q,
                      // Clamped here as well as server-side. The server is the authority
                      // on over-cancelling, but there is no reason to let someone type 99
                      // and only find out after a round trip.
                      [line.itemId]: Math.max(0, Math.min(line.quantity, Number(e.target.value) || 0)),
                    }))
                  }
                  className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
                <span className="text-sm">
                  {line.name || 'Item'}
                  <span className="text-gray-500"> · {line.quantity} cancellable</span>
                  {line.packed > 0 && (
                    <span className="text-amber-700"> · {line.packed} already packed</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/*
            A packed parcel has not left, so its units CAN be cancelled — the server
            pulls them out of the box in the same write. Say so, because the packer may
            be holding that box right now.
          */}
          {packedAffected > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {packedAffected} of these unit(s) are already in a packed parcel. They will be
                taken back out of it — check the box before it goes to the courier.
              </span>
            </div>
          )}

          {cancelsEverything && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This cancels every remaining line, so the <strong>whole order</strong> will be
                marked cancelled and the customer emailed.
              </span>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="cancel-reason" className="mb-1 block text-xs font-medium text-gray-600">Reason</label>
              <select
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="out_of_stock">Out of stock</option>
                <option value="customer_request">Customer asked for it</option>
                <option value="duplicate_order">Duplicate order</option>
                <option value="fraud_suspected">Fraud suspected</option>
              </select>
            </div>
            <div>
              <label htmlFor="cancel-notes" className="mb-1 block text-xs font-medium text-gray-600">
                Notes <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="cancel-notes"
                value={notes}
                maxLength={200}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/*
            No refund figure is previewed here on purpose. The amount is prorated against
            the order's coupon and karma by the server, and a number rendered client-side
            would either be wrong or would have to duplicate refundMathService. The exact
            figure appears on the record the moment it is created.
          */}
          <p className="mt-3 text-xs text-gray-500">
            The refund is calculated by the server, net of any discount on this order, and shown
            on the record once created. Sending it is a separate step.
          </p>

          <button
            onClick={handleCreate}
            disabled={saving || !chosenLines.length}
            className="mt-4 rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? 'Cancelling…' : 'Cancel these items'}
          </button>
        </div>
      )}

      <div className="divide-y">
        {cancellations.map((cancellation) => {
          const refund = cancellation.refund;
          const status = refund?.status || 'not_applicable';
          return (
            <div key={cancellation._id} className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">Cancellation {cancellation.sequence}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${REFUND_STYLE[status]}`}>
                  {REFUND_LABEL[status]}
                </span>
                {refund && refund.productValuePaise > 0 && (
                  <span className="flex items-center gap-0.5 text-sm font-medium text-gray-700">
                    <IndianRupee className="h-3.5 w-3.5" />
                    {rupees(
                      // Once sent, show what actually went; before that, what is owed.
                      refund.amountPaise > 0 ? refund.amountPaise : refund.productValuePaise,
                    ).replace('₹', '')}
                  </span>
                )}
                {(status === 'pending' || status === 'failed') && (
                  <button
                    onClick={() => handleRefund(cancellation)}
                    disabled={busyId === cancellation._id}
                    className="ml-auto flex items-center gap-1 rounded-lg border border-green-300 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-50 disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {busyId === cancellation._id
                      ? 'Sending…'
                      : status === 'failed' ? 'Retry refund' : 'Send refund'}
                  </button>
                )}
              </div>

              <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
                {describe(cancellation).map((line) => (
                  <li key={line.key} className="flex items-center gap-2">
                    <PackageX className="h-3.5 w-3.5 text-gray-400" />
                    {line.label}
                  </li>
                ))}
              </ul>

              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                {cancellation.cancelledAt && (
                  <span>Cancelled {formatLongDateIST(cancellation.cancelledAt)}</span>
                )}
                {cancellation.reason && <span>Reason: {cancellation.reason.replace(/_/g, ' ')}</span>}
                {cancellation.notes && <span>{cancellation.notes}</span>}
                {refund?.razorpayRefundId && (
                  <span className="font-mono">{refund.razorpayRefundId}</span>
                )}
                {refund?.completedAt && (
                  <span className="text-green-700">Refunded {formatLongDateIST(refund.completedAt)}</span>
                )}
              </div>

              {status === 'failed' && refund?.failureReason && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                  {refund.failureReason}
                </p>
              )}
            </div>
          );
        })}

        {!cancellations.length && (
          <p className="p-6 text-sm text-gray-500">
            Nothing has been cancelled on this order.
          </p>
        )}
      </div>
    </div>
  );
}
