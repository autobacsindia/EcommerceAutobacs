'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Package, ShoppingCart, DollarSign, TrendingUp } from 'lucide-react';

interface Stats {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalProducts: 0,
    totalOrders: 0,
    totalRevenue: 0,
    pendingOrders: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      // Fetch products count
      const productsRes = await apiClient.get(API_ENDPOINTS.PRODUCTS);
      const products = productsRes.products || [];
      
      // Fetch orders
      const ordersRes = await apiClient.get(`${API_ENDPOINTS.ORDERS}/admin/all`);
      const orders = ordersRes.orders || [];

      const totalRevenue = orders.reduce((sum: number, order: any) => sum + (order.totalAmount || 0), 0);
      const pendingOrders = orders.filter((order: any) => order.status === 'pending').length;

      setStats({
        totalProducts: products.length,
        totalOrders: orders.length,
        totalRevenue,
        pendingOrders,
      });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
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
    },
    {
      icon: ShoppingCart,
      label: 'Total Orders',
      value: stats.totalOrders,
      color: 'bg-green-500',
    },
    {
      icon: DollarSign,
      label: 'Total Revenue',
      value: `₹${stats.totalRevenue.toFixed(2)}`,
      color: 'bg-purple-500',
    },
    {
      icon: TrendingUp,
      label: 'Pending Orders',
      value: stats.pendingOrders,
      color: 'bg-orange-500',
    },
  ];

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`${card.color} p-3 rounded-lg`}>
                  <Icon className="h-6 w-6 text-white" />
                </div>
              </div>
              <h3 className="text-gray-600 text-sm mb-1">{card.label}</h3>
              <p className="text-2xl font-bold">{card.value}</p>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Welcome to Admin Dashboard</h2>
        <p className="text-gray-600">
          Manage your products, orders, and users from this panel.
        </p>
      </div>
    </div>
  );
}
