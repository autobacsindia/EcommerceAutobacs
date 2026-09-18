'use client';

import { useState, useEffect, useRef } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Search, DollarSign, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { formatDateIST } from '@/lib/datetime';
import OfflineRefundDialog, { type OfflineRefundSubmission } from '@/components/admin/OfflineRefundDialog';
import { offlineMethodLabel, promptRevertReason } from '@/lib/offlineRefund';

interface Refund {
  _id: string;
  order: {
    _id: string;
    orderNumber: string;
  };
  user: {
    name: string;
  };
  amount: number;
  refundType: string;
  refundMethod: string;
  /** Present when the payout was settled outside Razorpay — see src/lib/offlineRefund.ts. */
  offlineMethod?: string | null;
  offlineReference?: string | null;
  /** A previous offline record on this order was withdrawn. */
  revertedAt?: string | null;
  status: string;
  requestedAt: string;
}

/** Opaque to this screen — whatever the server handed back, echoed verbatim. */
interface Cursor {
  createdAt: string;
  id: string;
}

const PAGE_SIZE = 50;

export default function AdminRefundsPage() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Which row's offline dialog is open. Rendered conditionally so it remounts per row
  // and seeds its amount from that refund rather than the previous one.
  const [offlineFor, setOfflineFor] = useState<Refund | null>(null);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // A ref, not state: it must be readable inside the very fetch that sets it, and it
  // should never itself trigger a re-render.
  const loadedOnce = useRef(false);

  /*
    Debounced so typing does not fire a request per keystroke. The term is sent to the
    SERVER — the screen used to filter a fully-loaded list in the browser, which stopped
    being possible when the query was bounded to a page. See orderRepository.findWithRefunds.
  */
  useEffect(() => {
    const id = setTimeout(() => fetchRefunds(), searchTerm ? 300 : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchTerm]);

  // Admin-triggered Razorpay refund for a cancelled, paid order.
  const handleProcess = async (refund: Refund) => {
    if (!window.confirm(`Refund ₹${(refund.amount || 0).toLocaleString()} for order #${refund.order.orderNumber} via Razorpay? This cannot be undone.`)) {
      return;
    }
    setProcessingId(refund._id);
    try {
      const res = await apiClient.post<{ message?: string }>(API_ENDPOINTS.REFUND_PROCESS(refund.order._id), {});
      toast.success(res.message || 'Refund initiated.');
      await fetchRefunds();
    } catch (err: any) {
      /*
        The dead end this feature exists for: the payment was already refunded by hand in
        the Razorpay dashboard, which writes nothing back here, so the gateway refuses and
        the row sits on "Retry" for ever. Open the offline dialog instead of leaving the
        admin with an error and nowhere to go.
      */
      if (err?.rawData?.offlineSettlementSuggested) {
        toast.error(err.message, { duration: 8000 });
        setOfflineFor(refund);
        await fetchRefunds();
        return;
      }
      toast.error(err?.message || 'Failed to process refund.');
    } finally {
      setProcessingId(null);
    }
  };

  /** Record a payout settled outside Razorpay. Errors rethrow so the dialog keeps the form. */
  const handleMarkOffline = async (refund: Refund, values: OfflineRefundSubmission) => {
    const res = await apiClient.post<{ message?: string; warnings?: string[] }>(
      API_ENDPOINTS.REFUND_PROCESS(refund.order._id),
      { method: 'offline', ...values },
    );
    toast.success(res.message || 'Refund recorded.', { duration: res.warnings?.length ? 10000 : 4000 });
    await fetchRefunds();
  };

  /** Withdraw an offline record that was a mistake, putting the order back to "refund due". */
  const handleRevert = async (refund: Refund) => {
    const reason = promptRevertReason(`order #${refund.order.orderNumber}`);
    if (!reason) return;

    setProcessingId(refund._id);
    try {
      const res = await apiClient.post<{ message?: string }>(
        API_ENDPOINTS.REFUND_REVERT(refund.order._id), { reason });
      toast.success(res.message || 'Refund record withdrawn.');
      await fetchRefunds();
    } catch (err: any) {
      toast.error(err?.message || 'Could not withdraw the refund record.', { duration: 8000 });
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Load a page of the queue.
   *
   * @param cursor - echoed straight back from the previous page's `nextCursor`; its
   *   shape is the server's business. Absent = start again from the newest row.
   */
  const fetchRefunds = async (cursor: Cursor | null = null) => {
    try {
      /*
        `loading` drives a FULL-PAGE replacement, so it may only ever be set for the very
        first load. Setting it on a debounced search re-render unmounted the search
        <input> mid-keystroke and threw focus to the body — the admin typed two
        characters and then found themselves typing into nothing.
      */
      if (cursor) setLoadingMore(true);
      else if (!loadedOnce.current) setLoading(true);

      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      params.append('limit', String(PAGE_SIZE));
      if (cursor) {
        params.append('cursorCreatedAt', cursor.createdAt);
        params.append('cursorId', cursor.id);
      }

      const response = await apiClient.get(
        `${API_ENDPOINTS.REFUNDS_LIST}?${params.toString()}`,
      ) as { refunds?: Refund[]; nextCursor?: Cursor | null };

      // Append when paging, replace when the filter or search changed — otherwise
      // narrowing a search would leave the previous, wider results on screen beneath it.
      setRefunds((prev) => (cursor ? [...prev, ...(response.refunds || [])] : (response.refunds || [])));
      setNextCursor(response.nextCursor || null);
    } catch (err) {
      console.error('Failed to fetch refunds:', err);
    } finally {
      loadedOnce.current = true;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  /*
    No client-side filtering any more. It only ever worked because the endpoint returned
    every matching order; with the query bounded to a page it would have silently become
    "search within the rows you happen to have loaded", which looks like working search
    and quietly hides results.
  */
  const filteredRefunds = refunds;

  if (loading) {
    return <div className="p-8">Loading refunds...</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Refunds Management</h1>

      <div className="mb-6 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order or customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-4 py-2"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Requested Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Method
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredRefunds.map((refund) => (
              <tr key={refund._id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <Link
                    href={`/admin/orders/${refund.order._id}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-900"
                  >
                    #{refund.order.orderNumber}
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{refund.user.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-500">
                    {formatDateIST(refund.requestedAt)}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm font-medium text-gray-900">
                    <DollarSign className="h-4 w-4 mr-1" />
                    ₹{(refund.amount || 0).toLocaleString()}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 capitalize">
                    {refund.refundType ? refund.refundType.replace(/_/g, ' ') : 'N/A'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 capitalize">
                    {refund.refundMethod === 'offline'
                      ? `Offline — ${offlineMethodLabel(refund.offlineMethod || undefined)}`
                      : refund.refundMethod ? refund.refundMethod.replace(/_/g, ' ') : 'N/A'}
                  </div>
                  {refund.refundMethod === 'offline' && refund.offlineReference && (
                    <div className="text-xs text-gray-500">ref {refund.offlineReference}</div>
                  )}
                  {/* A withdrawn record — visible before anyone presses Process again. */}
                  {refund.revertedAt && refund.status !== 'completed' && (
                    <div className="text-xs text-amber-700">a previous offline record was withdrawn</div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(refund.status)}`}>
                    {refund.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center gap-3">
                    {['pending', 'failed'].includes(refund.status) && (
                      <>
                        <button
                          onClick={() => handleProcess(refund)}
                          disabled={processingId === refund._id}
                          className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-60"
                        >
                          {processingId === refund._id ? 'Processing…' : refund.status === 'failed' ? 'Retry' : 'Process Refund'}
                        </button>
                        <button
                          onClick={() => setOfflineFor(refund)}
                          disabled={processingId === refund._id}
                          className="px-3 py-1 border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 disabled:opacity-60"
                        >
                          Mark offline
                        </button>
                      </>
                    )}
                    {/*
                      Revert only for a record settled offline, keyed on `offlineMethod`
                      rather than `refundMethod`.

                      A RETURN's offline refund mirrors onto the same subdoc with
                      `refundMethod: 'offline'` but never sets `offlineMethod` (it stores
                      its reference in `transactionId`). `claimRefundRevert` deliberately
                      excludes those mirrors via their `Return <id>` note, so the looser
                      test offered a button that always 409'd with a message contradicting
                      the row it sat on. Returns are reverted from the returns screen.
                      Same gate OrderCancellations.tsx uses.
                    */}
                    {refund.status === 'completed' && refund.offlineMethod && (
                      <button
                        onClick={() => handleRevert(refund)}
                        disabled={processingId === refund._id}
                        className="px-3 py-1 border border-red-300 text-red-700 text-xs font-medium rounded-md hover:bg-red-50 disabled:opacity-60"
                      >
                        {processingId === refund._id ? 'Working…' : 'Revert'}
                      </button>
                    )}
                    <Link
                      href={`/admin/orders/${refund.order._id}`}
                      className="text-blue-600 hover:text-blue-900"
                      title="View Order"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredRefunds.length === 0 && !loading && (
        <div className="text-center py-12 bg-white rounded-lg shadow mt-6">
          <DollarSign className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No refunds found</h3>
          <p className="text-gray-500">There are no refunds matching your criteria.</p>
        </div>
      )}

      {nextCursor && (
        <div className="mt-6 text-center">
          <button
            onClick={() => fetchRefunds(nextCursor)}
            disabled={loadingMore}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {offlineFor && (
        <OfflineRefundDialog
          open
          onClose={() => setOfflineFor(null)}
          onSubmit={(values) => handleMarkOffline(offlineFor, values)}
          maxAmount={offlineFor.amount || 0}
          subject={`order #${offlineFor.order.orderNumber}`}
        />
      )}
    </div>
  );
}
