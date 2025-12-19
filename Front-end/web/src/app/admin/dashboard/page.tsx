'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { 
  Package, 
  ShoppingCart, 
  DollarSign, 
  TrendingUp, 
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Truck,
  User,
  BarChart3
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface Stats {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  lowStockProducts: number;
  completedOrders: number;
  averageOrderValue: number;
  cancellationRate: number;
  returnRate: number;
  avgFulfillmentTime: number;
}

interface Product {
  _id: string;
  name: string;
  stock: number;
  price: number;
  category: {
    name: string;
  };
}

interface Order {
  _id: string;
  orderNumber: string;
  user: {
    name: string;
  };
  totalAmount: number;
  status: string;
  createdAt: string;
}

interface RevenueData {
  date: string;
  amount: number;
}

interface OrderStatusData {
  name: string;
  value: number;
  [key: string]: any; // Allow additional properties for Recharts
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalProducts: 0,
    totalOrders: 0,
    totalRevenue: 0,
    pendingOrders: 0,
    lowStockProducts: 0,
    completedOrders: 0,
    averageOrderValue: 0,
    cancellationRate: 0,
    returnRate: 0,
    avgFulfillmentTime: 0,
  });
  
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [orderStatusData, setOrderStatusData] = useState<OrderStatusData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch all data in parallel
      const [productsRes, ordersRes]: [any, any] = await Promise.all([
        apiClient.get(`${API_ENDPOINTS.PRODUCTS}?limit=1000`),
        apiClient.get(`${API_ENDPOINTS.ADMIN_ORDERS}?limit=100`)
      ]);
      
      const products = productsRes?.products || [];
      const orders = ordersRes?.orders || [];
      
      // Get total product count from pagination info
      const totalProductsCount = productsRes?.total || products.length;
      
      // Calculate stats
      const totalRevenue = orders.reduce((sum: number, order: any) => sum + (order.totalAmount || 0), 0);
      const pendingOrders = orders.filter((order: any) => order.status === 'pending').length;
      const completedOrders = orders.filter((order: any) => order.status === 'delivered').length;
      const lowStockProducts = products.filter((product: any) => product.stock < 10).length;
      const cancelledOrders = orders.filter((order: any) => order.status === 'cancelled').length;
      const ordersWithReturns = orders.filter((order: any) => order.returnRequest).length;
      
      // Calculate average order value
      const averageOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
      
      // Calculate cancellation rate
      const cancellationRate = orders.length > 0 ? (cancelledOrders / orders.length) * 100 : 0;
      
      // Calculate return rate
      const returnRate = completedOrders > 0 ? (ordersWithReturns / completedOrders) * 100 : 0;
      
      // Calculate average fulfillment time (mock calculation - should use actual fulfillment metrics)
      const avgFulfillmentTime = 48; // hours - placeholder
      
      setStats({
        totalProducts: totalProductsCount,
        totalOrders: orders.length,
        totalRevenue,
        pendingOrders,
        lowStockProducts,
        completedOrders,
        averageOrderValue,
        cancellationRate,
        returnRate,
        avgFulfillmentTime,
      });
      
      // Set products (low stock first)
      const sortedProducts = [...products].sort((a, b) => a.stock - b.stock);
      setProducts(sortedProducts.slice(0, 5));
      
      // Set recent orders
      const sortedOrders = [...orders].sort((a: any, b: any) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setOrders(sortedOrders.slice(0, 5));
      
      // Prepare revenue data for last 30 days
      const revenueByDate: Record<string, number> = {};
      const today = new Date();
      
      // Initialize last 30 days with 0 revenue
      for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateString = date.toISOString().split('T')[0];
        revenueByDate[dateString] = 0;
      }
      
      // Aggregate revenue by date
      orders.forEach((order: any) => {
        const orderDate = new Date(order.createdAt).toISOString().split('T')[0];
        if (revenueByDate.hasOwnProperty(orderDate)) {
          revenueByDate[orderDate] += order.totalAmount || 0;
        }
      });
      
      // Convert to array format for chart
      const revenueChartData = Object.entries(revenueByDate).map(([date, amount]) => ({
        date,
        amount
      }));
      
      setRevenueData(revenueChartData);
      
      // Prepare order status data for pie chart
      const statusCounts: Record<string, number> = {};
      orders.forEach((order: any) => {
        statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
      });
      
      const statusChartData = Object.entries(statusCounts).map(([name, value]) => ({
        name,
        value
      }));
      
      setOrderStatusData(statusChartData);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      icon: Package,
      label: 'Total Products',
      value: stats.totalProducts,
      color: 'bg-blue-500',
      trend: null,
    },
    {
      icon: ShoppingCart,
      label: 'Total Orders',
      value: stats.totalOrders,
      color: 'bg-green-500',
      trend: null,
    },
    {
      icon: DollarSign,
      label: 'Total Revenue',
      value: `₹${stats.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      color: 'bg-purple-500',
      trend: null,
    },
    {
      icon: TrendingUp,
      label: 'Avg Order Value',
      value: `₹${stats.averageOrderValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      color: 'bg-indigo-500',
      trend: null,
    },
    {
      icon: CheckCircle,
      label: 'Completed Orders',
      value: stats.completedOrders,
      color: 'bg-teal-500',
      trend: `${stats.totalOrders > 0 ? ((stats.completedOrders / stats.totalOrders) * 100).toFixed(1) : 0}%`,
    },
    {
      icon: Clock,
      label: 'Pending Orders',
      value: stats.pendingOrders,
      color: 'bg-orange-500',
      trend: null,
    },
    {
      icon: XCircle,
      label: 'Cancellation Rate',
      value: `${stats.cancellationRate.toFixed(1)}%`,
      color: 'bg-red-500',
      trend: null,
    },
    {
      icon: Truck,
      label: 'Return Rate',
      value: `${stats.returnRate.toFixed(1)}%`,
      color: 'bg-yellow-500',
      trend: null,
    },
    {
      icon: Clock,
      label: 'Avg Fulfillment Time',
      value: `${stats.avgFulfillmentTime}h`,
      color: 'bg-cyan-500',
      trend: null,
    },
    {
      icon: AlertTriangle,
      label: 'Low Stock Items',
      value: stats.lowStockProducts,
      color: 'bg-rose-500',
      trend: null,
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'shipped': return 'bg-purple-100 text-purple-800';
      case 'delivered': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return <div className="p-8">Loading dashboard data...</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-8">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition">
              <div className="flex items-center justify-between mb-4">
                <div className={`${card.color} p-3 rounded-lg`}>
                  <Icon className="h-6 w-6 text-white" />
                </div>
              </div>
              <h3 className="text-gray-600 text-sm mb-1">{card.label}</h3>
              <p className="text-2xl font-bold">{card.value}</p>
              {card.trend && (
                <p className="text-xs text-gray-500 mt-1">Completion: {card.trend}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Revenue Chart */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center">
            <BarChart3 className="mr-2" />
            Revenue (Last 30 Days)
          </h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getDate()}/${date.getMonth() + 1}`;
                  }}
                />
                <YAxis 
                  tickFormatter={(value) => `₹${value.toLocaleString()}`}
                />
                <Tooltip 
                  formatter={(value) => [`₹${Number(value).toLocaleString()}`, 'Revenue']}
                  labelFormatter={(value) => `Date: ${value}`}
                />
                <Line 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Order Status Distribution */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Order Status Distribution</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={orderStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name}: ${(percent ? percent * 100 : 0).toFixed(0)}%`}
                >
                  {orderStatusData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={
                        entry.name === 'delivered' ? '#10B981' :
                        entry.name === 'pending' ? '#F59E0B' :
                        entry.name === 'processing' ? '#3B82F6' :
                        entry.name === 'shipped' ? '#8B5CF6' :
                        entry.name === 'cancelled' ? '#EF4444' : '#6B7280'
                      } 
                    />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, 'Orders']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Orders and Low Stock Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Recent Orders */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Recent Orders</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.map((order) => (
                  <tr key={order._id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {order.orderNumber}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {order.user.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ₹{order.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Products */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Low Stock Products</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {products.filter(p => p.stock < 10).map((product) => (
                  <tr key={product._id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {product.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {product.category?.name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        product.stock === 0 ? 'bg-red-100 text-red-800' : 
                        product.stock < 5 ? 'bg-orange-100 text-orange-800' : 
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {product.stock}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ₹{product.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {products.filter(p => p.stock < 10).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">
                      No low stock products
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}