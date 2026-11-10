'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { DollarSign, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { formatDateIST } from '@/lib/datetime';
import OfflineRefundDialog, { type OfflineRefundSubmission } from '@/components/admin/OfflineRefundDialog';
import { offlineMethodLabel, promptRevertReason } from '@/lib/offlineRefund';
import { useListParams } from '@/lib/hooks/useListParams';
import ExtraChargesList from '@/components/payments/extras/ExtraChargesList';
import { ListClear, ListDateRange, ListSearch, ListSelect } from '@/components/panel/ListControls';

interface Refund {
  _id: string;
  order: {
    _id: string;
    orderNumber: string;
  };
  user: {
    name: string;
  };
  /** null only on a `repair` row — the server prices those lines when it records them. */
  amount: number | null;
  refundType: string;
  /**
   * Which refund this row is (absent on an older server = 'order'):
   *   order        — the whole-order refund (POST /orders/:id/refund)
   *   cancellation — ONE cancelled item group (POST /orders/:id/cancellations/:cid/refund)
   *   repair       — items cancelled with the order but never given a refund record;
   *                  Refund records and sends them (POST /orders/:id/refund-all)
   */
  kind?: 'order' | 'cancellation' | 'repair';
  cancellationId?: string;
  /** "Wax × 2" — what the cancellation covers. */
  items?: string[];
  failureReason?: string | null;
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

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];
const SORTS = [
  { value: 'newest', label: 'Newest orders first' },
  { value: 'oldest', label: 'Oldest orders first' },
];

/** The page reads its filters from the address (useSearchParams), so it renders inside <Suspense>. */
export default function AdminRefundsPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading refunds...</div>}>
      <AdminRefunds />
    </Suspense>
  );
}

