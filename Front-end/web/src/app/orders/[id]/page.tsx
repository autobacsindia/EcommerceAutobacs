'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { ArrowLeft, MapPin, CreditCard, Package } from 'lucide-react';

interface OrderDetail {
  _id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  totalAmount: number;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    phone: string;
  };
  paymentMethod: string;
  items: Array<{
    _id: string;
    productId: {
      _id: string;
      name: string;
      price: number;
      images?: string[];
    };
    quantity: number;
    price: number;
  }>;
}

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (isAuthenticated && orderId) {
      fetchOrderDetail();
    }
  }, [isAuthenticated, orderId]);

  const fetchOrderDetail = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(`${API_ENDPOINTS.ORDERS}/${orderId}`);
      setOrder(response.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load order details');
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

  if (error || !order) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-500">{error || 'Order not found'}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Link
        href="/orders"
        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Orders
      </Link>

      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">
            Order #{order.orderNumber || order._id.slice(-8)}
          </h1>
          <p className="text-gray-500">
            Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <span className={`px-4 py-2 rounded-full font-medium ${getStatusColor(order.status)}`}>
          {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
        </span>
      </div>

      <div className="grid md:grid-cols-3 gap-8 mb-8">
        {/* Shipping Address */}
        <div className="border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">Shipping Address</h3>
          </div>
          <p>{order.shippingAddress.street}</p>
          <p>{order.shippingAddress.city}, {order.shippingAddress.state}</p>
          <p>{order.shippingAddress.postalCode}</p>
          <p className="mt-2 font-semibold">{order.shippingAddress.phone}</p>
        </div>

        {/* Payment Method */}
        <div className="border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">Payment Method</h3>
          </div>
          <p>{order.paymentMethod}</p>
        </div>

        {/* Order Summary */}
        <div className="border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Package className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">Order Summary</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Items:</span>
              <span>{order.items.length}</span>
            </div>
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total:</span>
              <span className="text-blue-600">₹{order.totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Order Items */}
      <div className="border rounded-lg p-6">
        <h3 className="font-bold text-xl mb-6">Order Items</h3>
        <div className="space-y-4">
          {order.items.map((item) => (
            <div key={item._id} className="flex gap-4 border-b pb-4 last:border-b-0">
              <div className="w-24 h-24 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                {item.productId.images && item.productId.images[0] ? (
                  <img
                    src={item.productId.images[0]}
                    alt={item.productId.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    No image
                  </div>
                )}
              </div>
              <div className="flex-1">
                <Link
                  href={`/products/${item.productId._id}`}
                  className="font-semibold hover:text-blue-600"
                >
                  {item.productId.name}
                </Link>
                <p className="text-gray-600 text-sm mt-1">Quantity: {item.quantity}</p>
                <p className="text-gray-600 text-sm">Price: ₹{item.price.toFixed(2)} each</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-lg">₹{(item.price * item.quantity).toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
