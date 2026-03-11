'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSSE } from '@/hooks/useSSE';
import { useCurrency } from '@/contexts/CurrencyContext';

// Types
interface HealthMetrics {
  timestamp: number;
  overall: {
    score: number;
    status: 'healthy' | 'degraded' | 'warning' | 'critical' | 'unknown';
  };
  dimensions: {
    infrastructure: DimensionHealth;
    database: DimensionHealth;
    application: DimensionHealth;
    business: DimensionHealth;
  };
}

interface DimensionHealth {
  score: number;
  status: string;
  metrics: any;
}

interface Analytics {
  timestamp: number;
  sales: {
    revenueToday: number;
    revenueWeek: number;
    revenueMonth: number;
    ordersToday: number;
    ordersWeek: number;
    ordersMonth: number;
    averageOrderValue: number;
    conversionRate: number;
  };
  orders: {
    statusBreakdown: {
      pending: number;
      confirmed: number;
      processing: number;
      shipped: number;
      delivered: number;
      cancelled: number;
      refunded: number;
    };
    pendingOldOrders: number;
    recentOrders: RecentOrder[];
  };
  customers: {
    newToday: number;
    activeLast24h: number;
    total: number;
  };
  system: {
    inventory: {
      lowStock: number;
      outOfStock: number;
    };
    apiRequests: number;
    errorRate: number;
  };
  messages: {
    total: number;
    breakdown: {
      new: number;
      read: number;
      replied: number;
      closed: number;
    };
    recentMessages: {
      _id: string;
      name: string;
      subject: string;
      status: string;
      createdAt: string;
    }[];
  };
}

interface RecentOrder {
  id: string;
  orderNumber: string;
  status: string;
  amount: number;
  customerName: string;
  createdAt: string;
}

