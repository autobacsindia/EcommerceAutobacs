'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import apiClient from '@/lib/api';
import { adminKeys } from '@/hooks/queries/keys';
import toast from 'react-hot-toast';
import { API_ENDPOINTS, ORDER_STATUS_COLORS, ORDER_STATUS_LABELS, CUSTOMER_NOTIFIED_STATUSES, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS } from '@/lib/constants';
import { Eye, RefreshCw, Download, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import OrderFiltersPanel, { OrderFilters } from '@/components/orders/OrderFiltersPanel';
import { getPageNumbers } from '@/lib/pagination';
import BulkActionsBar from '@/components/orders/BulkActionsBar';
import ConfirmStatusChangeModal, { ConfirmStatusPayload } from '@/components/orders/ConfirmStatusChangeModal';
import { updateOrderStatus } from '@/lib/orderStatusUpdate';
import { formatDateIST, formatTimeIST, formatIsoDateIST, formatIsoDateTimeIST } from '@/lib/datetime';
import ParcelProgressBadge from '@/components/orders/shared/ParcelProgressBadge';
import { outstandingParcels, hasCancellations, hasOpenReturn } from '@/lib/orderFulfilment';
import type { ShipmentSummary } from '@/lib/orderFulfilment';

// Mirror of orderStatusService STATUS_TRANSITIONS (fulfillment axis).
const STATUS_TRANSITIONS: Record<string, string[]> = {
  awaiting_payment: ['processing', 'cancelled'],
  processing:       ['shipped', 'cancelled'],
  shipped:          ['delivered'],
  delivered:        ['returned'],
  returned:         [],
  cancelled:        [],
};

const ALL_STATUSES = Object.keys(STATUS_TRANSITIONS) as string[];

// Pre-payment state — the order isn't a real fulfillment stage yet and an admin
// never picks it manually (payment moves it to processing).
const SYSTEM_OWNED = ['awaiting_payment'];

// A cancel is only valid BEFORE delivery — once delivered/returned it's a
// return/refund, never a cancellation (mirrors the backend hard rule).
const CANCEL_BLOCKED_FROM = ['delivered', 'returned', 'cancelled'];

/** Statuses an admin can manually move an order to (fulfillment/exception states only). */
function getAdminNextStatuses(currentStatus: string): string[] {
  // Admins can force any fulfillment transition, but never a payment-driven status,
  // and never a cancel once the order is delivered.
  return ALL_STATUSES.filter(s => {
    if (s === currentStatus || SYSTEM_OWNED.includes(s)) return false;
    if (s === 'cancelled' && CANCEL_BLOCKED_FROM.includes(currentStatus)) return false;
    return true;
  });
}

interface Order {
  _id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus?: string;
  cancelledBy?: 'admin' | 'customer' | 'system';
  totalAmount: number;
  refundDetails?: {
    status?: string;
    amount?: number;
    transactionId?: string;
  };
  user: {
    _id: string;
    name: string;
    email: string;
  };
  items: any[];
  /**
   * Parcels. Projected onto the admin list read (see orderProjections.js), so both the
   * split badge and the delivered warning cost no extra request.
   */
  shipments?: ShipmentSummary[];
  /** Cancelled lines, for the part-cancelled badge. */
  cancellations?: Array<{ _id: string; lines?: Array<{ itemId: string; quantity: number }> }>;
  /**
   * Business-purchase marker. Only `type` and `gstin` reach this table
   * (repositories/orderProjections.js ADMIN_LIST_FIELDS); the registered name and
   * billing address are on the order detail page. Absent on legacy orders.
   */
  buyer?: { type?: 'individual' | 'enterprise'; gstin?: string };
  /**
   * Mirror of the LATEST return's status — status only, deliberately. A partial return
   * no longer moves the order to `returned` (that state is terminal and stranded the
   * un-returned lines), so this is what keeps "a return is open" visible on the row.
   * Not summable into a count: see hasOpenReturn.
   */
  returnRequest?: { status?: string };
}

// Who cancelled the order — mirrors the wording on the order detail page so the list and
// the detail read the same. `system` = an automated/expiry cancel, not a person.
const CANCELLED_BY_TEXT: Record<string, string> = {
  customer: 'by Customer',
  admin: 'by Admin',
  system: 'by System',
};

/**
 * Refund state for a row, derived from the cancellation refund flow:
 * cancelled + paid with no terminal refund yet ⇒ "due"; then processing → completed/failed.
 * Returns null when there's nothing to show (order not a paid cancellation).
 */
function getRefundBadge(order: Order): { label: string; className: string } | null {
  const isPaidCancellation = order.status === 'cancelled' && (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded');
  const refundStatus = order.refundDetails?.status;

  if (order.paymentStatus === 'refunded' || refundStatus === 'completed') {
    return { label: 'Refunded ✓', className: 'bg-green-100 text-green-800' };
  }
  if (refundStatus === 'processing') {
    return { label: 'Refunding…', className: 'bg-blue-100 text-blue-800' };
  }
  if (refundStatus === 'failed') {
    return { label: 'Refund failed', className: 'bg-red-100 text-red-800' };
  }
  if (isPaidCancellation) {
    return { label: 'Refund due', className: 'bg-yellow-100 text-yellow-800' };
  }
  return null;
}

interface OrdersResponse {
  success: boolean;
  count: number;
  orders: Order[];
  pagination?: {
    total: number;
    pages: number;
    currentPage: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

type SortField = 'createdAt' | 'totalAmount' | 'status';
type SortOrder = 'asc' | 'desc';

/** Numbered pagination navigator for the admin orders table (light theme). */
function OrdersPagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(currentPage, totalPages);
  const base = 'min-w-9 px-3 py-2 rounded-lg border text-sm font-medium transition-colors';
  const inactive = `${base} bg-white border-gray-300 text-gray-700 hover:bg-gray-50`;
  const active = `${base} bg-blue-600 border-blue-600 text-white`;
  const disabled = `${base} bg-white border-gray-200 text-gray-300 cursor-not-allowed`;

  return (
    <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Orders pagination">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className={currentPage <= 1 ? disabled : inactive}
        aria-label="Previous page"
      >
        Prev
      </button>

      {pages.map((page, i) =>
        typeof page === 'string' ? (
          <span key={`gap-${i}`} className="px-2 text-gray-400 select-none">{page}</span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page as number)}
            className={page === currentPage ? active : inactive}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </button>
        )
      )}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className={currentPage >= totalPages ? disabled : inactive}
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  );
}

function AdminOrdersPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const queryClient = useQueryClient();
  /*
    Seeded from the URL, not hardcoded to 1. The filters have always lived in the query
    string, but the page number did not — so returning to this screen (in particular via
    Back from an order, which the "Shipped" hand-off now does routinely) always dropped
    the admin on page 1. That directly undercuts the "work through many orders quickly"
    workflow the hand-off is built around: shipping order #3 on page 7 sent you back to
    page 1 to find #4.
  */
  const [currentPage, setCurrentPage] = useState(
    () => Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1));
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [pageSize, setPageSize] = useState(20);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [pendingChange, setPendingChange] = useState<{
    orderId: string;
    orderNumber: string;
    from: string;
    to: string;
    /** Units on the order — the dialog names how many ship together in one parcel. */
    unitCount: number;
    /** Outstanding parcels, for the delivered-side warning. */
    parcelCount: number;
  } | null>(null);
  const [pendingBulk, setPendingBulk] = useState<{
    status: string;
    reason: string;
    notes: string;
    count: number;
  } | null>(null);

  /**
   * Spin-to-Win reward filter — LIFTED to the page, deliberately not placed inside
   * OrderFiltersPanel.
   *
   * The panel echoes its `filters` prop back down on every parent render, which has
   * already clobbered in-flight typing in the search box once. A toggle owned here
   * cannot be caught by that, and it matches how the hide-unpaid filter is handled.
   */

  // Initialize filters from URL params
  const [filters, setFilters] = useState<OrderFilters>(() => ({
    search: searchParams.get('search') || '',
    statuses: searchParams.get('status')?.split(',').filter(Boolean) || [],
    paymentStatuses: searchParams.get('paymentStatus')?.split(',').filter(Boolean) || [],
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    minAmount: searchParams.get('minAmount') || '',
    maxAmount: searchParams.get('maxAmount') || '',
    customer: searchParams.get('customer') || '',
  }));

  // Server-side list via TanStack Query. `currentPage` is now the input page;
  // the server's echoed pagination comes back in the query data. keepPreviousData
  // keeps the current table up while a filter/sort/page change loads.
  const listKey = adminKeys.list('orders', {
    page: String(currentPage),
    size: String(pageSize),
    sortBy: sortField,
    sortOrder,
    search: filters.search || undefined,
    customer: filters.customer || undefined,
    status: filters.statuses.length ? filters.statuses.join(',') : undefined,
    paymentStatus: filters.paymentStatuses?.length ? filters.paymentStatuses.join(',') : undefined,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    minAmount: filters.minAmount || undefined,
    maxAmount: filters.maxAmount || undefined,
  });
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      // Unified search: order id OR customer name/email/phone OR recipient on the order.
      if (filters.search) params.append('search', filters.search);
      if (filters.customer) params.append('customer', filters.customer);
      if (filters.statuses.length > 0) params.append('status', filters.statuses.join(','));
      if (filters.paymentStatuses?.length) params.append('paymentStatus', filters.paymentStatuses.join(','));
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.minAmount) params.append('minAmount', filters.minAmount);
      if (filters.maxAmount) params.append('maxAmount', filters.maxAmount);
      params.append('page', String(currentPage));
      params.append('limit', String(pageSize));
      params.append('sortBy', sortField);
      params.append('sortOrder', sortOrder);
      const response = await apiClient.get<OrdersResponse>(`${API_ENDPOINTS.ADMIN_ORDERS}?${params.toString()}`);
      return {
        orders: response.orders || [],
        pagination: response.pagination || {
          total: response.orders?.length || 0, pages: 1, currentPage: 1, hasNext: false, hasPrev: false,
        },
      };
    },
    placeholderData: keepPreviousData,
  });
  const orders = data?.orders ?? [];
  const pagination = data?.pagination ?? { total: 0, pages: 0, currentPage, hasNext: false, hasPrev: false };
  const loading = isFetching;

  /*
    Picking "Shipped" on an order that could travel in more than one box hands over to
    the order's Parcels panel instead of shipping everything here.

    ── WHY NOT SHIP IT INLINE ────────────────────────────────────────────────────────
    This dialog has one tracking field and no way to say what is IN the box, so
    confirming it puts every outstanding unit in a single parcel. On a multi-item order
    that is only right by accident — the 3-item order where 2 are in stock is exactly the
    case, and it recorded all 3 as gone. The detail page already intercepts `shipped` for
    this reason; the list did not, so the same click meant two different things depending
    on which screen it was made from. A warning banner named the problem but still let it
    through.

    Routing to the panel rather than duplicating a line-picker here keeps ONE place that
    builds parcels, and keeps it on the properly-validated POST /:id/shipments endpoint
    (PUT /:id/status accepts `lines` but its validator does not cover them).

    ── WHY THIS IS NOT UNCONDITIONAL, UNLIKE THE DETAIL PAGE ─────────────────────────
    This screen exists to work through many orders quickly, and a single-unit order has
    nothing to split — there is exactly one honest parcel. Sending those through a page
    navigation would be pure friction for the common case. So the fast path survives
    precisely where it cannot be wrong.

    An order that ALREADY has parcels is treated as splittable whatever its unit count:
    a second box is by definition a split, and the panel is where its contents are chosen.
  */
  /*
    States in which a NEW parcel can exist at all — mirrors `SHIPPABLE_STATUSES` in
    Back-end/server/services/shipmentService.js, which rejects anything else outright.

    The dropdown still offers "Shipped" from `delivered`, `returned` and `cancelled`
    (getAdminNextStatuses only blocks a cancel after delivery), and those orders have
    nothing left to put in a box. Handing one to the Parcels panel is a dead end: the
    panel's open-effect requires something outstanding, so the form never appears and the
    admin gets no dialog, no toast and no error — the click silently does nothing. The
    modal, by contrast, sends the request and surfaces the server's rejection inline,
    which is the same answer a single-unit order in that state already gets.

    So the hand-off is for orders that can genuinely be shipped; everything else keeps the
    dialog and therefore keeps its error message.
  */
  const SHIPPABLE_STATUSES = ['processing', 'shipped'];

  const shippableInOneBox = (order: Order) => {
    const units = (order.items ?? []).reduce(
      (n: number, i: { quantity?: number }) => n + (i?.quantity ?? 1), 0);
    return units <= 1 && (order.shipments?.length ?? 0) === 0;
  };

  // Open the confirmation modal instead of firing the API immediately.
  const requestStatusChange = (order: Order, newStatus: string) => {
    if (
      newStatus === 'shipped'
      && SHIPPABLE_STATUSES.includes(order.status)
      && !shippableInOneBox(order)
    ) {
      // `parcel=1` opens the panel's create-parcel form and scrolls to it, so the admin
      // lands on the same form the detail page's own dropdown would have opened.
      router.push(`/admin/orders/${order._id}?parcel=1`);
      return;
    }

    setPendingChange({
      orderId: order._id,
      orderNumber: order.orderNumber,
      from: order.status,
      to: newStatus,
      /*
        Units on the order, so the dialog can say what shipping from HERE actually does.
        This screen keeps its one-click path deliberately — it is for working through
        many orders quickly — but that path puts EVERYTHING in a single parcel, which is
        only right by accident on a multi-item order. Naming the count is what stops it
        being a silent decision; splitting is done from the order's Parcels panel.
      */
      unitCount: (order.items ?? []).reduce(
        (n: number, i: { quantity?: number }) => n + (i?.quantity ?? 1), 0),
      /*
        Parcels this change would land at once. `delivered` runs deliverAllOutstanding
        server-side, which is required — the per-line return window reads parcel dates,
        so leaving them at `shipped` would keep every window shut — but on a split order
        it is a decision worth naming, and it emails the customer once per parcel.
        Counts only the parcels still in flight; already-delivered ones are no-ops.
      */
      parcelCount: outstandingParcels(order),
    });
  };

  // Runs the update after the admin confirms in the modal. Throws on failure so the
  // modal surfaces the error inline; resolves (and closes the modal) on success.
  const confirmStatusChange = async ({ note, shipping }: ConfirmStatusPayload) => {
    if (!pendingChange) return;
    const { orderId, to } = pendingChange;
    await updateOrderStatus(orderId, {
      status: to,
      note: note || 'Status updated from admin panel',
      shipping,
    });

    // Optimistically reflect the new status in the current page's cache for
    // instant feedback, then invalidate so the row re-sorts / re-pages correctly
    // (e.g. when the table is sorted by status the row must move, and a status
    // filter may drop it from the current view).
    queryClient.setQueryData<{ orders: Order[]; pagination: typeof pagination }>(listKey, (old) =>
      old ? { ...old, orders: old.orders.map((o) => (o._id === orderId ? { ...o, status: to } : o)) } : old
    );
    queryClient.invalidateQueries({ queryKey: adminKeys.resource('orders') });
    setPendingChange(null);
    toast.success(`Order status updated to ${to}`);
  };

  /*
    ── ONE OWNER FOR THE `page` PARAM ────────────────────────────────────────────────
    `updateURL` owns the FILTER params; this owns `page`, and nothing else writes it.

    Five separate handlers reset the page to 1 (filters, sort, page size, bulk status,
    bulk delete) and more will follow. Mirroring the URL at each call site means the next
    one added forgets, and the URL silently disagrees with the state — the same
    "fix one path, miss the other" drift this screen has already been bitten by. Deriving
    it from `currentPage` instead makes every present and future reset correct for free.

    Loop-safe: the write is skipped when the query string already matches, so the
    `searchParams` change it causes does not trigger another write.
  */
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    // Page 1 is the default and stays out of the URL, so a plain /admin/orders never
    // grows a redundant ?page=1.
    if (currentPage > 1) params.set('page', String(currentPage));
    else params.delete('page');

    if (params.toString() === searchParams.toString()) return;
    router.replace(`/admin/orders?${params.toString()}`, { scroll: false });
  }, [currentPage, searchParams, router]);

  const handleFiltersChange = (newFilters: OrderFilters) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page
    updateURL(newFilters);
  };

  const updateURL = (newFilters: OrderFilters) => {
    const params = new URLSearchParams();
    
    if (newFilters.search) params.set('search', newFilters.search);
    if (newFilters.customer) params.set('customer', newFilters.customer);
    if (newFilters.statuses.length > 0) params.set('status', newFilters.statuses.join(','));
    if (newFilters.paymentStatuses?.length) params.set('paymentStatus', newFilters.paymentStatuses.join(','));
    if (newFilters.startDate) params.set('startDate', newFilters.startDate);
    if (newFilters.endDate) params.set('endDate', newFilters.endDate);
    if (newFilters.minAmount) params.set('minAmount', newFilters.minAmount);
    if (newFilters.maxAmount) params.set('maxAmount', newFilters.maxAmount);
    
    // replace, not push: filters commit on a debounce while the admin types, so pushing
    // would stack a history entry per typing pause and make Back walk backwards through
    // half-typed search terms instead of leaving the page. The URL stays a shareable
    // snapshot of the current view either way.
    router.replace(`/admin/orders?${params.toString()}`, { scroll: false });
  };

  // Sorting re-orders the whole result set, so jump back to page 1 — staying on
  // page 5 of a freshly re-sorted list would show an arbitrary middle slice.
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const goToPage = (page: number) => {
    setCurrentPage(page);
  };

  const handleExport = () => {
    // Export visible orders as CSV
    const csv = [
      ['Order Number', 'Customer', 'Email', 'Date (IST)', 'Items', 'Amount', 'Status'].join(','),
      ...orders.map(order => [
        order.orderNumber || order._id.slice(-8),
        order.user?.name || 'N/A',
        order.user?.email || 'N/A',
        // Sortable, unambiguous IST timestamp ("2026-08-01 02:00"). A localised
        // date here was both machine-dependent and comma-bearing (which would
        // silently shift every column right of it in this unquoted CSV).
        formatIsoDateTimeIST(order.createdAt),
        order.items?.length || 0,
        order.totalAmount.toFixed(2),
        order.status
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${formatIsoDateIST(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrders(prev =>
      prev.includes(orderId)
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const handleSelectAll = () => {
    setSelectedOrders(orders.map(o => o._id));
  };

  const handleClearSelection = () => {
    setSelectedOrders([]);
  };

  // Open the confirmation modal instead of applying the bulk update immediately.
  const handleBulkStatusUpdate = async (status: string, reason: string, notes: string) => {
    setPendingBulk({ status, reason, notes, count: selectedOrders.length });
  };

  // Applies the bulk update once confirmed. Throws on hard failure so the modal shows
  // the error inline; resolves (closing the modal) on success or partial success.
  const confirmBulkStatusUpdate = async ({ note }: ConfirmStatusPayload) => {
    if (!pendingBulk) return;
    const { status, reason } = pendingBulk;
    const response = await apiClient.post(API_ENDPOINTS.ORDER_BULK_STATUS, {
      orderIds: selectedOrders,
      status,
      reason,
      notes: note || pendingBulk.notes,
    }) as any;

    const { successful, failed } = response.results || { successful: [], failed: [] };

    if (failed.length === 0) {
      toast.success(`Updated ${successful.length} order(s) to ${status}`);
    } else {
      /*
        The failures are now ACTIONABLE, so they belong on screen rather than in the
        console. Bulk refuses to guess on a split order — it will not invent a parcel
        for un-boxed units (no carrier or AWB in a bulk request), and it will not mark
        an order delivered while part of it was never shipped. Each rejection names the
        reason, and "see console" hid exactly the message the admin needs in order to
        know which orders to open in the Parcels panel.

        Throwing keeps the modal open with the detail inline; a toast would be gone
        before anyone had read a list of order numbers.
      */
      const detail = failed
        .slice(0, 5)
        .map((f: { orderId: string; error: string }) => `• ${f.orderId.slice(-8)} — ${f.error}`)
        .join('\n');
      const more = failed.length > 5 ? `\n…and ${failed.length - 5} more.` : '';

      // Refresh first: the successful ones really did change, and the admin is about to
      // act on the rest from this same screen.
      setCurrentPage(1);
      await queryClient.invalidateQueries({ queryKey: adminKeys.resource('orders') });
      setSelectedOrders([]);

      throw new Error(
        `Updated ${successful.length} order(s); ${failed.length} could not be changed:\n${detail}${more}`
      );
    }

    // A bulk status change can drop orders off a status-filtered page; reset to
    // page 1 so the refetched view is never an empty out-of-range page.
    setCurrentPage(1);
    await queryClient.invalidateQueries({ queryKey: adminKeys.resource('orders') });
    setSelectedOrders([]);
    setPendingBulk(null);
  };

  const handleBulkDelete = async () => {
    if (selectedOrders.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedOrders.length} orders? Only cancelled or failed orders can be deleted. This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await apiClient.post(API_ENDPOINTS.ORDER_BULK_DELETE, {
        orderIds: selectedOrders,
      }) as any;
      
      const { successful, failed } = response.results || { successful: [], failed: [] };
      
      // Show results
      if (failed.length === 0) {
        alert(`Successfully deleted ${successful.length} order(s)`);
      } else {
        alert(
          `Deleted ${successful.length} order(s).\n` +
          `Failed to delete ${failed.length} order(s) (likely not cancelled/failed):\n` +
          failed.map((f: any) => `- ${f.orderId}: ${f.error}`).join('\n')
        );
      }
      
      // Reset to page 1 so a delete that shrinks the result set below the current
      // page can't strand the admin on an empty, un-navigable page.
      setCurrentPage(1);
      // Refresh and clear selection
      await queryClient.invalidateQueries({ queryKey: adminKeys.resource('orders') });
      setSelectedOrders([]);
    } catch (error: any) {
      console.error('Bulk delete failed:', error);
      alert(error.message || 'Bulk delete failed');
    }
  };

  const handleExportSelected = () => {
    const selectedOrdersData = orders.filter(o => selectedOrders.includes(o._id));
    
    const csv = [
      ['Order Number', 'Customer', 'Email', 'Date (IST)', 'Items', 'Amount', 'Status'].join(','),
      ...selectedOrdersData.map(order => [
        order.orderNumber || order._id.slice(-8),
        order.user?.name || 'N/A',
        order.user?.email || 'N/A',
        // Sortable, unambiguous IST timestamp ("2026-08-01 02:00"). A localised
        // date here was both machine-dependent and comma-bearing (which would
        // silently shift every column right of it in this unquoted CSV).
        formatIsoDateTimeIST(order.createdAt),
        order.items?.length || 0,
        order.totalAmount.toFixed(2),
        order.status
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-orders-${formatIsoDateIST(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <button
      onClick={() => handleSort(field)}
      className="ml-1 inline-flex items-center hover:text-gray-900"
    >
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  if (loading && orders.length === 0) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Orders Management</h1>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      <OrderFiltersPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        autoApply={true}
      />

      {isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load orders — the server may be unavailable. Use Refresh or adjust the filters to retry.
        </div>
      )}

      {/* Stats Summary */}
      <div className="mb-6 flex items-center justify-between text-sm text-gray-600">
        <div>
          Showing {orders.length} of {pagination.total} orders
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={selectedOrders.length === orders.length && orders.length > 0}
                    onChange={selectedOrders.length === orders.length ? handleClearSelection : handleSelectAll}
                    className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                  <SortIcon field="createdAt" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Items
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                  <SortIcon field="totalAmount" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                  <SortIcon field="status" />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Refund
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.map((order) => (
                <tr key={order._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order._id)}
                      onChange={() => handleSelectOrder(order._id)}
                      className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      #{order.orderNumber || order._id.slice(-8)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{order.user?.name || 'N/A'}</div>
                    <div className="text-sm text-gray-500">{order.user?.email || 'N/A'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500">
                      {formatDateIST(order.createdAt)}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatTimeIST(order.createdAt, '')}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{order.items?.length || 0}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      ₹{order.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {order.paymentStatus ? (
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[order.paymentStatus] || 'bg-gray-100 text-gray-800'}`}>
                        {PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {order.status === 'awaiting_payment' ? (
                      // Fulfillment hasn't started — the Payment column tells the story.
                      <span className="text-gray-400">—</span>
                    ) : (
                      <>
                        <select
                          value={order.status}
                          onChange={(e) => {
                            const next = e.target.value;
                            /*
                              Put the select back on the order's real status before acting.
                              It is a controlled input, so every path that changes state
                              re-renders and resets it anyway — but the "Shipped" hand-off
                              to the Parcels panel changes NO state on this page, and
                              without this the row would be left reading "Shipped" for an
                              order that has not shipped. Same reset the detail page's
                              dropdown does, for the same reason.
                            */
                            e.target.value = order.status;
                            requestStatusChange(order, next);
                          }}
                          className={`px-3 py-1 rounded-full text-xs font-medium border-0 focus:ring-2 focus:ring-offset-2 ${ORDER_STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-800'}`}
                        >
                          {/* Current status — always shown as selected, disabled so user must pick a different one */}
                          <option value={order.status} disabled>
                            {(ORDER_STATUS_LABELS[order.status] || order.status)} (current)
                          </option>
                          {getAdminNextStatuses(order.status).map(s => (
                            <option key={s} value={s}>
                              {ORDER_STATUS_LABELS[s] || s}
                            </option>
                          ))}
                        </select>
                        {/*
                          Split-order progress. Without it a 1-of-3-delivered order read
                          exactly like a 0-of-3 one: the dropdown shows `Shipped` for
                          both, because the order status only flips once the LAST parcel
                          lands. Self-hiding at one parcel.
                        */}
                        <ParcelProgressBadge
                          order={order}
                          className="mt-1 block text-[11px] font-medium text-gray-500"
                        />
                        {/*
                          Part-cancelled orders keep a LIVE status (`processing` or
                          `shipped`), so the dropdown alone gives ops no sign that some
                          lines were killed and refunded. Only shown while the order is
                          still live — a wholly cancelled one already reads `Cancelled`.
                        */}
                        {hasCancellations(order) && order.status !== 'cancelled' && (
                          <div className="mt-1 text-[11px] font-medium text-red-600">Part cancelled</div>
                        )}
                        {/*
                          B2B marker. Ops handle these differently (GST paperwork,
                          often a different bill-to), so it needs to be visible in
                          the table rather than only after opening the order. The
                          GSTIN rides in the tooltip so it can be checked without
                          a navigation.
                        */}
                        {order.buyer?.type === 'enterprise' && (
                          <div
                            title={order.buyer.gstin ? `GSTIN ${order.buyer.gstin}` : undefined}
                            className="mt-1 text-[11px] font-medium text-amber-700"
                          >
                            Business (GST)
                          </div>
                        )}
                        {/*
                          A return no longer drags the whole order to `returned` unless it
                          covers every delivered line — `returned` is terminal, and on a
                          1-of-3 return it stranded the other two. So a partly-returned
                          order correctly still reads `Delivered`, and this is what stops
                          that being LESS information than ops had before.

                          Says only that a return is open: `returnRequest` mirrors the
                          latest return, so it cannot be summed into "1 of 3".
                        */}
                        {hasOpenReturn(order) && (
                          <div className="mt-1 text-[11px] font-medium text-amber-600">Return in progress</div>
                        )}
                        {/* Cancellation attribution — admin vs customer at a glance, no drill-in. */}
                        {order.status === 'cancelled' && order.cancelledBy && CANCELLED_BY_TEXT[order.cancelledBy] && (
                          <div className="mt-1 text-[11px] text-gray-400">{CANCELLED_BY_TEXT[order.cancelledBy]}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {(() => {
                      const badge = getRefundBadge(order);
                      return badge ? (
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      );
                    })()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <Link
                      href={`/admin/orders/${order._id}`}
                      className="text-blue-600 hover:text-blue-900 inline-flex items-center gap-1"
                    >
                      <Eye className="h-4 w-4" />
                      <span>View</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <>
          <OrdersPagination
            currentPage={currentPage}
            totalPages={pagination.pages}
            onPageChange={goToPage}
          />
          <div className="mt-2 text-center text-sm text-gray-600">
            Page {currentPage} of {pagination.pages}
          </div>
        </>
      )}

      {/* Empty State */}
      {orders.length === 0 && !loading && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
          <p className="text-gray-500">Try adjusting your filters to find what you're looking for.</p>
        </div>
      )}

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedOrders.length}
        totalCount={orders.length}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onBulkStatusUpdate={handleBulkStatusUpdate}
        onExportSelected={handleExportSelected}
        onBulkDelete={handleBulkDelete}
      />

      {pendingChange && (
        <ConfirmStatusChangeModal
          orderNumber={pendingChange.orderNumber}
          currentStatus={pendingChange.from}
          newStatus={pendingChange.to}
          shipsEverythingCount={pendingChange.unitCount}
          deliversParcelCount={pendingChange.parcelCount}
          orderHref={`/admin/orders/${pendingChange.orderId}`}
          notifiesCustomer={CUSTOMER_NOTIFIED_STATUSES.includes(pendingChange.to)}
          onConfirm={confirmStatusChange}
          onClose={() => setPendingChange(null)}
        />
      )}

      {pendingBulk && (
        <ConfirmStatusChangeModal
          newStatus={pendingBulk.status}
          count={pendingBulk.count}
          notifiesCustomer={CUSTOMER_NOTIFIED_STATUSES.includes(pendingBulk.status)}
          onConfirm={confirmBulkStatusUpdate}
          onClose={() => setPendingBulk(null)}
        />
      )}
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <AdminOrdersPageInner />
    </Suspense>
  );
}
