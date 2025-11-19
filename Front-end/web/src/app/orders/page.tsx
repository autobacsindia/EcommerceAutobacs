'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Package, Eye } from 'lucide-react';

interface Order {
  _id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  totalAmount: number;
  items: Array<{
    productId: {
      name: string;
    };
    quantity: number;
  }>;
}

export default function OrdersPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchOrders();
    }
  }, [isAuthenticated]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(API_ENDPOINTS.ORDERS);
      setOrders(response.orders || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      shipped: 'bg-purple-100 text-purple-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status.toLowerCase()] || 'bg-gray-100 text-gray-800';
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-500">{error}</div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <Package className="mx-auto h-16 w-16 text-gray-300 mb-4" />
          <h2 className="text-2xl font-bold text-gray-700 mb-2">No orders yet</h2>
          <p className="text-gray-500 mb-6">Start shopping to place your first order</p>
          <button
            onClick={() => router.push('/products')}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700"
          >
            Browse Products
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">My Orders</h1>

      <div className="space-y-4">
        {orders.map((order) => (
          <div key={order._id} className="border rounded-lg p-6 hover:shadow-lg transition">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold text-lg">
                  Order #{order.orderNumber || order._id.slice(-8)}
                </h3>
                <p className="text-gray-500 text-sm">
                  {new Date(order.createdAt).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(order.status)}`}>
                {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
              </span>
            </div>

            <div className="border-t pt-4 mb-4">
              <p className="text-sm text-gray-600 mb-2">
                {order.items.length} item{order.items.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-1">
                {order.items.slice(0, 3).map((item, index) => (
                  <p key={index} className="text-sm">
                    {item.productId.name} × {item.quantity}
                  </p>
                ))}
                {order.items.length > 3 && (
                  <p className="text-sm text-gray-500">
                    +{order.items.length - 3} more item{order.items.length - 3 !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center border-t pt-4">
              <div>
                <span className="text-gray-600">Total: </span>
                <span className="text-xl font-bold text-blue-600">
                  ₹{order.totalAmount.toFixed(2)}
                </span>
              </div>
              <Link
                href={`/orders/${order._id}`}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                <Eye className="h-4 w-4" />
                View Details
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
