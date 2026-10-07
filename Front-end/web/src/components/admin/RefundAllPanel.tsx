'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { Cancellation } from './OrderCancellations';

/**
 * Admin — the ONE Refund button for an order whose lines were cancelled individually.
 *
 * Sends every refund the order still owes in one press (POST /orders/:id/refund-all).
 * The server does all the work through the per-line refund path, whose atomic claim is
 * what stops a double-click or two admins paying twice; this component only shows the
 * server's figures and asks it to act.
 *
 * ⚠️ Every rupee here is the server's `productValuePaise`, summed for display. Nothing is
 * priced on the client — list price × quantity is not what a discounted order paid.
 */

interface Props {
  orderId: string;
  paymentStatus?: string;
  customerName?: string;
  /** Bumped by the page whenever the order changed, so the figures re-read. */
  refreshKey?: number;
  onChanged?: () => void;
}

interface RefundAllResponse {
  message?: string;
  refundedRupees?: number;
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sumPaise = (list: Cancellation[]) =>
  list.reduce((n, c) => n + (c.refund?.productValuePaise || 0), 0);

export default function RefundAllPanel({ orderId, paymentStatus, customerName, refreshKey = 0, onChanged }: Props) {
  const [cancellations, setCancellations] = useState<Cancellation[]>([]);
  const [repairNeeded, setRepairNeeded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ cancellations?: Cancellation[]; refundRepairNeeded?: boolean }>(
        API_ENDPOINTS.ORDER_CANCELLATIONS(orderId));
      setCancellations(res.cancellations || []);
      setRepairNeeded(Boolean(res.refundRepairNeeded));
    } catch {
      /* the per-line panel below still works; this one just stays hidden */
    } finally {
      setLoaded(true);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!loaded || !cancellations.length) return null;

  const due = cancellations.filter((c) => c.refund?.status === 'pending' || c.refund?.status === 'failed');
  const settling = cancellations.filter((c) => c.refund?.status === 'processing');
  const done = cancellations.filter((c) => c.refund?.status === 'completed');
  const failed = due.filter((c) => c.refund?.status === 'failed');
  const duePaise = sumPaise(due);
  const canRefund = paymentStatus === 'paid' && (due.length > 0 || repairNeeded);

  // Nothing was ever owed (unpaid order) — no panel.
  if (!canRefund && !settling.length && !done.length) return null;

  const handleRefundAll = async () => {
    const amount = duePaise > 0 ? rupees(duePaise) : 'the amount due';
    const extra = repairNeeded ? ' (plus the items cancelled with the order that have no refund record yet)' : '';
    if (!window.confirm(`Refund ${amount}${extra} to ${customerName || 'the customer'} via Razorpay? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post<RefundAllResponse>(API_ENDPOINTS.REFUND_ALL(orderId), {});
      toast.success(res.message || 'Refund sent.');
    } catch (err: any) {
      // A partial failure: whatever succeeded stays refunded; pressing again retries only
      // the failed part. The server's message says exactly that.
      toast.error(err?.message || 'Refund failed. Press Refund again to retry.', { duration: 10000 });
    } finally {
      setBusy(false);
      await load();
      onChanged?.();
    }
  };

  return (
    <div className="mt-4 p-4 border border-gray-200 rounded-md" data-testid="refund-all-panel">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900">Refund</h3>
        {canRefund ? (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Refund due</span>
        ) : settling.length ? (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Refunding…</span>
        ) : (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Refunded ✓</span>
        )}
      </div>

      <ul className="text-sm text-gray-600 mb-3 space-y-0.5">
        {duePaise > 0 && <li>Still to refund: <span className="font-medium">{rupees(duePaise)}</span></li>}
        {repairNeeded && (
          <li className="text-amber-800">
            Some items were cancelled with the order but have no refund record yet. Refund records and sends them too.
          </li>
        )}
        {settling.length > 0 && <li>Settling with Razorpay: {rupees(sumPaise(settling))} (updates automatically)</li>}
        {done.length > 0 && <li>Already refunded: {rupees(sumPaise(done))}</li>}
        {failed.map((c) => c.refund?.failureReason && (
          <li key={c._id} className="text-xs text-red-600">Last attempt failed: {c.refund.failureReason}</li>
        ))}
      </ul>

      {canRefund && (
        <>
          <button
            onClick={handleRefundAll}
            disabled={busy}
            className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? 'Processing…' : duePaise > 0 ? `Refund ${rupees(duePaise)}` : 'Refund'}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            Sends every refund still owed on this order to the original payment method. Already-refunded
            items are never sent again. If you paid the customer by cash/NEFT instead, use &ldquo;Mark paid
            offline&rdquo; on that cancellation in the Cancellations panel.
          </p>
        </>
      )}
    </div>
  );
}
