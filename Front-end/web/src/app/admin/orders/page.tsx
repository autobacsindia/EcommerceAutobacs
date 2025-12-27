'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, ORDER_STATUS_COLORS } from '@/lib/constants';
import { Eye, RefreshCw, Download, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import OrderFiltersPanel, { OrderFilters } from '@/components/orders/OrderFiltersPanel';
import BulkActionsBar from '@/components/orders/BulkActionsBar';

interface Order {
  _id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  totalAmount: number;
  user: {
    _id: string;
    name: string;
    email: string;
  };
  items: any[];
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

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<{ total: number; pages: number; currentPage: number; hasNext?: boolean; hasPrev?: boolean }>({ total: 0, pages: 0, currentPage: 1 });
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [pageSize, setPageSize] = useState(20);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  
  // Initialize filters from URL params
  const [filters, setFilters] = useState<OrderFilters>(() => ({
    search: searchParams.get('search') || '',
    statuses: searchParams.get('status')?.split(',').filter(Boolean) || [],
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
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      await apiClient.put(API_ENDPOINTS.ORDER_UPDATE_STATUS(orderId), { 
        status: newStatus,
        reason: 'admin_update',
        notes: 'Status updated from admin panel'
      });
      
      setOrders(orders.map(order =>
        order._id === orderId ? { ...order, status: newStatus } : order
      ));
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
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
    if (newFilters.startDate) params.set('startDate', newFilters.startDate);
    if (newFilters.endDate) params.set('endDate', newFilters.endDate);
    if (newFilters.minAmount) params.set('minAmount', newFilters.minAmount);
    if (newFilters.maxAmount) params.set('maxAmount', newFilters.maxAmount);
    
    router.push(`/admin/orders?${params.toString()}`, { scroll: false });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
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

  const handleBulkStatusUpdate = async (status: string, reason: string, notes: string) => {
    try {
      const response = await apiClient.post(API_ENDPOINTS.ORDER_BULK_STATUS, {
        orderIds: selectedOrders,
        status,
        reason,
        notes,
      }) as any;
      
      const { successful, failed } = response.results || { successful: [], failed: [] };
      
      // Show results
      if (failed.length === 0) {
        alert(`Successfully updated ${successful.length} order(s)`);
      } else {
        alert(
          `Updated ${successful.length} order(s).\n` +
          `Failed to update ${failed.length} order(s):\n` +
          failed.map((f: any) => `- ${f.orderId}: ${f.error}`).join('\n')
        );
      }
      
      // Refresh and clear selection
      await fetchOrders();
      setSelectedOrders([]);
    } catch (error: any) {
      console.error('Bulk update failed:', error);
      alert(error.message || 'Bulk update failed');
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
              onChange={(e) => setPageSize(Number(e.target.value))}
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
                  Status
                  <SortIcon field="status" />
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
                    <select
                      value={order.status}
                      onChange={(e) => handleStatusChange(order._id, e.target.value)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border-0 focus:ring-2 focus:ring-offset-2 ${ORDER_STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-800'}`}
                    >
                      <option value="pending">Pending</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="processing">Processing</option>
                      <option value="shipped">Shipped</option>
                      <option value="delivered">Delivered</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
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
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Page {pagination.currentPage} of {pagination.pages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPagination(prev => ({ ...prev, currentPage: prev.currentPage - 1 }))}
              disabled={pagination.hasPrev === false}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPagination(prev => ({ ...prev, currentPage: prev.currentPage + 1 }))}
              disabled={pagination.hasNext === false}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
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
      />
    </div>
  );
}