function AdminRefunds() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  /*
    Status, search, the order-date range and the sort live in the page address, so Back,
    a refresh or a shared link reopens the same queue. The server does all of it — this
    screen never filters rows itself (see the note above `filteredRefunds`).
  */
  const { values: v, set, clear } = useListParams({ status: 'all', q: '', from: '', to: '', sort: 'newest' });
  const statusFilter = STATUSES.some((x) => x.value === v.status) ? v.status : 'all';
  const searchTerm = v.q;
  const sort = v.sort === 'oldest' ? 'oldest' : 'newest';
  const filtered = statusFilter !== 'all' || Boolean(v.q || v.from || v.to);
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
    The search box waits for a pause in typing before it changes the address (ListSearch),
    so this does not fire a request per keystroke. Everything is sent to the SERVER — the
    screen used to filter a fully-loaded list in the browser, which stopped being possible
    when the query was bounded to a page. See orderRepository.findWithRefunds.
  */
  useEffect(() => {
    fetchRefunds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchTerm, v.from, v.to, sort]);

  // Each row kind has its own server endpoint — see `Refund.kind`. Every one of them
  // claims atomically on the server, so a double-click cannot pay twice.
  const processEndpoint = (refund: Refund) => {
    if (refund.kind === 'cancellation' && refund.cancellationId) {
      return API_ENDPOINTS.ORDER_CANCELLATION_REFUND(refund.order._id, refund.cancellationId);
    }
    if (refund.kind === 'repair') return API_ENDPOINTS.REFUND_ALL(refund.order._id);
    return API_ENDPOINTS.REFUND_PROCESS(refund.order._id);
  };

  const describeRefund = (refund: Refund) =>
    refund.items?.length ? `${refund.items.join(', ')} on order #${refund.order.orderNumber}` : `order #${refund.order.orderNumber}`;

  // Admin-triggered Razorpay refund.
  const handleProcess = async (refund: Refund) => {
    const what = refund.amount == null
      ? `the items cancelled without a refund record (${describeRefund(refund)}) — the server prices them first`
      : `₹${refund.amount.toLocaleString()} for ${describeRefund(refund)}`;
    if (!window.confirm(`Refund ${what} via Razorpay? This cannot be undone.`)) {
      return;
    }
    setProcessingId(refund._id);
    try {
      const res = await apiClient.post<{ message?: string }>(processEndpoint(refund), {});
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
      refund.kind === 'cancellation' && refund.cancellationId
        ? API_ENDPOINTS.ORDER_CANCELLATION_REFUND(refund.order._id, refund.cancellationId)
        : API_ENDPOINTS.REFUND_PROCESS(refund.order._id),
      { method: 'offline', ...values },
    );
    toast.success(res.message || 'Refund recorded.', { duration: res.warnings?.length ? 10000 : 4000 });
    await fetchRefunds();
  };

  /** Withdraw an offline record that was a mistake, putting the order back to "refund due". */
  const handleRevert = async (refund: Refund) => {
    const reason = promptRevertReason(describeRefund(refund));
    if (!reason) return;

    setProcessingId(refund._id);
    try {
      const res = await apiClient.post<{ message?: string }>(
        refund.kind === 'cancellation' && refund.cancellationId
          ? API_ENDPOINTS.ORDER_CANCELLATION_REFUND_REVERT(refund.order._id, refund.cancellationId)
          : API_ENDPOINTS.REFUND_REVERT(refund.order._id),
        { reason });
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
      if (v.from) params.append('from', v.from);
      if (v.to) params.append('to', v.to);
      if (sort !== 'newest') params.append('sort', sort);
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
      processing: 'bg-sky-100 text-sky-800',
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

      <section aria-label="Extra charges to refund" className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Extra charges to refund</h2>
        <ExtraChargesList fixedTab="refund_due" orderBase="/admin/orders" />
      </section>

      <div role="search" aria-label="Search and filter refunds" className="mb-6 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={searchTerm} onChange={(text) => set({ q: text.trim() })} label="Search refunds"
            placeholder="Search by order or customer..." />
          <ListSelect label="Status" value={statusFilter === 'all' ? '' : statusFilter}
            onChange={(x) => set({ status: x || 'all' })} allLabel="All Status" options={STATUSES} />
          <ListSelect label="Sort" value={sort} onChange={(x) => set({ sort: x })} options={SORTS} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ListDateRange label="Order placed" from={v.from} to={v.to} onChange={(from, to) => set({ from, to })}>
            <span>Order placed</span>
          </ListDateRange>
        </div>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {/*
            One order can give several rows (one per cancelled item group), so the server
            counts orders, not rows — this says what is on screen, and whether more follow.
          */}
          <p role="status" className="text-sm text-gray-600">
            {refunds.length.toLocaleString('en-IN')} refund{refunds.length === 1 ? '' : 's'}
            {nextCursor ? ' shown — more below' : filtered ? ' found' : ''}
          </p>
          {filtered && <ListClear onClear={() => clear(['sort'])} />}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
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
                  {refund.items?.length ? (
                    <div className="text-xs text-gray-600 mt-0.5">{refund.items.join(', ')}</div>
                  ) : null}
                  {refund.kind === 'repair' && (
                    <div className="text-xs text-amber-700 mt-0.5">cancelled with the order — no refund record yet</div>
                  )}
                  {refund.status === 'failed' && refund.failureReason && (
                    <div className="text-xs text-red-600 mt-0.5">last attempt: {refund.failureReason}</div>
                  )}
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
                    {refund.amount == null ? 'Priced on refund' : `₹${refund.amount.toLocaleString()}`}
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
                        {/* A repair row has no record to mark yet — Process Refund creates it. */}
                        {refund.kind !== 'repair' && (
                          <button
                            onClick={() => setOfflineFor(refund)}
                            disabled={processingId === refund._id}
                            className="px-3 py-1 border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 disabled:opacity-60"
                          >
                            Mark offline
                          </button>
                        )}
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
          subject={describeRefund(offlineFor)}
        />
      )}
    </div>
  );
}
