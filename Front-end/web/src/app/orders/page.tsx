'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import orderService from '@/lib/services/orderService';
import { API_ENDPOINTS } from '@/lib/constants';
import { Package, Eye, Filter, Search, ChevronDown } from 'lucide-react';
import OrderHistorySkeleton from '@/components/skeletons/OrderHistorySkeleton';

interface Order {
  _id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  totalAmount: number;
  items: Array<{
    product?: { _id: string; name: string };
    productId?: { _id: string; name: string };
    quantity: number;
    price: number;
  }>;
  trackingNumber?: string;
}

export default function OrdersPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc');

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const ordersPerPage = 10;

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (isAuthenticated) fetchOrders();
  }, [isAuthenticated, currentPage]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [orders, statusFilter, searchQuery, sortBy]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await orderService.getUserOrders(currentPage, ordersPerPage);
      setOrders((response.orders as unknown as Order[]) || []);
      setTotalPages(response.pagination?.totalPages || 1);
    } catch (err: any) {
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...orders];
    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status.toLowerCase() === statusFilter.toLowerCase());
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(order =>
        order._id.toLowerCase().includes(query) ||
        order.items.some(item => {
          const product = item.product || item.productId;
          return product?.name.toLowerCase().includes(query);
        })
      );
    }
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'date-asc': return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'amount-desc': return b.totalAmount - a.totalAmount;
        case 'amount-asc': return a.totalAmount - b.totalAmount;
        default: return 0;
      }
    });
    setFilteredOrders(filtered);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      confirmed: 'bg-[#3B9EE8]/10 text-[#3B9EE8] border-[#3B9EE8]/30',
      processing: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      shipped: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
      delivered: 'bg-green-500/10 text-green-400 border-green-500/30',
      cancelled: 'bg-red-500/10 text-red-400 border-red-500/30',
      refunded: 'bg-[#252525] text-[#C4C4C4] border-[#252525]',
      failed: 'bg-red-500/10 text-red-400 border-red-500/30',
    };
    return colors[status.toLowerCase()] || 'bg-[#252525] text-[#C4C4C4] border-[#252525]';
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, string> = {
      pending: '🕐',
      confirmed: '✓',
      processing: '📦',
      shipped: '🚚',
      delivered: '✅',
      cancelled: '❌',
      refunded: '💰',
      failed: '❌',
    };
    return icons[status.toLowerCase()] || '📋';
  };

  if (authLoading || loading) return <OrderHistorySkeleton />;
  if (!isAuthenticated) return null;

  if (error) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center max-w-md mx-4">
          <Package className="mx-auto h-12 w-12 text-red-400 mb-4" />
          <p className="text-[#C4C4C4] font-body mb-4">{error}</p>
          <button
            onClick={fetchOrders}
            className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-4 py-2 rounded-sm transition-colors text-sm"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto py-16 px-4">
          <Package className="mx-auto h-20 w-20 text-[#252525] mb-6" />
          <h2 className="text-3xl font-condensed font-bold text-white uppercase tracking-wide mb-3">No Orders Yet</h2>
          <p className="text-[#C4C4C4] font-body mb-8">Start shopping to place your first order and track it here</p>
          <button
            onClick={() => router.push('/products')}
            className="bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-8 py-3 rounded-sm transition-colors"
          >
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  const selectClass = 'bg-[#161616] border border-[#252525] text-[#C4C4C4] rounded-sm px-4 py-2 text-sm focus:outline-none focus:border-[#3B9EE8] font-body';

  return (
    <div className="min-h-screen bg-[#080808] py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <p className="text-[#3B9EE8] font-condensed font-bold text-sm uppercase tracking-widest mb-1">Account</p>
          <h1 className="text-4xl font-condensed font-bold text-white uppercase tracking-wide">My Orders</h1>
          <p className="text-[#C4C4C4] font-body mt-1">Track and manage your orders</p>
        </div>

        {/* Filters and Search */}
        <div className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555] h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search by order ID or product name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-[#161616] border border-[#252525] text-white placeholder:text-[#555555] rounded-sm focus:outline-none focus:border-[#3B9EE8] font-body text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
                <option value="failed">Failed</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className={selectClass}>
                <option value="date-desc">Newest First</option>
                <option value="date-asc">Oldest First</option>
                <option value="amount-desc">Highest Amount</option>
                <option value="amount-asc">Lowest Amount</option>
              </select>
            </div>
          </div>

          {(statusFilter !== 'all' || searchQuery) && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-[#555555] font-body">Active filters:</span>
              {statusFilter !== 'all' && (
                <span className="bg-[#3B9EE8]/10 text-[#3B9EE8] border border-[#3B9EE8]/30 px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-widest">
                  {statusFilter}
                </span>
              )}
              {searchQuery && (
                <span className="bg-[#3B9EE8]/10 text-[#3B9EE8] border border-[#3B9EE8]/30 px-2 py-0.5 rounded-sm text-xs font-condensed font-bold uppercase tracking-widest">
                  &ldquo;{searchQuery}&rdquo;
                </span>
              )}
              <button
                onClick={() => { setStatusFilter('all'); setSearchQuery(''); }}
                className="text-[#3B9EE8] hover:text-white font-body text-xs ml-2 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Results count */}
        <div className="mb-4">
          <p className="text-[#555555] font-body text-sm">
            Showing {filteredOrders.length} of {orders.length} order{orders.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Orders list */}
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12 bg-[#0E0E0E] border border-[#252525] rounded-sm">
            <p className="text-[#555555] font-body">No orders match your filters</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => (
              <div key={order._id} className="bg-[#0E0E0E] border border-[#252525] rounded-sm p-6 hover:border-[#3B9EE8]/40 transition-colors">
                <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl">{getStatusIcon(order.status)}</span>
                      <div>
                        <h3 className="font-condensed font-bold text-white uppercase tracking-wide">
                          Order #{order._id.slice(-8).toUpperCase()}
                        </h3>
                        <p className="text-[#555555] font-body text-sm">
                          {new Date(order.createdAt).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                    {order.trackingNumber && (
                      <p className="text-sm text-[#C4C4C4] font-body mt-2">
                        📍 Tracking: <span className="font-mono text-[#3B9EE8]">{order.trackingNumber}</span>
                      </p>
                    )}
                  </div>
                  <span className={`px-3 py-1 rounded-sm text-xs font-condensed font-bold uppercase tracking-widest border ${getStatusColor(order.status)}`}>
                    {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                  </span>
                </div>

                <div className="border-t border-[#252525] pt-4 mb-4">
                  <p className="text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest mb-3">
                    {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-2">
                    {order.items.slice(0, 3).map((item, index) => {
                      const product = item.product || item.productId;
                      return (
                        <div key={index} className="flex justify-between text-sm">
                          <span className="text-[#C4C4C4] font-body">
                            {product?.name || 'Unknown Product'} × {item.quantity}
                          </span>
                          <span className="text-[#555555] font-body">₹{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    {order.items.length > 3 && (
                      <p className="text-sm text-[#3B9EE8] font-body">
                        +{order.items.length - 3} more item{order.items.length - 3 !== 1 ? 's' : ''}...
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-t border-[#252525] pt-4">
                  <div>
                    <span className="text-[#555555] font-body text-sm">Total Amount: </span>
                    <span className="text-2xl font-condensed font-bold text-[#3B9EE8]">
                      ₹{order.totalAmount.toFixed(2)}
                    </span>
                  </div>
                  <Link
                    href={`/orders/${order._id}`}
                    className="flex items-center justify-center gap-2 bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold uppercase tracking-widest px-6 py-2.5 rounded-sm transition-colors text-sm"
                  >
                    <Eye className="h-4 w-4" />
                    View Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-8 flex justify-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-[#161616] border border-[#252525] text-[#C4C4C4] rounded-sm hover:bg-[#252525] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed font-condensed font-bold uppercase tracking-widest text-sm transition-colors"
            >
              Previous
            </button>
            <span className="px-4 py-2 bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 text-[#3B9EE8] rounded-sm font-condensed font-bold text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 bg-[#161616] border border-[#252525] text-[#C4C4C4] rounded-sm hover:bg-[#252525] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed font-condensed font-bold uppercase tracking-widest text-sm transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
