'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import apiClient from '@/lib/api';
import toast from 'react-hot-toast';
import { API_ENDPOINTS, ORDER_STATUS_COLORS, ORDER_STATUS_LABELS, CUSTOMER_NOTIFIED_STATUSES, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_LABELS } from '@/lib/constants';
import { Eye, RefreshCw, Download, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import OrderFiltersPanel, { OrderFilters } from '@/components/orders/OrderFiltersPanel';
import { getPageNumbers } from '@/lib/pagination';
import BulkActionsBar from '@/components/orders/BulkActionsBar';
import ConfirmStatusChangeModal, { ConfirmStatusPayload } from '@/components/orders/ConfirmStatusChangeModal';
import { updateOrderStatus } from '@/lib/orderStatusUpdate';

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
}

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
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<{ total: number; pages: number; currentPage: number; hasNext?: boolean; hasPrev?: boolean }>({ total: 0, pages: 0, currentPage: 1, hasNext: false, hasPrev: false });
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [pageSize, setPageSize] = useState(20);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [pendingChange, setPendingChange] = useState<{
    orderId: string;
    orderNumber: string;
    from: string;
    to: string;
  } | null>(null);
  const [pendingBulk, setPendingBulk] = useState<{
    status: string;
    reason: string;
    notes: string;
    count: number;
  } | null>(null);

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

  useEffect(() => {
    fetchOrders();
  }, [filters, pagination.currentPage, sortField, sortOrder, pageSize]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      
      // Build query parameters
      const params = new URLSearchParams();
      
      if (filters.search) params.append('orderNumber', filters.search);
      if (filters.customer) params.append('customer', filters.customer);
      if (filters.statuses.length > 0) params.append('status', filters.statuses.join(','));
      if (filters.paymentStatuses?.length) params.append('paymentStatus', filters.paymentStatuses.join(','));
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.minAmount) params.append('minAmount', filters.minAmount);
      if (filters.maxAmount) params.append('maxAmount', filters.maxAmount);
      
      params.append('page', pagination.currentPage.toString());
      params.append('limit', pageSize.toString());
      params.append('sortBy', sortField);
      params.append('sortOrder', sortOrder);
      
      const response = await apiClient.get<OrdersResponse>(
        `${API_ENDPOINTS.ADMIN_ORDERS}?${params.toString()}`
      );
      
      setOrders(response.orders || []);
      if (response.pagination) {
        setPagination(response.pagination);
      } else {
        // If no pagination data, set defaults based on current data
        setPagination({
          total: response.orders?.length || 0,
          pages: 1,
          currentPage: 1,
          hasNext: false,
          hasPrev: false
        });
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setLoading(false);
    }
  };

  // Open the confirmation modal instead of firing the API immediately.
  const requestStatusChange = (order: Order, newStatus: string) => {
    setPendingChange({
      orderId: order._id,
      orderNumber: order.orderNumber,
      from: order.status,
      to: newStatus,
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

    setOrders(orders.map(order =>
      order._id === orderId ? { ...order, status: to } : order
    ));
    setPendingChange(null);
    toast.success(`Order status updated to ${to}`);
  };

  const handleFiltersChange = (newFilters: OrderFilters) => {
    setFilters(newFilters);
    setPagination(prev => ({ ...prev, currentPage: 1 })); // Reset to first page
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
    
    router.push(`/admin/orders?${params.toString()}`, { scroll: false });
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
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  };

  const goToPage = (page: number) => {
    setPagination(prev => ({ ...prev, currentPage: page }));
  };

  const handleExport = () => {
    // Export visible orders as CSV
    const csv = [
      ['Order Number', 'Customer', 'Email', 'Date', 'Items', 'Amount', 'Status'].join(','),
      ...orders.map(order => [
        order.orderNumber || order._id.slice(-8),
        order.user?.name || 'N/A',
        order.user?.email || 'N/A',
        new Date(order.createdAt).toLocaleDateString(),
        order.items?.length || 0,
        order.totalAmount.toFixed(2),
        order.status
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${new Date().toISOString().split('T')[0]}.csv`;
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
      toast.error(`Updated ${successful.length}, failed ${failed.length}. See console for details.`);
      console.warn('Bulk update failures:', failed);
    }

    await fetchOrders();
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
      
      // Refresh and clear selection
      await fetchOrders();
      setSelectedOrders([]);
    } catch (error: any) {
      console.error('Bulk delete failed:', error);
      alert(error.message || 'Bulk delete failed');
    }
  };

  const handleExportSelected = () => {
    const selectedOrdersData = orders.filter(o => selectedOrders.includes(o._id));
    
    const csv = [
      ['Order Number', 'Customer', 'Email', 'Date', 'Items', 'Amount', 'Status'].join(','),
      ...selectedOrdersData.map(order => [
        order.orderNumber || order._id.slice(-8),
        order.user?.name || 'N/A',
        order.user?.email || 'N/A',
        new Date(order.createdAt).toLocaleDateString(),
        order.items?.length || 0,
        order.totalAmount.toFixed(2),
        order.status
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-orders-${new Date().toISOString().split('T')[0]}.csv`;
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
            onClick={fetchOrders}
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
                      {new Date(order.createdAt).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(order.createdAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
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
                      <select
                        value={order.status}
                        onChange={(e) => requestStatusChange(order, e.target.value)}
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
            currentPage={pagination.currentPage}
            totalPages={pagination.pages}
            onPageChange={goToPage}
          />
          <div className="mt-2 text-center text-sm text-gray-600">
            Page {pagination.currentPage} of {pagination.pages}
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