interface Alert {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: number;
  data?: any;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, token, isAuthenticated, isLoading: authLoading } = useAuth();
  const { formatPrice } = useCurrency();
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== 'admin')) {
      router.push('/login');
    }
  }, [isAuthenticated, user, authLoading, router]);

  const apiUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8080';
  const sseUrl = `${apiUrl}/dashboard/stream`;

  // Handle SSE messages
  const handleMessage = useCallback((message: any) => {
    setLastUpdate(new Date());

    switch (message.type) {
      case 'connected':
        console.log('Connection confirmed:', message.message);
        break;
      case 'health':
        setHealth(message.data);
        break;
      case 'analytics':
        setAnalytics(message.data);
        break;
      case 'alerts':
        setAlerts(message.data);
        break;
      case 'heartbeat':
        // Connection is alive
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }, []);

  const handleError = useCallback((error: Error) => {
    // Network errors are already logged as console.log inside useSSE; avoid double-logging
    const isNetworkError = error instanceof TypeError && error.message === 'Failed to fetch';
    if (!isNetworkError) {
      console.error('SSE Error:', error);
    }
  }, []);

  const handleConnect = useCallback(() => {
    console.log('Dashboard SSE connected successfully');
  }, []);

  // Use the custom SSE hook
  const { connectionState } = useSSE({
    url: sseUrl,
    token,
    enabled: isAuthenticated && user?.role === 'admin', // Only connect if authenticated as admin
    onMessage: handleMessage,
    onError: handleError,
    onConnect: handleConnect
  });

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      // Health Statuses
      case 'healthy':
        return 'text-green-600 bg-green-100';
      case 'degraded':
        return 'text-yellow-600 bg-yellow-100';
      case 'warning':
        return 'text-orange-600 bg-orange-100';
      case 'critical':
        return 'text-red-600 bg-red-100';
      
      // Order Statuses
      case 'pending':
        return 'text-yellow-600 bg-yellow-100';
      case 'confirmed':
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'shipped':
        return 'text-purple-600 bg-purple-100';
      case 'delivered':
        return 'text-green-600 bg-green-100';
      case 'cancelled':
      case 'refunded':
        return 'text-red-600 bg-red-100';

      // Message Statuses
      case 'new':
        return 'text-blue-600 bg-blue-100';
      case 'replied':
        return 'text-green-600 bg-green-100';
      case 'read':
        return 'text-gray-600 bg-gray-100';
      case 'closed':
        return 'text-gray-600 bg-gray-200';

      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  // Get connection status indicator
  const ConnectionStatusIndicator = () => {
    const colors = {
      disconnected: 'bg-gray-400',
      connecting: 'bg-yellow-400 animate-pulse',
      connected: 'bg-green-500',
      error: 'bg-red-500'
    };

    return (
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${colors[connectionState]}`}></div>
        <span className="text-sm text-gray-600 capitalize">{connectionState}</span>
      </div>
    );
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show nothing if not authenticated (will redirect)
  if (!isAuthenticated || user?.role !== 'admin') {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6 bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 mt-1">Real-time system monitoring and analytics</p>
          </div>
          <div className="text-right">
            <ConnectionStatusIndicator />
            {lastUpdate && (
              <p className="text-sm text-gray-500 mt-1">
                Last update: {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Health Overview */}
      {health && (
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">System Health</h2>
          
          {/* Overall Health Score */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center justify-center w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white">
              <div>
                <div className="text-4xl font-bold">{health.overall.score}</div>
                <div className="text-sm">Overall</div>
              </div>
            </div>
            <div className={`mt-2 inline-block px-4 py-1 rounded-full text-sm font-medium ${getStatusColor(health.overall.status)}`}>
              {health.overall.status.toUpperCase()}
            </div>
          </div>

          {/* Dimension Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Object.entries(health.dimensions).map(([key, dimension]) => (
              <div key={key} className="p-4 border rounded-lg">
                <h3 className="text-sm font-medium text-gray-600 mb-2 capitalize">{key}</h3>
                <div className="text-3xl font-bold text-gray-900">{dimension.score}</div>
                <div className={`mt-2 inline-block px-2 py-1 rounded text-xs font-medium ${getStatusColor(dimension.status)}`}>
                  {dimension.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analytics Grid */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          {/* Sales Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Sales</h3>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Today's Revenue</p>
                <p className="text-2xl font-bold text-green-600">{formatPrice(analytics.sales.revenueToday)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Orders Today</p>
                <p className="text-xl font-semibold">{analytics.sales.ordersToday}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Avg Order Value</p>
                <p className="text-xl font-semibold">{formatPrice(analytics.sales.averageOrderValue)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Conversion Rate</p>
                <p className="text-xl font-semibold">{analytics.sales.conversionRate}%</p>
              </div>
            </div>
          </div>

          {/* Orders Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Orders Status</h3>
            <div className="space-y-2">
              {Object.entries(analytics.orders.statusBreakdown).map(([status, count]) => (
                <div key={status} className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 capitalize">{status}</span>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
            {analytics.orders.pendingOldOrders > 0 && (
              <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded">
                <p className="text-sm text-orange-800">
                  <span className="font-semibold">{analytics.orders.pendingOldOrders}</span> orders pending for over 1 hour
                </p>
              </div>
            )}
          </div>

          {/* Customers Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Customers</h3>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">New Today</p>
                <p className="text-2xl font-bold text-blue-600">{analytics.customers.newToday}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Active (24h)</p>
                <p className="text-xl font-semibold">{analytics.customers.activeLast24h}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Customers</p>
                <p className="text-xl font-semibold">{analytics.customers.total.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Messages Card */}
          {analytics.messages && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4 text-gray-900">Messages</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">New Inquiries</p>
                  <p className="text-2xl font-bold text-purple-600">{analytics.messages.breakdown.new}</p>
                </div>
                <div className="space-y-2">
                   <div className="flex justify-between items-center text-sm">
                     <span className="text-gray-600">Replied</span>
                     <span className="font-semibold">{analytics.messages.breakdown.replied}</span>
                   </div>
                   <div className="flex justify-between items-center text-sm">
                     <span className="text-gray-600">Closed</span>
                     <span className="font-semibold">{analytics.messages.breakdown.closed}</span>
                   </div>
                   <div className="flex justify-between items-center text-sm">
                     <span className="text-gray-600">Total</span>
                     <span className="font-semibold">{analytics.messages.total}</span>
                   </div>
                </div>
              </div>
            </div>
          )}

          {/* Inventory Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Inventory</h3>
            <div className="space-y-3">
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm text-gray-600">Low Stock Items</p>
                <p className="text-2xl font-bold text-yellow-700">{analytics.system.inventory.lowStock}</p>
              </div>
              <div className="p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-sm text-gray-600">Out of Stock</p>
                <p className="text-2xl font-bold text-red-700">{analytics.system.inventory.outOfStock}</p>
              </div>
            </div>
          </div>

          {/* Recent Orders */}
          <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Recent Orders</h3>
            <div className="space-y-2">
              {analytics.orders.recentOrders.map((order) => (
                <div key={order.id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <div>
                    <p className="font-medium">{order.orderNumber}</p>
                    <p className="text-sm text-gray-600">{order.customerName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatPrice(order.amount)}</p>
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Messages */}
          {analytics.messages && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4 text-gray-900">Recent Messages</h3>
              <div className="space-y-2">
                {analytics.messages.recentMessages.map((msg) => (
                  <div key={msg._id} className="p-3 bg-gray-50 rounded">
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-medium text-sm truncate pr-2">{msg.subject}</p>
                      <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(msg.status)} whitespace-nowrap`}>
                        {msg.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-500">
                      <span>{msg.name}</span>
                      <span>{new Date(msg.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
                {analytics.messages.recentMessages.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">No recent messages</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Active Alerts</h2>
          <div className="space-y-3">
            {alerts.map((alert, index) => {
              const severityColors = {
                info: 'bg-blue-50 border-blue-200 text-blue-800',
                warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
                critical: 'bg-red-50 border-red-200 text-red-800'
              };

              return (
                <div key={index} className={`p-4 border rounded ${severityColors[alert.severity]}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{alert.type.replace(/_/g, ' ')}</p>
                      <p className="text-sm mt-1">{alert.message}</p>
                    </div>
                    <span className="text-xs">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading State */}
      {!health && !analytics && connectionState === 'connected' && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard data...</p>
        </div>
      )}

      {/* Error State */}
      {connectionState === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-800 font-semibold">Connection Error</p>
          <p className="text-red-600 mt-2">Attempting to reconnect...</p>
        </div>
      )}
    </div>
  );
}
